use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::put;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::UserId;

const MAX_BACKUP_ARMOR_SIZE: usize = 256 * 1024;
const MAX_CREDENTIAL_ID_B64_SIZE: usize = 1024;

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/user/{id}/secret-key-backup",
        put(put_secret_key_backup)
            .get(get_secret_key_backup)
            .delete(delete_secret_key_backup),
    )
}

#[derive(Debug, Deserialize)]
struct PutSecretKeyBackupBody {
    armor: String,
    version: i32,
    webauthn_credential_id_b64: String,
}

#[derive(Debug, Serialize)]
struct SecretKeyBackupResponse {
    armor: String,
    version: i32,
    webauthn_credential_id_b64: String,
    created_at: db::models::Timestamp,
    updated_at: db::models::Timestamp,
}

fn ensure_owner(
    path_id: &str,
    auth: &AuthenticatedUser,
    hostname: &str,
) -> Result<UserId, AppError> {
    let user_id = UserId::resolve_local(path_id, hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    if user_id != auth.user_id {
        return Err(AppError::Forbidden(
            "can only access own secret key backup".into(),
        ));
    }
    Ok(user_id)
}

fn resolve_backup_user_id(path_id: &str, hostname: &str) -> Result<UserId, AppError> {
    UserId::resolve_local(path_id, hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))
}

async fn put_secret_key_backup(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
    Json(body): Json<PutSecretKeyBackupBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let user_id = ensure_owner(&id, &auth, &state.config.server_hostname)?;

    if body.version != 1 {
        return Err(AppError::BadRequest("unsupported backup version".into()));
    }
    if body.armor.is_empty() || body.armor.len() > MAX_BACKUP_ARMOR_SIZE {
        return Err(AppError::BadRequest("invalid backup armor size".into()));
    }
    if body.webauthn_credential_id_b64.is_empty()
        || body.webauthn_credential_id_b64.len() > MAX_CREDENTIAL_ID_B64_SIZE
    {
        return Err(AppError::BadRequest("invalid credential id size".into()));
    }

    db::backups::upsert_secret_key_backup(
        &state.pool,
        user_id.as_str(),
        &body.armor,
        body.version,
        &body.webauthn_credential_id_b64,
    )
    .await?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "saved": true, "version": body.version })),
    ))
}

async fn get_secret_key_backup(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<SecretKeyBackupResponse>, AppError> {
    let user_id = resolve_backup_user_id(&id, &state.config.server_hostname)?;

    let row = db::backups::get_secret_key_backup(&state.pool, user_id.as_str())
        .await?
        .ok_or_else(|| AppError::NotFound("secret key backup not found".into()))?;

    Ok(Json(SecretKeyBackupResponse {
        armor: row.armor,
        version: row.version,
        webauthn_credential_id_b64: row.webauthn_credential_id_b64,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

async fn delete_secret_key_backup(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = ensure_owner(&id, &auth, &state.config.server_hostname)?;

    let deleted = db::backups::delete_secret_key_backup(&state.pool, user_id.as_str()).await?;
    if !deleted {
        return Err(AppError::NotFound("secret key backup not found".into()));
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}
