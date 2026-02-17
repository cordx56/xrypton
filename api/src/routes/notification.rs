use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::SubscriptionId;

/// 認証が必要なルート
pub fn routes() -> Router<AppState> {
    Router::new().route("/notification/subscribe", post(subscribe))
}

/// 認証不要の公開ルート
pub fn public_routes() -> Router<AppState> {
    Router::new().route("/notification/public-key", get(get_public_key))
}

async fn get_public_key(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let key = state
        .config
        .vapid_public_key
        .as_ref()
        .ok_or_else(|| AppError::Internal("VAPID public key not configured".into()))?;
    Ok(Json(serde_json::json!({ "key": key })))
}

#[derive(Deserialize)]
struct SubscribeBody {
    endpoint: String,
    keys: SubscribeKeys,
}

#[derive(Deserialize)]
struct SubscribeKeys {
    p256dh: String,
    auth: String,
}

async fn subscribe(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(body): Json<SubscribeBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let sub_id = SubscriptionId::new_v4();
    db::push::upsert_subscription(
        &state.pool,
        &sub_id,
        &auth.user_id,
        &body.endpoint,
        &body.keys.p256dh,
        &body.keys.auth,
    )
    .await?;

    Ok(Json(serde_json::json!({ "subscribed": true })))
}
