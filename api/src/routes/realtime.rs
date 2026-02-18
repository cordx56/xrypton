use std::collections::HashMap;
use std::collections::HashSet;

use axum::extract::{Path, State};
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
        .route("/chat/{chat_id}/realtime", post(create_realtime))
        .route(
            "/chat/{chat_id}/realtime/{session_id}/answer",
            post(post_realtime_answer),
        )
}

#[derive(Deserialize)]
struct RealtimeOfferBody {
    /// セッション表示名（平文）
    name: String,
    /// userId -> PGP暗号化された SDP+ICE+一時公開鍵
    encrypted: HashMap<String, String>,
}

#[derive(Deserialize)]
struct RealtimeAnswerBody {
    /// Answer送信先（通常はセッション作成者）
    to_user_id: String,
    /// SDP Answer（base64等でクライアント側が整形した値）
    answer: String,
}

/// リアルタイムセッションの開始: 各メンバーに暗号化されたSDP Offerを
/// Push通知で送信する。サーバは暗号化データを保存せず、中継するのみ。
async fn create_realtime(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    auth: AuthenticatedUser,
    Json(body): Json<RealtimeOfferBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }
    let members = db::chat::get_chat_members(&state.pool, &chat_id).await?;
    let member_set: HashSet<String> = members.into_iter().map(|m| m.user_id).collect();

    let session_id = uuid::Uuid::new_v4().to_string();
    let sender_id = auth.user_id.as_str().to_string();
    for (user_id_str, encrypted_data) in &body.encrypted {
        if !member_set.contains(user_id_str) {
            return Err(AppError::Forbidden(
                "target user is not in this chat".into(),
            ));
        }
        let user_id = UserId::validate_full(user_id_str)
            .map_err(|_| AppError::BadRequest("invalid target user_id".into()))?;
        let payload = serde_json::json!({
            "type": "realtime_offer",
            "chat_id": chat_id.as_str(),
            "session_id": session_id.as_str(),
            "sender_id": sender_id.as_str(),
            "name": &body.name,
            "encrypted": encrypted_data,
        });
        crate::push::send_event_to_users(&state.pool, &state.config, &[user_id], &payload)
            .await
            .map_err(AppError::Internal)?;
    }

    Ok(Json(serde_json::json!({
        "session_id": session_id,
    })))
}

/// 参加者から作成者へ SDP Answer を Push 通知で中継する。
async fn post_realtime_answer(
    State(state): State<AppState>,
    Path((chat_id, session_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
    Json(body): Json<RealtimeAnswerBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }
    let members = db::chat::get_chat_members(&state.pool, &chat_id).await?;
    let member_set: HashSet<String> = members.into_iter().map(|m| m.user_id).collect();
    if !member_set.contains(&body.to_user_id) {
        return Err(AppError::Forbidden(
            "target user is not in this chat".into(),
        ));
    }

    let to_user_id = UserId::validate_full(&body.to_user_id)
        .map_err(|_| AppError::BadRequest("invalid target user_id".into()))?;
    let payload = serde_json::json!({
        "type": "realtime_answer",
        "chat_id": chat_id.as_str(),
        "session_id": session_id,
        "sender_id": auth.user_id.as_str(),
        "answer": body.answer,
    });
    crate::push::send_event_to_users(&state.pool, &state.config, &[to_user_id], &payload)
        .await
        .map_err(AppError::Internal)?;

    Ok(Json(serde_json::json!({
        "ok": true,
    })))
}
