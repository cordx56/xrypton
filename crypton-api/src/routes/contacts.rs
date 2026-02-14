use axum::extract::{Path, State};
use axum::routing::{delete, get};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::UserId;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/contacts", get(list_contacts).post(add_contact))
        .route("/contacts/{contact_user_id}", delete(delete_contact))
}

async fn list_contacts(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let contacts = db::contacts::get_contacts(&state.pool, &auth.user_id).await?;
    Ok(Json(serde_json::json!(contacts)))
}

#[derive(Deserialize)]
struct AddContactBody {
    user_id: String,
}

async fn add_contact(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(body): Json<AddContactBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // user@domain形式も許容
    let contact_user_id = UserId::validate_full(&body.user_id)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    // 自分自身の追加を拒否
    if auth.user_id == contact_user_id {
        return Err(AppError::BadRequest(
            "cannot add yourself as a contact".into(),
        ));
    }

    // 外部ユーザ（@含む）の場合はローカル存在確認をスキップ
    if contact_user_id.domain().is_none() {
        db::users::get_user(&state.pool, &contact_user_id)
            .await?
            .ok_or_else(|| AppError::NotFound("user not found".into()))?;
    }

    let inserted = db::contacts::add_contact(&state.pool, &auth.user_id, &contact_user_id).await?;
    if !inserted {
        return Err(AppError::Conflict("contact already exists".into()));
    }

    Ok(Json(serde_json::json!({ "added": true })))
}

async fn delete_contact(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(contact_user_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let contact_user_id = UserId::validate_full(&contact_user_id)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    let deleted =
        db::contacts::delete_contact(&state.pool, &auth.user_id, &contact_user_id).await?;
    if !deleted {
        return Err(AppError::NotFound("contact not found".into()));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}
