use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

use crate::AppState;
use crate::config::AppConfig;
use crate::db;
use crate::db::Db;
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
    pub signing_key_id: String,
    pub signing_public_key: String,
    /// 転送用にbase64エンコード済みAuthorizationヘッダーを保持
    pub raw_auth_header: String,
}

/// 認証の結果。nonceの新規性を呼び出し側で判断できるようにする。
pub struct AuthResult {
    pub user: AuthenticatedUser,
    /// nonceが新規であればtrue。再利用されていればfalse。
    pub nonce_is_new: bool,
}

/// Authorizationヘッダーを検証し、認証されたユーザ情報を返す。
/// nonceの新規性は`AuthResult.nonce_is_new`で返し、拒否は呼び出し側に委ねる。
pub(crate) async fn authenticate(
    pool: &Db,
    config: &AppConfig,
    auth_header_raw: &str,
) -> Result<AuthResult, AppError> {
    let auth_decoded = STANDARD
        .decode(auth_header_raw)
        .map_err(|e| AppError::Unauthorized(format!("invalid base64 in authorization: {e}")))?;
    let auth_header = String::from_utf8(auth_decoded)
        .map_err(|e| AppError::Unauthorized(format!("invalid utf-8 in authorization: {e}")))?;

    let signing_key_id = crypton_common::keys::extract_issuer_key_id(&auth_header)
        .map_err(|e| AppError::Unauthorized(format!("failed to extract key ID: {e}")))?;

    let user = db::users::get_user_by_signing_key_id(pool, &signing_key_id).await?;

    if let Some(user) = user {
        let user_id = UserId(user.id.clone());
        let public_keys =
            crypton_common::keys::PublicKeys::try_from(user.signing_public_key.as_str())
                .map_err(|e| AppError::Unauthorized(format!("invalid signing key: {e}")))?;

        match public_keys.verify_and_extract(&auth_header) {
            Ok(payload_bytes) => {
                let payload: AuthPayload = serde_json::from_slice(&payload_bytes)
                    .map_err(|e| AppError::Unauthorized(format!("invalid auth payload: {e}")))?;

                let is_new =
                    db::nonces::try_use_nonce(pool, &payload.nonce, user_id.as_str()).await?;

                return Ok(AuthResult {
                    user: AuthenticatedUser {
                        user_id,
                        signing_key_id,
                        signing_public_key: user.signing_public_key,
                        raw_auth_header: auth_header_raw.to_string(),
                    },
                    nonce_is_new: is_new,
                });
            }
            Err(_) => {
                // ローカルで検証失敗 → 外部ユーザとして再試行
            }
        }
    }

    // 外部ユーザとして検証（nonce処理は内部で行われ、常にnew）
    let auth = crate::federation::verify::verify_or_fetch_external_user(
        pool,
        config,
        auth_header_raw,
        &auth_header,
        &signing_key_id,
    )
    .await?;

    Ok(AuthResult {
        user: auth,
        nonce_is_new: true,
    })
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

        let result = authenticate(&state.pool, &state.config, auth_header_raw).await?;
        if !result.nonce_is_new {
            return Err(AppError::Unauthorized("nonce already used".into()));
        }
        Ok(result.user)
    }
}

#[derive(serde::Deserialize)]
struct AuthPayload {
    nonce: String,
    #[allow(dead_code)]
    timestamp: String,
}
