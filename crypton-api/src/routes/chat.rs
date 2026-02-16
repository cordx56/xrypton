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
    let hostname = &state.config.server_hostname;

    // ベアID → @server_hostname 付与して正規化
    let resolved_member_ids: Vec<String> = body
        .member_ids
        .iter()
        .map(|id| {
            UserId::resolve(id, hostname)
                .map(|uid| uid.as_str().to_string())
                .map_err(|e| AppError::BadRequest(format!("invalid member ID: {e}")))
        })
        .collect::<Result<_, _>>()?;

    db::chat::create_chat_group(
        &state.pool,
        &chat_id,
        &body.name,
        &auth.user_id,
        &resolved_member_ids,
    )
    .await?;

    // 外部メンバーのホームサーバにチャット参照を同期
    let external_domains: std::collections::HashMap<String, Vec<String>> = resolved_member_ids
        .iter()
        .filter_map(|id| {
            let (_local, domain) = id.split_once('@')?;
            if domain != hostname {
                Some((domain.to_string(), id.clone()))
            } else {
                None
            }
        })
        .fold(std::collections::HashMap::new(), |mut acc, (domain, id)| {
            acc.entry(domain).or_default().push(id);
            acc
        });
    if !external_domains.is_empty() {
        let allow_http = state.config.federation_allow_http;
        let auth_header = auth.raw_auth_header.clone();
        let sync_chat_id = chat_id.as_str().to_string();
        let sync_name = body.name.clone();
        let all_member_ids = resolved_member_ids.clone();
        tokio::spawn(async move {
            for domain in external_domains.keys() {
                if let Err(e) = crate::federation::client::sync_chat_to_remote(
                    domain,
                    &sync_chat_id,
                    &sync_name,
                    &all_member_ids,
                    &auth_header,
                    allow_http,
                )
                .await
                {
                    tracing::warn!("federation chat sync to {domain} failed: {e}");
                }
            }
        });
    }

    // メンバー（作成者除く）にPush通知を送信
    // 外部ユーザにはsubscriptionがないため自動スキップされる
    let pool = state.pool.clone();
    let config = state.config.clone();
    let creator_id = auth.user_id.clone();
    let notify_chat_id = chat_id.clone();
    let name = body.name.clone();
    let member_ids: Vec<UserId> = resolved_member_ids
        .iter()
        .filter(|id| id.as_str() != creator_id.as_str())
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

    // server_domainが設定されている場合、ホームサーバにプロキシ
    let group = db::chat::get_chat_group(&state.pool, &chat_id)
        .await?
        .ok_or_else(|| AppError::NotFound("chat group not found".into()))?;

    if let Some(ref server_domain) = group.server_domain {
        let base =
            crate::federation::client::base_url(server_domain, state.config.federation_allow_http);
        let url = format!("{base}/v1/chat/{}", chat_id.as_str());
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

        // ホームサーバのローカルユーザIDにドメインを付与して、
        // リモート側のフロントエンドが鍵を正しく取得できるようにする
        qualify_user_ids_in_chat_response(&mut body, server_domain);

        return Ok(Json(body));
    }

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

/// プロキシ応答内のベアユーザIDに `@domain` を付与する。
/// ホームサーバのローカルユーザIDはドメインなしで保存されているため、
/// リモートクライアントが鍵取得できるよう完全修飾IDに変換する。
fn qualify_user_ids_in_chat_response(body: &mut serde_json::Value, server_domain: &str) {
    fn qualify(id: &str, domain: &str) -> String {
        if id.contains('@') {
            id.to_string()
        } else {
            format!("{id}@{domain}")
        }
    }

    // members[].user_id
    if let Some(members) = body.get_mut("members").and_then(|v| v.as_array_mut()) {
        for member in members {
            if let Some(uid) = member.get("user_id").and_then(|v| v.as_str()) {
                let qualified = qualify(uid, server_domain);
                member["user_id"] = serde_json::Value::String(qualified);
            }
        }
    }

    // group.created_by
    if let Some(created_by) = body
        .get("group")
        .and_then(|g| g.get("created_by"))
        .and_then(|v| v.as_str())
    {
        let qualified = qualify(created_by, server_domain);
        body["group"]["created_by"] = serde_json::Value::String(qualified);
    }
}
