use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::UserId;

pub fn routes() -> Router<AppState> {
    Router::new().route("/contacts", get(list_contacts).post(add_contact))
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
    let contact_user_id = UserId::validate(&body.user_id)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    // 自分自身の追加を拒否
    if auth.user_id == contact_user_id {
        return Err(AppError::BadRequest(
            "cannot add yourself as a contact".into(),
        ));
    }

    // 対象ユーザの存在を検証
    db::users::get_user(&state.pool, &contact_user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".into()))?;

    let inserted = db::contacts::add_contact(&state.pool, &auth.user_id, &contact_user_id).await?;
    if !inserted {
        return Err(AppError::Conflict("contact already exists".into()));
    }

    Ok(Json(serde_json::json!({ "added": true })))
}
