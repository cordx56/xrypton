use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::{ChatId, MessageId, ThreadId, UserId};

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/chat/{chat_id}/{thread_id}/message",
        get(get_messages).post(post_message),
    )
}

/// スレッドの新規作成もこのルートの親(chat)側で行うが、
/// POST /v1/chat/{chat_id} でスレッドを作成するルートも必要。
/// ここでは /chat/{chat_id}/{thread_id}/message のPOSTを実装。
pub fn thread_create_routes() -> Router<AppState> {
    Router::new().route("/chat/{chat_id}", axum::routing::post(create_thread))
}

#[derive(Deserialize)]
struct MessageQuery {
    #[serde(default = "default_from")]
    from: i64,
    #[serde(default)]
    until: i64,
}
fn default_from() -> i64 {
    -50
}

async fn get_messages(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    Query(query): Query<MessageQuery>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let thread_id = ThreadId(thread_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let (messages, total) =
        db::messages::get_messages(&state.pool, &thread_id, query.from, query.until).await?;

    Ok(Json(serde_json::json!({
        "messages": messages,
        "total": total,
    })))
}

#[derive(Deserialize)]
struct PostMessageBody {
    content: String,
}

async fn post_message(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
    Json(body): Json<PostMessageBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let thread_id = ThreadId(thread_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let message_id = MessageId::new_v4();
    db::messages::create_message(
        &state.pool,
        &message_id,
        &thread_id,
        &auth.user_id,
        &body.content,
    )
    .await?;

    // 非同期でPush通知を送信（メッセージ送信をブロックしない）
    let pool = state.pool.clone();
    let config = state.config.clone();
    let sender_id = auth.user_id.clone();
    let content = body.content.clone();
    let push_chat_id = chat_id.clone();
    tokio::spawn(async move {
        if let Err(e) =
            crate::push::send_to_members(&pool, &config, &push_chat_id, &sender_id, &content).await
        {
            tracing::warn!("push notification failed: {e}");
        }
    });

    Ok(Json(serde_json::json!({
        "id": message_id.as_str(),
    })))
}

#[derive(Deserialize)]
struct CreateThreadBody {
    name: String,
}

async fn create_thread(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    auth: AuthenticatedUser,
    Json(body): Json<CreateThreadBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let thread_id = ThreadId::new_v4();
    db::threads::create_thread(&state.pool, &thread_id, &chat_id, &body.name, &auth.user_id)
        .await?;

    // グループメンバー（作成者除く）にPush通知を送信
    let pool = state.pool.clone();
    let config = state.config.clone();
    let creator_id = auth.user_id.clone();
    let notify_chat_id = chat_id.clone();
    let name = body.name.clone();
    tokio::spawn(async move {
        let members = match db::chat::get_chat_members(&pool, &notify_chat_id).await {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("failed to get members for thread push: {e}");
                return;
            }
        };
        let user_ids: Vec<UserId> = members
            .iter()
            .filter(|m| m.user_id != creator_id.as_str())
            .map(|m| UserId(m.user_id.clone()))
            .collect();
        let payload = serde_json::json!({
            "type": "new_thread",
            "chat_id": notify_chat_id.as_str(),
            "name": name,
        });
        if let Err(e) = crate::push::send_event_to_users(&pool, &config, &user_ids, &payload).await
        {
            tracing::warn!("push notification failed for thread creation: {e}");
        }
    });

    Ok(Json(serde_json::json!({
        "id": thread_id.as_str(),
        "chat_id": chat_id.as_str(),
        "name": body.name,
    })))
}
