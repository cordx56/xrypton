use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::{ChatId, MessageId, ThreadId, UserId};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/chat/{chat_id}/{thread_id}/message",
            get(get_messages).post(post_message),
        )
        .route(
            "/chat/{chat_id}/{thread_id}/message/{message_id}",
            get(get_message_by_id),
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

    // server_domainが設定されている場合、ホームサーバにプロキシ
    if let Some(group) = db::chat::get_chat_group(&state.pool, &chat_id).await?
        && let Some(ref server_domain) = group.server_domain
    {
        let base =
            crate::federation::client::base_url(server_domain, state.config.federation_allow_http);
        let url = format!(
            "{base}/v1/chat/{}/{}/message?from={}&until={}",
            chat_id.as_str(),
            thread_id.as_str(),
            query.from,
            query.until
        );
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", &auth.raw_auth_header)
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy request failed: {e}")))?;
        let mut body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::BadGateway(format!("invalid proxy response: {e}")))?;

        // ホームサーバのローカルユーザIDにドメインを付与
        qualify_sender_ids_in_messages(&mut body, server_domain);

        return Ok(Json(body));
    }

    let (messages, total) =
        db::messages::get_messages(&state.pool, &thread_id, query.from, query.until).await?;

    Ok(Json(serde_json::json!({
        "messages": messages,
        "total": total,
    })))
}

async fn get_message_by_id(
    State(state): State<AppState>,
    Path((chat_id, thread_id, message_id)): Path<(String, String, String)>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let chat_id = ChatId(chat_id);
    let _thread_id = ThreadId(thread_id);
    let message_id = MessageId(message_id);

    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let message = db::messages::get_message_by_id(&state.pool, &message_id)
        .await?
        .ok_or_else(|| AppError::NotFound("message not found".into()))?;

    Ok(Json(serde_json::json!(message)))
}

#[derive(Deserialize, Serialize)]
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

    // server_domainが設定されている場合、ホームサーバにプロキシ
    if let Some(group) = db::chat::get_chat_group(&state.pool, &chat_id).await?
        && let Some(ref server_domain) = group.server_domain
    {
        let base =
            crate::federation::client::base_url(server_domain, state.config.federation_allow_http);
        let url = format!(
            "{base}/v1/chat/{}/{}/message",
            chat_id.as_str(),
            thread_id.as_str(),
        );
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", &auth.raw_auth_header)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy request failed: {e}")))?;
        let status = resp.status();
        let resp_body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::BadGateway(format!("invalid proxy response: {e}")))?;
        if !status.is_success() {
            return Err(AppError::BadGateway(format!(
                "home server returned {status}: {resp_body}"
            )));
        }
        return Ok(Json(resp_body));
    }

    // 外側署名の検証: メッセージ送信者が認証ユーザと一致するか確認
    let content_public_keys =
        xrypton_common::keys::PublicKeys::try_from(auth.signing_public_key.as_str())
            .map_err(|e| AppError::BadRequest(format!("invalid signing key: {e}")))?;
    let content_fingerprint = xrypton_common::keys::extract_issuer_fingerprint(&body.content)
        .map_err(|e| AppError::BadRequest(format!("invalid message format: {e}")))?;
    let expected_fingerprint = content_public_keys
        .get_signing_sub_key_fingerprint()
        .map_err(|e| AppError::BadRequest(format!("invalid signing key: {e}")))?;
    if content_fingerprint != expected_fingerprint {
        return Err(AppError::BadRequest("content signer mismatch".into()));
    }
    content_public_keys
        .verify_and_extract(&body.content)
        .map_err(|e| AppError::BadRequest(format!("content signature invalid: {e}")))?;

    let message_id = MessageId::new_v4();
    db::messages::create_message(
        &state.pool,
        &message_id,
        &thread_id,
        &auth.user_id,
        &body.content,
        None,
    )
    .await?;

    // 外部メンバーへのPush通知転送
    let members = db::chat::get_chat_members(&state.pool, &chat_id).await?;
    let allow_http = state.config.federation_allow_http;
    let fwd_chat_id = chat_id.as_str().to_string();
    let fwd_thread_id = thread_id.as_str().to_string();
    let fwd_message_id = message_id.as_str().to_string();
    let fwd_sender_id = auth.user_id.as_str().to_string();
    tokio::spawn(async move {
        // 外部メンバーをドメインごとにグループ化
        let mut domains: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for member in &members {
            if let Some((local, domain)) = member.user_id.split_once('@') {
                domains
                    .entry(domain.to_string())
                    .or_default()
                    .push(local.to_string());
            }
        }
        let payload = serde_json::json!({
            "type": "message",
            "sender_id": fwd_sender_id,
            "chat_id": fwd_chat_id,
            "thread_id": fwd_thread_id,
            "message_id": fwd_message_id,
        });
        for (domain, user_ids) in &domains {
            if let Err(e) =
                crate::federation::client::forward_push(domain, user_ids, &payload, allow_http)
                    .await
            {
                tracing::warn!("federation push to {domain} failed: {e}");
            }
        }
    });

    // 非同期でPush通知を送信（メッセージ送信をブロックしない）
    let pool = state.pool.clone();
    let config = state.config.clone();
    let sender_id = auth.user_id.clone();
    let push_chat_id = chat_id.clone();
    let push_thread_id = thread_id.clone();
    let push_message_id = message_id.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::push::send_to_members(
            &pool,
            &config,
            &push_chat_id,
            &sender_id,
            &push_thread_id,
            &push_message_id,
        )
        .await
        {
            tracing::warn!("push notification failed: {e}");
        }
    });

    Ok(Json(serde_json::json!({
        "id": message_id.as_str(),
    })))
}

#[derive(Deserialize, Serialize)]
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

    // server_domainが設定されている場合、ホームサーバにプロキシ
    if let Some(group) = db::chat::get_chat_group(&state.pool, &chat_id).await?
        && let Some(ref server_domain) = group.server_domain
    {
        let base =
            crate::federation::client::base_url(server_domain, state.config.federation_allow_http);
        let url = format!("{base}/v1/chat/{}", chat_id.as_str());
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", &auth.raw_auth_header)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy request failed: {e}")))?;
        let status = resp.status();
        let resp_body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::BadGateway(format!("invalid proxy response: {e}")))?;
        if !status.is_success() {
            return Err(AppError::BadGateway(format!(
                "home server returned {status}: {resp_body}"
            )));
        }
        return Ok(Json(resp_body));
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

/// プロキシ応答内のメッセージ sender_id にドメインを付与する。
fn qualify_sender_ids_in_messages(body: &mut serde_json::Value, server_domain: &str) {
    if let Some(messages) = body.get_mut("messages").and_then(|v| v.as_array_mut()) {
        for msg in messages {
            if let Some(sender_id) = msg.get("sender_id").and_then(|v| v.as_str())
                && !sender_id.contains('@')
            {
                msg["sender_id"] =
                    serde_json::Value::String(format!("{sender_id}@{server_domain}"));
            }
        }
    }
}
