use crate::auth::AuthenticatedUser;
use crate::config::AppConfig;
use crate::db;
use crate::db::Db;
use crate::error::AppError;
use crate::types::UserId;

#[derive(serde::Deserialize)]
struct AuthPayload {
    nonce: String,
    #[allow(dead_code)]
    timestamp: String,
}

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
    auth_header_raw: &str,
    auth_header_decoded: &str,
    signing_key_id: &str,
) -> Result<AuthenticatedUser, AppError> {
    // 1. ローカルDBで外部ユーザとして検索
    if let Some(user) = db::users::get_user_by_signing_key_id(pool, signing_key_id).await? {
        let public_keys =
            crypton_common::keys::PublicKeys::try_from(user.signing_public_key.as_str())
                .map_err(|e| AppError::Unauthorized(format!("invalid signing key: {e}")))?;

        // 署名検証を試行
        if let Ok(payload_bytes) = public_keys.verify_and_extract(auth_header_decoded) {
            let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
                .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;

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
    let signer_user_id = crypton_common::keys::extract_signer_user_id(auth_header_decoded)
        .map_err(|e| AppError::Unauthorized(format!("failed to extract signer user ID: {e}")))?;
    tracing::debug!("extracted SignersUserID: {:?}", signer_user_id);

    // ドメイン部分を解析
    let (local_part, domain) = signer_user_id
        .split_once('@')
        .ok_or_else(|| AppError::Unauthorized("signer user ID has no domain".into()))?;

    // 自サーバのドメインの場合は拒否（ローカルユーザのはず）
    if domain == config.server_hostname {
        return Err(AppError::Unauthorized(
            "external user claims local domain".into(),
        ));
    }

    // 4. リモートサーバから公開鍵を取得
    let remote_keys = super::client::fetch_user_keys(
        domain,
        local_part,
        auth_header_raw,
        config.federation_allow_http,
    )
    .await?;

    // 5. ローカルDBにupsert
    let full_id = format!("{local_part}@{domain}");
    let public_keys =
        crypton_common::keys::PublicKeys::try_from(remote_keys.signing_public_key.as_str())
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
