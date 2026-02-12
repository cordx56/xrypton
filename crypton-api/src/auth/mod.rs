use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

use crate::AppState;
use crate::db;
use crate::error::AppError;
use crate::types::UserId;

/// Authenticated user extracted from the Authorization header.
///
/// The header must contain a base64-encoded PGP-signed message whose plaintext is
/// `{"nonce":"<uuid>","timestamp":"<iso8601>"}`.
/// The server extracts the signing key ID from the PGP message, looks up the user,
/// verifies the signature against the user's registered signing key,
/// then checks the nonce has not been used before.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user_id: UserId,
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

        // Authorization ヘッダは base64 エンコードされた PGP メッセージ
        let auth_decoded = STANDARD
            .decode(auth_header_raw)
            .map_err(|e| AppError::Unauthorized(format!("invalid base64 in authorization: {e}")))?;
        let auth_header = String::from_utf8(auth_decoded)
            .map_err(|e| AppError::Unauthorized(format!("invalid utf-8 in authorization: {e}")))?;

        // PGP メッセージから署名者の鍵IDを抽出
        let signing_key_id = crypton_common::keys::extract_issuer_key_id(&auth_header)
            .map_err(|e| AppError::Unauthorized(format!("failed to extract key ID: {e}")))?;

        // 鍵IDからユーザを検索
        let user = db::users::get_user_by_signing_key_id(&state.pool, &signing_key_id)
            .await?
            .ok_or_else(|| AppError::Unauthorized("user not found for signing key".into()))?;
        let user_id = UserId(user.id.clone());

        // 公開鍵で署名を検証し、ペイロード（nonce + timestamp）を取り出す
        let public_keys =
            crypton_common::keys::PublicKeys::try_from(user.signing_public_key.as_str())
                .map_err(|e| AppError::Unauthorized(format!("invalid signing key: {e}")))?;

        let payload_bytes = public_keys
            .verify_and_extract(&auth_header)
            .map_err(|e| AppError::Unauthorized(format!("signature verification failed: {e}")))?;

        let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
            .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;

        // nonce の一回限り使用チェック
        let is_new = db::nonces::try_use_nonce(&state.pool, &payload.nonce, &user_id).await?;
        if !is_new {
            return Err(AppError::Unauthorized("nonce already used".into()));
        }

        Ok(AuthenticatedUser { user_id })
    }
}

#[derive(serde::Deserialize)]
struct AuthPayload {
    nonce: String,
    #[allow(dead_code)]
    timestamp: String,
}
