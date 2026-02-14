use crate::error::AppError;
use serde::Deserialize;

pub fn base_url(domain: &str, allow_http: bool) -> String {
    if allow_http {
        format!("http://{domain}/api")
    } else {
        format!("https://{domain}/api")
    }
}

#[derive(Debug, Deserialize)]
pub struct UserKeysResponse {
    pub id: String,
    pub encryption_public_key: String,
    pub signing_public_key: String,
    pub signing_key_id: String,
}

/// 外部サーバからユーザの公開鍵を取得する。
/// Authorizationヘッダーを転送して、リモートサーバでの認証を可能にする。
pub async fn fetch_user_keys(
    domain: &str,
    user_id: &str,
    auth_header_raw: &str,
    allow_http: bool,
) -> Result<UserKeysResponse, AppError> {
    let base = base_url(domain, allow_http);
    let url = format!("{base}/v1/user/{user_id}/keys");
    tracing::debug!("fetch_user_keys: url={url} domain={domain} user_id={user_id}");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", auth_header_raw)
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("federation request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::BadGateway(format!(
            "federation server returned {status}: {body}"
        )));
    }

    resp.json::<UserKeysResponse>()
        .await
        .map_err(|e| AppError::BadGateway(format!("invalid federation response: {e}")))
}

/// 外部サーバにチャットグループの参照を同期する。
/// チャット作成時、外部メンバーのホームサーバにチャット情報を通知し、
/// リモート側で server_domain 付きの参照を作成させる。
pub async fn sync_chat_to_remote(
    domain: &str,
    chat_id: &str,
    chat_name: &str,
    member_ids: &[String],
    auth_header_raw: &str,
    allow_http: bool,
) -> Result<(), AppError> {
    let base = base_url(domain, allow_http);
    let url = format!("{base}/v1/federation/chat");

    let body = serde_json::json!({
        "chat_id": chat_id,
        "name": chat_name,
        "member_ids": member_ids,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", auth_header_raw)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("federation chat sync failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("federation chat sync to {domain} returned {status}: {body}");
    }

    Ok(())
}

/// 外部サーバにPush通知リクエストを転送する。
/// チャットのホームサーバが、外部メンバーのホームサーバにPush通知を依頼する。
/// 通知はメタデータのみで実データを含まないため、ユーザ認証は不要。
pub async fn forward_push(
    domain: &str,
    user_ids: &[String],
    payload: &serde_json::Value,
    allow_http: bool,
) -> Result<(), AppError> {
    let base = base_url(domain, allow_http);
    let url = format!("{base}/v1/federation/notify");

    let body = serde_json::json!({
        "user_ids": user_ids,
        "payload": payload,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("federation push failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        tracing::warn!("federation push to {domain} returned {status}: {body}");
    }

    Ok(())
}
