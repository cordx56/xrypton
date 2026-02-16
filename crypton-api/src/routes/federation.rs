use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::{ChatId, UserId};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/federation/notify", post(receive_notify))
        .route("/federation/chat", post(receive_chat_sync))
}

#[derive(Deserialize)]
struct NotifyBody {
    user_ids: Vec<String>,
    payload: serde_json::Value,
}

/// 外部サーバからのPush通知転送リクエストを受け付ける。
/// 指定されたローカルユーザにPush通知を送信する。
/// ペイロードはメタデータのみで実データは含まないため、認証不要。
async fn receive_notify(
    State(state): State<AppState>,
    Json(body): Json<NotifyBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_ids: Vec<UserId> = body.user_ids.into_iter().map(UserId).collect();

    let pool = state.pool.clone();
    let config = state.config.clone();
    tokio::spawn(async move {
        if let Err(e) =
            crate::push::send_event_to_users(&pool, &config, &user_ids, &body.payload).await
        {
            tracing::warn!("federation notify push failed: {e}");
        }
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ChatSyncBody {
    chat_id: String,
    name: String,
    member_ids: Vec<String>,
}

/// 外部サーバからのチャットグループ同期リクエストを受け付ける。
/// ホームサーバのドメインを server_domain に記録し、
/// ローカルメンバーのみ chat_members に追加する。
async fn receive_chat_sync(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(body): Json<ChatSyncBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // 送信元のドメインを特定（外部ユーザのドメイン部分がホームサーバ）
    let server_domain = auth
        .user_id
        .domain()
        .ok_or_else(|| AppError::BadRequest("chat sync requires external user with domain".into()))?
        .to_string();

    let chat_id = ChatId(body.chat_id);

    // member_idsからローカルユーザを抽出（ドメイン付きIDを保持）
    // `user@自サーバ` → `user@自サーバ`、外部ドメイン → 除外
    let hostname = &state.config.server_hostname;
    let local_member_ids: Vec<String> = body
        .member_ids
        .iter()
        .filter_map(|id| {
            if let Some((_local, domain)) = id.split_once('@') {
                if domain == hostname {
                    Some(id.clone())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    db::chat::create_remote_chat_reference(
        &state.pool,
        &chat_id,
        &body.name,
        &server_domain,
        &local_member_ids,
    )
    .await
    .map_err(|e| AppError::Internal(format!("failed to create remote chat reference: {e}")))?;

    // ローカルメンバーにPush通知
    let pool = state.pool.clone();
    let config = state.config.clone();
    let notify_chat_id = chat_id.clone();
    let name = body.name.clone();
    let member_ids: Vec<UserId> = local_member_ids
        .iter()
        .filter_map(|id| UserId::validate_full(id).ok())
        .collect();
    tokio::spawn(async move {
        let payload = serde_json::json!({
            "type": "added_to_group",
            "chat_id": notify_chat_id.as_str(),
            "name": name,
        });
        if let Err(e) =
            crate::push::send_event_to_users(&pool, &config, &member_ids, &payload).await
        {
            tracing::warn!("federation chat sync push failed: {e}");
        }
    });

    Ok(Json(serde_json::json!({ "ok": true })))
}
