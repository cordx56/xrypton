use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::{ChatId, ThreadId};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/chat/{chat_id}/{thread_id}",
            get(get_thread).post(update_thread),
        )
        .route("/chat/{chat_id}/{thread_id}/archive", post(archive_thread))
        .route(
            "/chat/{chat_id}/{thread_id}/unarchive",
            post(unarchive_thread),
        )
}

#[derive(Deserialize)]
struct UpdateThreadBody {
    name: String,
}

async fn get_thread(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let thread_id = ThreadId(thread_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let thread = db::threads::get_thread(&state.pool, &thread_id)
        .await?
        .ok_or_else(|| AppError::NotFound("thread not found".into()))?;

    Ok(Json(serde_json::json!(thread)))
}

async fn update_thread(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
    Json(body): Json<UpdateThreadBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let thread_id = ThreadId(thread_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    db::threads::update_thread_name(&state.pool, &thread_id, &body.name).await?;
    Ok(Json(serde_json::json!({ "updated": true })))
}

async fn archive_thread(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let thread_id = ThreadId(thread_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    db::threads::archive_thread(&state.pool, &thread_id).await?;
    Ok(Json(serde_json::json!({ "archived": true })))
}

async fn unarchive_thread(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let thread_id = ThreadId(thread_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    db::threads::unarchive_thread(&state.pool, &thread_id).await?;
    Ok(Json(serde_json::json!({ "unarchived": true })))
}
