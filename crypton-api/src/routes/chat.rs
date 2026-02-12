use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::{ChatId, UserId};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/chat", get(list_chats).post(create_chat))
        .route("/chat/archived", get(list_archived_chats))
        .route("/chat/{chat_id}", get(get_chat))
        .route("/chat/{chat_id}/archive", post(archive_chat))
        .route("/chat/{chat_id}/unarchive", post(unarchive_chat))
}

#[derive(Deserialize)]
struct CreateChatBody {
    name: String,
    member_ids: Vec<String>,
}

async fn create_chat(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(body): Json<CreateChatBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId::new_v4();

    db::chat::create_chat_group(
        &state.pool,
        &chat_id,
        &body.name,
        &auth.user_id,
        &body.member_ids,
    )
    .await?;

    // メンバー（作成者除く）にPush通知を送信
    let pool = state.pool.clone();
    let config = state.config.clone();
    let creator_id = auth.user_id.clone();
    let notify_chat_id = chat_id.clone();
    let name = body.name.clone();
    let member_ids: Vec<UserId> = body
        .member_ids
        .iter()
        .filter(|id| id.as_str() != creator_id.as_str())
        .map(|id| UserId::validate(id))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::BadRequest(format!("invalid member ID: {e}")))?;
    tokio::spawn(async move {
        let payload = serde_json::json!({
            "type": "added_to_group",
            "chat_id": notify_chat_id.as_str(),
            "name": name,
        });
        if let Err(e) =
            crate::push::send_event_to_users(&pool, &config, &member_ids, &payload).await
        {
            tracing::warn!("push notification failed for group creation: {e}");
        }
    });

    Ok(Json(serde_json::json!({
        "id": chat_id.as_str(),
        "name": body.name,
    })))
}

async fn list_chats(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let groups = db::chat::get_user_chat_groups(&state.pool, &auth.user_id).await?;
    Ok(Json(serde_json::json!(groups)))
}

async fn get_chat(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let group = db::chat::get_chat_group(&state.pool, &chat_id)
        .await?
        .ok_or_else(|| AppError::NotFound("chat group not found".into()))?;
    let members = db::chat::get_chat_members(&state.pool, &chat_id).await?;
    let threads = db::threads::get_threads_by_chat(&state.pool, &chat_id).await?;
    let archived_threads = db::threads::get_archived_threads_by_chat(&state.pool, &chat_id).await?;

    Ok(Json(serde_json::json!({
        "group": group,
        "members": members,
        "threads": threads,
        "archived_threads": archived_threads,
    })))
}

async fn list_archived_chats(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let groups = db::chat::get_user_archived_chat_groups(&state.pool, &auth.user_id).await?;
    Ok(Json(serde_json::json!(groups)))
}

async fn archive_chat(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    db::chat::archive_chat_group(&state.pool, &chat_id).await?;
    Ok(Json(serde_json::json!({ "archived": true })))
}

async fn unarchive_chat(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    db::chat::unarchive_chat_group(&state.pool, &chat_id).await?;
    Ok(Json(serde_json::json!({ "unarchived": true })))
}
