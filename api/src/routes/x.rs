use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;

use super::atproto::canonicalize_json;

const X_HANDLE_MAX_LEN: usize = 15;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/x/account", get(list_accounts).post(link_account))
        .route("/x/account/{handle}", delete(unlink_account))
}

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

/// X の author_url が正当なドメインかチェック
fn validate_x_author_url(url: &str) -> Result<(), AppError> {
    let parsed = parse_x_url(url)?;
    let (handle, has_status) = parse_x_path(&parsed)?;
    if has_status {
        return Err(AppError::BadRequest(
            "author_url must not include /status/ path".into(),
        ));
    }
    validate_x_handle(&handle)?;
    Ok(())
}

/// X の post_url が正当なドメインかチェック
fn validate_x_post_url(url: &str) -> Result<(), AppError> {
    let parsed = parse_x_url(url)?;
    let (handle, has_status) = parse_x_path(&parsed)?;
    if !has_status {
        return Err(AppError::BadRequest(
            "post_url must include /status/{id}".into(),
        ));
    }
    validate_x_handle(&handle)?;
    Ok(())
}

/// X URL をパースして https + 許可ホストを検証する。
fn parse_x_url(url: &str) -> Result<reqwest::Url, AppError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|e| AppError::BadRequest(format!("invalid URL: {e}")))?;

    if parsed.scheme() != "https" {
        return Err(AppError::BadRequest("URL must use HTTPS".into()));
    }

    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !matches!(
        host.as_str(),
        "x.com" | "twitter.com" | "www.x.com" | "www.twitter.com" | "mobile.twitter.com"
    ) {
        return Err(AppError::BadRequest(
            "URL host must be x.com or twitter.com".into(),
        ));
    }

    Ok(parsed)
}

/// URLパスから handle と status投稿URLかどうかを抽出する。
fn parse_x_path(parsed: &reqwest::Url) -> Result<(String, bool), AppError> {
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|it| it.filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();

    if segments.is_empty() {
        return Err(AppError::BadRequest("URL path is empty".into()));
    }

    // /{handle}
    if segments.len() == 1 {
        return Ok((segments[0].to_string(), false));
    }

    // /{handle}/status/{id}
    if segments.len() >= 3 && segments[1].eq_ignore_ascii_case("status") {
        return Ok((segments[0].to_string(), true));
    }

    Err(AppError::BadRequest("unsupported X URL path format".into()))
}

fn validate_x_handle(handle: &str) -> Result<(), AppError> {
    if handle.is_empty() || handle.len() > X_HANDLE_MAX_LEN {
        return Err(AppError::BadRequest("invalid X handle length".into()));
    }
    if !handle
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AppError::BadRequest("invalid X handle format".into()));
    }
    Ok(())
}

/// author_url からハンドルを抽出する。
fn extract_handle(author_url: &str) -> Result<String, AppError> {
    let parsed = parse_x_url(author_url)?;
    let (handle, has_status) = parse_x_path(&parsed)?;
    if has_status {
        return Err(AppError::BadRequest(
            "author_url must not include /status/ path".into(),
        ));
    }
    validate_x_handle(&handle)?;
    Ok(handle.to_ascii_lowercase())
}

// ---------------------------------------------------------------------------
// エンドポイント
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LinkAccountRequest {
    author_url: String,
    post_url: String,
    proof_json: String,
    signature: String,
}

#[derive(Serialize)]
struct LinkAccountResponse {
    handle: String,
}

