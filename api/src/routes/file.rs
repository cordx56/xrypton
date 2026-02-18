use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::header;
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::{ChatId, FileId, MessageId, ThreadId};

/// ファイルサイズ上限: 10MB
const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/chat/{chat_id}/{thread_id}/file",
            axum::routing::post(upload_file).layer(DefaultBodyLimit::max(15 * 1024 * 1024)),
        )
        .route("/file/{file_id}", get(download_file))
}

/// ファイルアップロード（multipart: metadata + file）
async fn upload_file(
    State(state): State<AppState>,
    Path((chat_id, thread_id)): Path<(String, String)>,
    auth: AuthenticatedUser,
    mut multipart: Multipart,
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
            "{base}/v1/chat/{}/{}/file",
            chat_id.as_str(),
            thread_id.as_str(),
        );

        // multipartを再構築してプロキシ
        let mut form = reqwest::multipart::Form::new();
        while let Some(field) = multipart
            .next_field()
            .await
            .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
        {
            let name = field.name().unwrap_or("").to_string();
            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("failed to read field: {e}")))?;
            form = form.part(name, reqwest::multipart::Part::bytes(data.to_vec()));
        }

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", &auth.raw_auth_header)
            .multipart(form)
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

    // 外側署名の検証用ヘルパー
    let verify_outer_signature = |content: &str| -> Result<(), AppError> {
        let content_public_keys =
            xrypton_common::keys::PublicKeys::try_from(auth.signing_public_key.as_str())
                .map_err(|e| AppError::BadRequest(format!("invalid signing key: {e}")))?;
        let content_fingerprint = xrypton_common::keys::extract_issuer_fingerprint(content)
            .map_err(|e| AppError::BadRequest(format!("invalid message format: {e}")))?;
        let expected_fingerprint = content_public_keys
            .get_signing_sub_key_fingerprint()
            .map_err(|e| AppError::BadRequest(format!("invalid signing key: {e}")))?;
        if content_fingerprint != expected_fingerprint {
            return Err(AppError::BadRequest("content signer mismatch".into()));
        }
        content_public_keys
            .verify_and_extract(content)
            .map_err(|e| AppError::BadRequest(format!("content signature invalid: {e}")))?;
        Ok(())
    };

    let mut metadata_content: Option<String> = None;
    let mut file_data: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "metadata" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read metadata: {e}")))?;
                metadata_content = Some(text);
            }
            "file" => {
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read file: {e}")))?;
                if data.len() > MAX_FILE_SIZE {
                    return Err(AppError::PayloadTooLarge(
                        "file must be 10 MB or smaller".into(),
                    ));
                }
                file_data = Some(data.to_vec());
            }
            _ => {}
        }
    }

    let metadata =
        metadata_content.ok_or_else(|| AppError::BadRequest("missing metadata field".into()))?;
    let file_bytes = file_data.ok_or_else(|| AppError::BadRequest("missing file field".into()))?;

    // メタデータの外側PGP署名を検証
    verify_outer_signature(&metadata)?;

    let file_id = FileId::new_v4();
    let s3_key = format!("files/{}/{}", chat_id.as_str(), file_id.as_str());

    // S3にファイルを保存
    state
        .storage
        .put_object(&s3_key, file_bytes.clone(), "application/octet-stream")
        .await
        .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;

    // filesレコードを作成
    db::files::create_file(
        &state.pool,
        &file_id,
        &chat_id,
        &s3_key,
        file_bytes.len() as i32,
    )
    .await?;

    // messagesレコードを作成（メタデータをcontentとして保存）
    let message_id = MessageId::new_v4();
    db::messages::create_message(
        &state.pool,
        &message_id,
        &thread_id,
        &auth.user_id,
        &metadata,
        Some(&file_id),
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

    // ローカルPush通知
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
        "file_id": file_id.as_str(),
    })))
}

/// ファイルダウンロード
async fn download_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Response, AppError> {
    let file_id = FileId(file_id);

    let file = db::files::get_file(&state.pool, &file_id)
        .await?
        .ok_or_else(|| AppError::NotFound("file not found".into()))?;

    let chat_id = ChatId(file.chat_id);
    if !db::chat::is_member(&state.pool, &chat_id, &auth.user_id).await? {
        return Err(AppError::Forbidden("not a member of this chat".into()));
    }

    let data = state
        .storage
        .get_object(&file.s3_key)
        .await
        .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(data))
        .unwrap())
}
