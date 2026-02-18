use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

use crate::AppState;
use crate::config::AppConfig;
use crate::db;
use crate::db::Db;
use crate::error::AppError;
use crate::federation::dns::DnsTxtResolver;
use crate::types::UserId;

/// Authenticated user extracted from the Authorization header.
///
/// The header must contain a base64-encoded PGP-signed message whose plaintext is
/// `{"nonce":{"random":"<random>","time":"<iso8601>"}}`.
/// サーバーはnonceのタイムスタンプが現在時刻から前後1時間以内であることを検証する。
/// The server extracts the signer user ID from the PGP SignersUserID subpacket,
/// looks up the user, verifies the signature against the user's registered signing key,
/// then checks the nonce has not been used before.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user_id: UserId,
    pub primary_key_fingerprint: String,
    pub signing_public_key: String,
    /// 転送用にbase64エンコード済みAuthorizationヘッダーを保持
    pub raw_auth_header: String,
}

/// Authorizationヘッダーを検証し、認証されたユーザ情報を返す。
/// nonce再利用はリプレイ攻撃として拒否する。
pub(crate) async fn authenticate(
    pool: &Db,
    config: &AppConfig,
    dns_resolver: &DnsTxtResolver,
    auth_header_raw: &str,
) -> Result<AuthenticatedUser, AppError> {
    let auth_decoded = STANDARD
        .decode(auth_header_raw)
        .map_err(|e| AppError::Unauthorized(format!("invalid base64 in authorization: {e}")))?;
    let auth_header = String::from_utf8(auth_decoded)
        .map_err(|e| AppError::Unauthorized(format!("invalid utf-8 in authorization: {e}")))?;

    // SignersUserIDサブパケットからユーザIDを抽出してDB検索
    let signer_address = xrypton_common::keys::extract_signer_user_id(&auth_header)
        .map_err(|e| AppError::Unauthorized(format!("failed to extract signer user ID: {e}")))?;

    // ローカルユーザとして解決を試みる（ドメイン付きIDでDB検索）
    let user_id = UserId::resolve_local(&signer_address, &config.server_hostname)
        .unwrap_or_else(|_| UserId(signer_address.clone()));

    if let Some(user) = db::users::get_user(pool, &user_id).await? {
        let public_keys =
            xrypton_common::keys::PublicKeys::try_from(user.signing_public_key.as_str())
                .map_err(|e| AppError::Unauthorized(format!("invalid signing key: {e}")))?;

        match public_keys.verify_and_extract(&auth_header) {
            Ok(payload_bytes) => {
                let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
                    .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;
                validate_nonce_timestamp(&payload.nonce)?;
                let nonce_key = payload.nonce.replay_key();

                let is_new = db::nonces::try_use_nonce(pool, nonce_key, user_id.as_str()).await?;
                if !is_new {
                    return Err(AppError::Unauthorized("nonce already used".into()));
                }

                return Ok(AuthenticatedUser {
                    user_id,
                    primary_key_fingerprint: user.primary_key_fingerprint,
                    signing_public_key: user.signing_public_key,
                    raw_auth_header: auth_header_raw.to_string(),
                });
            }
            Err(_) => {
                // ローカルで検証失敗 → 外部ユーザとして再試行
            }
        }
    }

    // 外部ユーザとして検証（nonce処理は内部で行われる）
    crate::federation::verify::verify_or_fetch_external_user(
        pool,
        config,
        dns_resolver,
        auth_header_raw,
        &auth_header,
    )
    .await
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header_raw = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("missing authorization header".into()))?;

        authenticate(
            &state.pool,
            &state.config,
            &state.dns_resolver,
            auth_header_raw,
        )
        .await
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct AuthPayload {
    pub(crate) nonce: AuthNonce,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum AuthNonce {
    Legacy(String),
    Structured { random: String, time: String },
}

impl AuthNonce {
    pub(crate) fn replay_key(&self) -> &str {
        match self {
            Self::Legacy(value) => value,
            Self::Structured { random, .. } => random,
        }
    }

    fn timestamp(&self) -> &str {
        match self {
            Self::Legacy(value) => value,
            Self::Structured { time, .. } => time,
        }
    }
}

/// nonceのISO 8601タイムスタンプが現在時刻から前後1時間以内か検証する。
pub(crate) fn validate_nonce_timestamp(nonce: &AuthNonce) -> Result<(), AppError> {
    let client_time: chrono::DateTime<chrono::Utc> = nonce
        .timestamp()
        .parse()
        .map_err(|e| AppError::Unauthorized(format!("invalid nonce timestamp: {e}")))?;
    let diff = (chrono::Utc::now() - client_time).num_seconds().abs();
    if diff > 3600 {
        return Err(AppError::Unauthorized(
            "nonce timestamp out of range".into(),
        ));
    }
    Ok(())
}