async fn link_account(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
    Json(body): Json<LinkAccountRequest>,
) -> Result<(StatusCode, Json<LinkAccountResponse>), AppError> {
    validate_x_author_url(&body.author_url)?;
    validate_x_post_url(&body.post_url)?;

    let handle = extract_handle(&body.author_url)?;
    let existing = db::x::get_account(&state.pool, auth.user_id.as_str(), &handle).await?;
    let post_url = parse_x_url(&body.post_url)?;
    let (post_handle, _) = parse_x_path(&post_url)?;
    if !post_handle.eq_ignore_ascii_case(&handle) {
        return Err(AppError::BadRequest(
            "post_url handle does not match author_url handle".into(),
        ));
    }

    // PGP署名のサーバサイド検証
    let public_keys = xrypton_common::keys::PublicKeys::try_from(auth.signing_public_key.as_str())
        .map_err(|e| AppError::Internal(format!("failed to parse signing key: {e}")))?;

    let payload_bytes = public_keys
        .verify_and_extract(&body.signature)
        .map_err(|_| AppError::BadRequest("invalid PGP signature".into()))?;

    let payload_text = String::from_utf8(payload_bytes)
        .map_err(|_| AppError::BadRequest("signature payload is not valid UTF-8".into()))?;

    // proof_json を正規化して署名平文と比較
    let proof_value: serde_json::Value = serde_json::from_str(&body.proof_json)
        .map_err(|e| AppError::BadRequest(format!("invalid proof_json: {e}")))?;

    let expected = canonicalize_json(&proof_value);
    if payload_text != expected {
        return Err(AppError::BadRequest("signature content mismatch".into()));
    }

    // proof_json の author_url / url がリクエストと整合するか検証
    if let Some(obj) = proof_value.as_object() {
        let json_author_url = obj.get("author_url").and_then(|v| v.as_str()).unwrap_or("");
        let json_url = obj.get("url").and_then(|v| v.as_str()).unwrap_or("");
        if json_author_url != body.author_url || json_url != body.post_url {
            return Err(AppError::BadRequest(
                "proof_json fields do not match request".into(),
            ));
        }
    } else {
        return Err(AppError::BadRequest(
            "proof_json must be a JSON object".into(),
        ));
    }

    db::x::link_account(
        &state.pool,
        auth.user_id.as_str(),
        &handle,
        &body.author_url,
        &body.post_url,
        &expected,
        &body.signature,
    )
    .await?;

    let status = if existing.is_some() {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((status, Json(LinkAccountResponse { handle })))
}

async fn list_accounts(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::XAccountRow>>, AppError> {
    let accounts = db::x::list_accounts(&state.pool, auth.user_id.as_str()).await?;
    Ok(Json(accounts))
}

async fn unlink_account(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
    Path(handle): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted = db::x::unlink_account(&state.pool, auth.user_id.as_str(), &handle).await?;
    if !deleted {
        return Err(AppError::NotFound("X account link not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_x_author_url() {
        assert!(validate_x_author_url("https://twitter.com/example").is_ok());
        assert!(validate_x_author_url("https://x.com/example/").is_ok());
        assert!(validate_x_author_url("https://x.com/example").is_ok());
        assert!(validate_x_author_url("https://x.com/example/status/123").is_err());
        assert!(validate_x_author_url("http://x.com/example").is_err());
        assert!(validate_x_author_url("https://example.com/user").is_err());
    }

    #[test]
    fn test_validate_x_post_url() {
        assert!(validate_x_post_url("https://x.com/example/status/1234567890").is_ok());
        assert!(validate_x_post_url("https://twitter.com/example/status/1234567890").is_ok());
        assert!(validate_x_post_url("https://x.com/example/").is_err());
        assert!(validate_x_post_url("https://x.com/example").is_err());
    }

    #[test]
    fn test_extract_handle() {
        assert_eq!(
            extract_handle("https://twitter.com/example").unwrap(),
            "example"
        );
        assert_eq!(extract_handle("https://x.com/Example").unwrap(), "example");
        assert_eq!(extract_handle("https://x.com/example/").unwrap(), "example");
        assert!(extract_handle("https://x.com/example/status/1").is_err());
    }

    #[test]
    fn test_parse_x_path() {
        let author = reqwest::Url::parse("https://x.com/example").unwrap();
        assert_eq!(
            parse_x_path(&author).unwrap(),
            ("example".to_string(), false)
        );

        let post = reqwest::Url::parse("https://x.com/example/status/123").unwrap();
        assert_eq!(parse_x_path(&post).unwrap(), ("example".to_string(), true));
    }

    #[test]
    fn test_post_author_handle_mismatch() {
        let author_handle = extract_handle("https://x.com/example").unwrap();
        let post_url = parse_x_url("https://x.com/other/status/123").unwrap();
        let (post_handle, is_status) = parse_x_path(&post_url).unwrap();
        assert!(is_status);
        assert!(!post_handle.eq_ignore_ascii_case(&author_handle));
    }
}
