use crate::auth::{AuthPayload, AuthenticatedUser, validate_nonce_timestamp};
use crate::config::AppConfig;
use crate::db;
use crate::db::Db;
use crate::error::AppError;
use crate::federation::dns::{DnsTxtResolver, ResolvedDomain};
use crate::types::UserId;

/// 外部ユーザの署名を検証し、AuthenticatedUserを返す。
///
/// 1. signing_key_idでローカルDBから検索（外部ユーザは`user@domain`で保存済みの場合あり）
/// 2. 見つかった → 公開鍵で署名検証を試行、成功すれば返却
/// 3. PGP署名のSignersUserIDサブパケットからuser_id@domainを抽出
/// 4. ドメインの鍵取得エンドポイントにリクエスト（Authorizationヘッダー転送）
/// 5. 取得した公開鍵をローカルusersテーブルにupsert
/// 6. 公開鍵で署名検証 → AuthenticatedUser返却
pub async fn verify_or_fetch_external_user(
    pool: &Db,
    config: &AppConfig,
    dns_resolver: &DnsTxtResolver,
    auth_header_raw: &str,
    auth_header_decoded: &str,
    signing_key_id: &str,
) -> Result<AuthenticatedUser, AppError> {
    // 1. ローカルDBで外部ユーザとして検索
    if let Some(user) = db::users::get_user_by_signing_key_id(pool, signing_key_id).await? {
        let public_keys =
            xrypton_common::keys::PublicKeys::try_from(user.signing_public_key.as_str())
                .map_err(|e| AppError::Unauthorized(format!("invalid signing key: {e}")))?;

        // 署名検証を試行
        if let Ok(payload_bytes) = public_keys.verify_and_extract(auth_header_decoded) {
            let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
                .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;
            validate_nonce_timestamp(&payload.nonce)?;

            let user_id = UserId(user.id.clone());
            let is_new = db::nonces::try_use_nonce(pool, &payload.nonce, user_id.as_str()).await?;
            if !is_new {
                return Err(AppError::Unauthorized("nonce already used".into()));
            }

            return Ok(AuthenticatedUser {
                user_id,
                signing_key_id: signing_key_id.to_string(),
                signing_public_key: user.signing_public_key,
                raw_auth_header: auth_header_raw.to_string(),
            });
        }
        // 署名検証失敗 → 鍵更新の可能性、下のフローで再取得
    }

    // 3. SignersUserIDサブパケットからuser_id@domainを抽出
    let signer_user_id = xrypton_common::keys::extract_signer_user_id(auth_header_decoded)
        .map_err(|e| AppError::Unauthorized(format!("failed to extract signer user ID: {e}")))?;
    tracing::debug!("extracted SignersUserID: {:?}", signer_user_id);

    // ドメイン部分を解析
    let (orig_local, orig_domain) = signer_user_id
        .split_once('@')
        .ok_or_else(|| AppError::Unauthorized("signer user ID has no domain".into()))?;

    // DNS TXTレコードによるドメイン解決
    let (local_part, domain) = match dns_resolver.resolve(orig_domain, orig_local).await {
        ResolvedDomain::Mapped {
            local_part: resolved_local,
            domain: resolved_domain,
        } => {
            tracing::debug!(
                "DNS resolved {orig_local}@{orig_domain} -> {resolved_local}@{resolved_domain}"
            );
            (resolved_local, resolved_domain)
        }
        ResolvedDomain::Original => (orig_local.to_string(), orig_domain.to_string()),
    };

    // DNS解決後のドメイン・名前が一致するか検証
    if local_part != orig_local {
        return Err(AppError::Unauthorized(format!(
            "DNS resolved user ID mismatch: expected {orig_local}, got {local_part}"
        )));
    }

    // DNS解決後のドメインが自サーバの場合、ローカルユーザとして検証を試行
    // 元のドメインを保持してDB検索（カスタムドメインユーザは cord@x56.jp 形式で保存されている）
    if domain == config.server_hostname {
        let user_id = UserId::new_local(&local_part, orig_domain)
            .map_err(|e| AppError::Unauthorized(format!("invalid local user ID: {e}")))?;
        let user = db::users::get_user(pool, &user_id).await?.ok_or_else(|| {
            AppError::Unauthorized("external user claims local domain but not found".into())
        })?;

        let public_keys =
            xrypton_common::keys::PublicKeys::try_from(user.signing_public_key.as_str())
                .map_err(|e| AppError::Unauthorized(format!("invalid signing key: {e}")))?;

        let payload_bytes = public_keys
            .verify_and_extract(auth_header_decoded)
            .map_err(|e| AppError::Unauthorized(format!("signature verification failed: {e}")))?;

        let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
            .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;
        validate_nonce_timestamp(&payload.nonce)?;

        let is_new = db::nonces::try_use_nonce(pool, &payload.nonce, user_id.as_str()).await?;
        if !is_new {
            return Err(AppError::Unauthorized("nonce already used".into()));
        }

        return Ok(AuthenticatedUser {
            user_id,
            signing_key_id: signing_key_id.to_string(),
            signing_public_key: user.signing_public_key,
            raw_auth_header: auth_header_raw.to_string(),
        });
    }

    // 4. リモートサーバから公開鍵を取得（DNS解決後のドメインを使用）
    let remote_keys = super::client::fetch_user_keys(
        &domain,
        &local_part,
        auth_header_raw,
        config.federation_allow_http,
    )
    .await?;

    // 5. ローカルDBにupsert（元のIDを保持）
    let full_id = format!("{orig_local}@{orig_domain}");
    let public_keys =
        xrypton_common::keys::PublicKeys::try_from(remote_keys.signing_public_key.as_str())
            .map_err(|e| AppError::Unauthorized(format!("invalid remote signing key: {e}")))?;
    let remote_signing_key_id = public_keys
        .get_signing_sub_key_id()
        .map_err(|e| AppError::Unauthorized(format!("failed to get remote key id: {e}")))?;

    db::users::upsert_external_user(
        pool,
        &full_id,
        &remote_keys.encryption_public_key,
        &remote_keys.signing_public_key,
        &remote_signing_key_id,
    )
    .await?;

    // 6. 取得した公開鍵で署名検証
    let payload_bytes = public_keys
        .verify_and_extract(auth_header_decoded)
        .map_err(|e| AppError::Unauthorized(format!("signature verification failed: {e}")))?;

    let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;
    validate_nonce_timestamp(&payload.nonce)?;

    let user_id = UserId(full_id);
    let is_new = db::nonces::try_use_nonce(pool, &payload.nonce, user_id.as_str()).await?;
    if !is_new {
        return Err(AppError::Unauthorized("nonce already used".into()));
    }

    Ok(AuthenticatedUser {
        user_id,
        signing_key_id: remote_signing_key_id,
        signing_public_key: remote_keys.signing_public_key,
        raw_auth_header: auth_header_raw.to_string(),
    })
}
