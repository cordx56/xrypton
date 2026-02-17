use std::collections::HashMap;
use std::net::IpAddr;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;

pub fn routes() -> Router<AppState> {
    Router::new()
        // DID解決プロキシ（認証不要）
        .route("/atproto/handle/{handle}", get(resolve_handle))
        .route("/atproto/did/{did}", get(resolve_did))
        // ATprotoアカウント紐付け（認証必要）
        .route("/atproto/account", get(list_accounts).post(link_account))
        .route("/atproto/account/{did}", delete(unlink_account))
        // XRPCプロキシ（認証不要、中継のみ）
        .route("/atproto/proxy", post(xrpc_proxy))
        // 署名管理
        .route(
            "/atproto/signature",
            get(get_signature).post(save_signature),
        )
        .route("/atproto/signature/batch", get(get_signatures_batch))
        .route(
            "/atproto/signature/user/{user_id}",
            get(get_user_signatures),
        )
}

// ---------------------------------------------------------------------------
// クエリ文字列ユーティリティ
// ---------------------------------------------------------------------------

/// クエリ文字列の構造に影響する文字のみをパーセントエンコードする。
///
/// `application/x-www-form-urlencoded` は `:` `/` `@` 等もエンコードするが、
/// AT Protocol URI などではこれらを保持する必要がある。
/// この関数はクエリ文字列のパースを壊す `%` `&` `#` `=` のみをエスケープする。
fn encode_query_value(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace('&', "%26")
        .replace('#', "%23")
        .replace('=', "%3D")
}

/// key=value ペアのイテレータからクエリ文字列を構築する。
/// 値には [`encode_query_value`] による最小限エスケープのみ適用する。
fn build_query_string<'a>(pairs: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    pairs
        .map(|(k, v)| format!("{}={}", encode_query_value(k), encode_query_value(v)))
        .collect::<Vec<_>>()
        .join("&")
}

// ---------------------------------------------------------------------------
// SSRF防止ユーティリティ
// ---------------------------------------------------------------------------

/// IPアドレスがプライベートレンジに該当するか判定する
fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                // fc00::/7 (Unique Local Address)
                || (seg0 & 0xfe00) == 0xfc00
                // fe80::/10 (Link-local unicast)
                || (seg0 & 0xffc0) == 0xfe80
                || v6.is_multicast()
        }
    }
}

/// URLのホストがプライベートIPでないことを検証する
pub(crate) async fn validate_url_not_private(url: &str) -> Result<(), AppError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|e| AppError::BadRequest(format!("invalid URL: {e}")))?;

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::BadRequest("URL has no host".into()))?;

    // IPアドレスを直接パースできる場合はそのまま判定
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(&ip) {
            return Err(AppError::BadRequest(
                "private IP address not allowed".into(),
            ));
        }
        return Ok(());
    }

    // DNS解決してIPアドレスをチェック
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addr = format!("{host}:{port}");
    let addrs = tokio::net::lookup_host(&addr)
        .await
        .map_err(|e| AppError::BadRequest(format!("DNS resolution failed for {host}: {e}")))?;

    for socket_addr in addrs {
        if is_private_ip(&socket_addr.ip()) {
            return Err(AppError::BadRequest(
                "private IP address not allowed".into(),
            ));
        }
    }
    Ok(())
}

async fn read_response_limited(
    mut resp: reqwest::Response,
    max_response_size: usize,
) -> Result<Vec<u8>, AppError> {
    let mut out = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::BadGateway(format!("failed to read response: {e}")))?
    {
        out.extend_from_slice(&chunk);
        if out.len() > max_response_size {
            return Err(AppError::BadGateway("response too large".into()));
        }
    }
    Ok(out)
}

/// SSRF安全なHTTP GETリクエストを送信する
pub(crate) async fn ssrf_safe_get(
    url: &str,
    max_response_size: usize,
) -> Result<Vec<u8>, AppError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let mut current =
        reqwest::Url::parse(url).map_err(|e| AppError::BadRequest(format!("invalid URL: {e}")))?;
    for _ in 0..=3 {
        validate_url_not_private(current.as_str()).await?;
        let resp = client
            .get(current.clone())
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("request failed: {e}")))?;

        if resp.status().is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .ok_or_else(|| AppError::BadGateway("redirect without location".into()))?
                .to_str()
                .map_err(|_| AppError::BadGateway("invalid redirect location".into()))?;
            current = current
                .join(location)
                .map_err(|e| AppError::BadGateway(format!("invalid redirect URL: {e}")))?;
            continue;
        }

        if !resp.status().is_success() {
            return Err(AppError::BadGateway(format!(
                "upstream returned {}",
                resp.status()
            )));
        }

        return read_response_limited(resp, max_response_size).await;
    }

    Err(AppError::BadGateway("too many redirects".into()))
}

// ---------------------------------------------------------------------------
// JSON正規化
// ---------------------------------------------------------------------------

/// serde_json::Value を再帰的にキーソートしてJSON文字列を返す。
/// ATPROTO_COMMON.md で定義されたJSON正規化アルゴリズムに準拠。
pub(crate) fn canonicalize_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => serde_json::to_string(s).unwrap(),
        serde_json::Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(canonicalize_json).collect();
            format!("[{}]", items.join(","))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let entries: Vec<String> = keys
                .iter()
                .map(|k| {
                    let key_str = serde_json::to_string(*k).unwrap();
                    let val_str = canonicalize_json(&map[*k]);
                    format!("{key_str}:{val_str}")
                })
                .collect();
            format!("{{{}}}", entries.join(","))
        }
    }
}

// ---------------------------------------------------------------------------
// バリデーションヘルパー
// ---------------------------------------------------------------------------

/// DIDフォーマットの検証
fn validate_did(did: &str) -> Result<(), AppError> {
    if let Some(suffix) = did.strip_prefix("did:plc:") {
        if suffix.len() == 24
            && suffix
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return Ok(());
        }
        return Err(AppError::BadRequest("invalid did:plc format".into()));
    }
    if let Some(domain) = did.strip_prefix("did:web:") {
        if !domain.is_empty() && domain.contains('.') {
            return Ok(());
        }
        return Err(AppError::BadRequest("invalid did:web format".into()));
    }
    Err(AppError::BadRequest(
        "DID must start with did:plc: or did:web:".into(),
    ))
}

/// ATproto URI形式の検証 (at://did:.../collection/rkey)
fn validate_at_uri(uri: &str) -> Result<(), AppError> {
    if !uri.starts_with("at://") {
        return Err(AppError::BadRequest(
            "ATproto URI must start with at://".into(),
        ));
    }
    let parts: Vec<&str> = uri[5..].splitn(3, '/').collect();
    if parts.len() < 3 {
        return Err(AppError::BadRequest("invalid ATproto URI format".into()));
    }
    Ok(())
}

/// NSID形式の検証 (e.g. app.bsky.feed.post)
fn validate_nsid(nsid: &str) -> Result<(), AppError> {
    let parts: Vec<&str> = nsid.split('.').collect();
    if parts.len() < 3 {
        return Err(AppError::BadRequest("invalid NSID format".into()));
    }
    for part in &parts {
        if part.is_empty() || !part.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(AppError::BadRequest("invalid NSID format".into()));
        }
    }
    Ok(())
}

/// ハンドル形式の検証
fn validate_handle(handle: &str) -> Result<(), AppError> {
    if handle.is_empty() || handle.len() > 253 {
        return Err(AppError::BadRequest("invalid handle length".into()));
    }
    if !handle
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(AppError::BadRequest("invalid handle characters".into()));
    }
    Ok(())
}

#[cfg(not(feature = "postgres"))]
fn sqlite_timestamp_to_cursor(ts: &str) -> Option<String> {
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|naive| {
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        })
}

#[cfg(not(feature = "postgres"))]
fn cursor_to_sqlite_timestamp(cursor: &str) -> Result<String, AppError> {
    chrono::DateTime::parse_from_rfc3339(cursor)
        .map(|dt| {
            dt.with_timezone(&chrono::Utc)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(cursor, "%Y-%m-%d %H:%M:%S")
                .map(|naive| naive.format("%Y-%m-%d %H:%M:%S").to_string())
        })
        .map_err(|_| AppError::BadRequest("cursor must be ISO 8601 datetime".into()))
}

// ---------------------------------------------------------------------------
// DID解決プロキシ
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ResolveHandleResponse {
    did: String,
}

/// ハンドルからDIDを解決する
async fn resolve_handle(
    Path(handle): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ResolveHandleResponse>, AppError> {
    validate_handle(&handle)?;

    // キャッシュチェック
    let cache_key = format!("handle:{handle}");
    if let Some(cached) = state.did_cache.get(&cache_key).await
        && let Some(did) = cached.as_str()
    {
        return Ok(Json(ResolveHandleResponse {
            did: did.to_string(),
        }));
    }

    // HTTPS well-known を優先
    let well_known_url = format!("https://{handle}/.well-known/atproto-did");
    let did = match ssrf_safe_get(&well_known_url, 10 * 1024).await {
        Ok(bytes) => {
            let text = String::from_utf8(bytes)
                .map_err(|_| AppError::BadGateway("invalid utf-8 in response".into()))?;
            let did = text.trim().to_string();
            if did.starts_with("did:plc:") || did.starts_with("did:web:") {
                Some(did)
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let did = match did {
        Some(d) => d,
        None => {
            // DNS TXTレコードにフォールバック
            resolve_handle_via_dns(&handle).await?
        }
    };

    // キャッシュに保存
    state
        .did_cache
        .set(cache_key, serde_json::Value::String(did.clone()))
        .await;

    Ok(Json(ResolveHandleResponse { did }))
}

/// DNS TXTレコードからDIDを解決する
async fn resolve_handle_via_dns(handle: &str) -> Result<String, AppError> {
    let resolver = hickory_resolver::TokioResolver::builder_tokio()
        .map_err(|e| AppError::Internal(format!("DNS resolver error: {e}")))?
        .build();

    let lookup_name = format!("_atproto.{handle}");
    let response = resolver
        .txt_lookup(lookup_name.as_str())
        .await
        .map_err(|_| AppError::NotFound(format!("could not resolve handle: {handle}")))?;

    for txt in response.iter() {
        let raw = txt.to_string();
        if let Some(did) = raw.strip_prefix("did=") {
            let did = did.trim();
            if did.starts_with("did:plc:") || did.starts_with("did:web:") {
                return Ok(did.to_string());
            }
        }
    }

    Err(AppError::NotFound(format!(
        "no DID found for handle: {handle}"
    )))
}

#[derive(Serialize)]
struct ResolveDidResponse {
    did_document: serde_json::Value,
    pds_url: Option<String>,
}

/// DIDドキュメントを取得する
async fn resolve_did(
    Path(did): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<ResolveDidResponse>, AppError> {
    validate_did(&did)?;

    // キャッシュチェック
    let cache_key = format!("did:{did}");
    if let Some(cached) = state.did_cache.get(&cache_key).await {
        let pds_url = extract_pds_url(&cached);
        return Ok(Json(ResolveDidResponse {
            did_document: cached,
            pds_url,
        }));
    }

    let url = if did.starts_with("did:plc:") {
        format!("https://plc.directory/{did}")
    } else if let Some(domain) = did.strip_prefix("did:web:") {
        format!("https://{domain}/.well-known/did.json")
    } else {
        return Err(AppError::BadRequest("unsupported DID method".into()));
    };

    let bytes = ssrf_safe_get(&url, 10 * 1024).await?;
    let doc: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::BadGateway(format!("invalid JSON in DID document: {e}")))?;

    let pds_url = extract_pds_url(&doc);

    // キャッシュに保存
    state.did_cache.set(cache_key, doc.clone()).await;

    Ok(Json(ResolveDidResponse {
        did_document: doc,
        pds_url,
    }))
}

/// DIDドキュメントからPDSのservice URLを抽出する
pub(crate) fn extract_pds_url(doc: &serde_json::Value) -> Option<String> {
    doc.get("service")?
        .as_array()?
        .iter()
        .find(|s| {
            s.get("id").and_then(|v| v.as_str()) == Some("#atproto_pds")
                || s.get("type").and_then(|v| v.as_str()) == Some("AtprotoPersonalDataServer")
        })
        .and_then(|s| s.get("serviceEndpoint"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// ATprotoアカウント紐付け
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LinkAccountRequest {
    atproto_did: String,
    atproto_handle: Option<String>,
    pds_url: String,
}

async fn link_account(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
    Json(body): Json<LinkAccountRequest>,
) -> Result<StatusCode, AppError> {
    validate_did(&body.atproto_did)?;

    if !body.pds_url.starts_with("https://") {
        return Err(AppError::BadRequest("pds_url must use HTTPS".into()));
    }

    let existing =
        db::atproto::get_account(&state.pool, auth.user_id.as_str(), &body.atproto_did).await?;

    db::atproto::link_account(
        &state.pool,
        auth.user_id.as_str(),
        &body.atproto_did,
        body.atproto_handle.as_deref(),
        &body.pds_url,
    )
    .await?;

    if existing.is_some() {
        Ok(StatusCode::OK)
    } else {
        Ok(StatusCode::CREATED)
    }
}

async fn list_accounts(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<db::models::AtprotoAccountRow>>, AppError> {
    let accounts = db::atproto::list_accounts(&state.pool, auth.user_id.as_str()).await?;
    Ok(Json(accounts))
}

async fn unlink_account(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
    Path(did): Path<String>,
) -> Result<StatusCode, AppError> {
    let deleted = db::atproto::unlink_account(&state.pool, auth.user_id.as_str(), &did).await?;
    if !deleted {
        return Err(AppError::NotFound("account link not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// XRPCプロキシ
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ProxyRequest {
    pds_url: String,
    nsid: String,
    method: String,
    params: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
    authorization: String,
    dpop: String,
}

const PROXY_MAX_RESPONSE_SIZE: usize = 10 * 1024 * 1024; // 10MB
const PROXY_TIMEOUT_SECS: u64 = 30;

async fn xrpc_proxy(Json(body): Json<ProxyRequest>) -> Result<Response, AppError> {
    if !body.pds_url.starts_with("https://") {
        return Err(AppError::BadRequest("pds_url must use HTTPS".into()));
    }
    validate_nsid(&body.nsid)?;
    validate_url_not_private(&body.pds_url).await?;

    let base_url = format!("{}/xrpc/{}", body.pds_url.trim_end_matches('/'), body.nsid);

    let url = if let Some(params) = &body.params
        && !params.is_empty()
    {
        let qs = build_query_string(params.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        format!("{base_url}?{qs}")
    } else {
        base_url
    };

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(PROXY_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client error: {e}")))?;

    let req = match body.method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => {
            let mut r = client.post(&url);
            if let Some(json_body) = &body.body {
                r = r.json(json_body);
            }
            r
        }
        _ => return Err(AppError::BadRequest("method must be GET or POST".into())),
    };

    let resp = req
        .header("Authorization", &body.authorization)
        .header("DPoP", &body.dpop)
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("proxy request failed: {e}")))?;

    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let headers = resp.headers().clone();
    let resp_bytes = read_response_limited(resp, PROXY_MAX_RESPONSE_SIZE).await?;

    let mut response = (status, resp_bytes.to_vec()).into_response();
    // Content-Typeヘッダーを転送
    if let Some(ct) = headers.get("content-type") {
        response.headers_mut().insert("content-type", ct.clone());
    }
    Ok(response)
}

// ---------------------------------------------------------------------------
// 署名管理
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SaveSignatureRequest {
    atproto_did: String,
    atproto_uri: String,
    atproto_cid: String,
    collection: String,
    record_json: String,
    signature: String,
    /// trueの場合、この投稿を公開鍵検証投稿としてDBに記録する
    #[serde(default)]
    is_pubkey_post: bool,
}

#[derive(Serialize)]
struct SaveSignatureResponse {
    id: String,
}

async fn save_signature(
    auth: AuthenticatedUser,
    State(state): State<AppState>,
    Json(body): Json<SaveSignatureRequest>,
) -> Result<(StatusCode, Json<SaveSignatureResponse>), AppError> {
    // バリデーション
    validate_did(&body.atproto_did)?;
    validate_at_uri(&body.atproto_uri)?;
    validate_nsid(&body.collection)?;

    if !body.atproto_cid.starts_with("bafyrei") {
        return Err(AppError::BadRequest("invalid CID format".into()));
    }

    // DID紐付け検証: 認証ユーザ自身がこのDIDを紐付けているか確認
    db::atproto::get_account(&state.pool, auth.user_id.as_str(), &body.atproto_did)
        .await?
        .ok_or_else(|| AppError::Forbidden("DID is not linked to your account".into()))?;

    // PGP署名のサーバサイド検証
    let public_keys = crypton_common::keys::PublicKeys::try_from(auth.signing_public_key.as_str())
        .map_err(|e| AppError::Internal(format!("failed to parse signing key: {e}")))?;

    let payload_bytes = public_keys
        .verify_and_extract(&body.signature)
        .map_err(|_| AppError::BadRequest("invalid PGP signature".into()))?;

    // 署名平文の照合: record_jsonを正規化して比較
    // フロントエンドは record_json に完全な署名対象データ {cid, record, uri} を送信する
    let payload_text = String::from_utf8(payload_bytes)
        .map_err(|_| AppError::BadRequest("signature payload is not valid UTF-8".into()))?;

    let record_value: serde_json::Value = serde_json::from_str(&body.record_json)
        .map_err(|e| AppError::BadRequest(format!("invalid record_json: {e}")))?;

    // record_json を正規化して署名平文と比較
    let expected_target = canonicalize_json(&record_value);

    if payload_text != expected_target {
        return Err(AppError::BadRequest("signature content mismatch".into()));
    }

    // record_json に含まれる cid, uri がリクエストの他フィールドと整合することを検証
    if let Some(obj) = record_value.as_object() {
        let json_cid = obj.get("cid").and_then(|v| v.as_str()).unwrap_or("");
        let json_uri = obj.get("uri").and_then(|v| v.as_str()).unwrap_or("");
        if json_cid != body.atproto_cid || json_uri != body.atproto_uri {
            return Err(AppError::BadRequest(
                "record_json cid/uri does not match request fields".into(),
            ));
        }
    } else {
        return Err(AppError::BadRequest(
            "record_json must be a JSON object".into(),
        ));
    }

    // 重複チェック
    if db::atproto::signature_exists(&state.pool, &body.atproto_uri, &body.atproto_cid).await? {
        return Err(AppError::Conflict(
            "signature already exists for this URI and CID".into(),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    db::atproto::save_signature(
        &state.pool,
        &db::atproto::NewSignature {
            id: &id,
            user_id: auth.user_id.as_str(),
            atproto_did: &body.atproto_did,
            atproto_uri: &body.atproto_uri,
            atproto_cid: &body.atproto_cid,
            collection: &body.collection,
            record_json: &expected_target,
            signature: &body.signature,
        },
    )
    .await?;

    // 公開鍵検証投稿の場合、URIをアカウントに記録
    if body.is_pubkey_post {
        db::atproto::set_pubkey_post_uri(
            &state.pool,
            auth.user_id.as_str(),
            &body.atproto_did,
            &body.atproto_uri,
        )
        .await?;
    }

    Ok((StatusCode::CREATED, Json(SaveSignatureResponse { id })))
}

#[derive(Deserialize)]
struct GetSignatureQuery {
    uri: String,
    cid: Option<String>,
}

#[derive(Serialize)]
struct GetSignatureResponse {
    signatures: Vec<db::models::AtprotoSignatureWithKeyRow>,
}

/// URI指定で署名を取得する（公開API）
async fn get_signature(
    State(state): State<AppState>,
    Query(query): Query<GetSignatureQuery>,
) -> Result<Json<GetSignatureResponse>, AppError> {
    let sigs =
        db::atproto::get_signatures_by_uri(&state.pool, &query.uri, query.cid.as_deref()).await?;
    Ok(Json(GetSignatureResponse { signatures: sigs }))
}

#[derive(Deserialize)]
struct BatchQuery {
    #[serde(default)]
    uris: Vec<String>,
}

#[derive(Serialize)]
struct BatchSignatureResponse {
    signatures: HashMap<String, Vec<db::models::AtprotoSignatureWithKeyRow>>,
}

/// 複数URIの署名を一括取得する（公開API）
/// フロントエンドは ?uris=...&uris=... の形式で送信する
async fn get_signatures_batch(
    State(state): State<AppState>,
    axum_extra::extract::Query(query): axum_extra::extract::Query<BatchQuery>,
) -> Result<Json<BatchSignatureResponse>, AppError> {
    let uri_strs: Vec<&str> = query.uris.iter().map(|s| s.as_str()).collect();
    if uri_strs.len() > 100 {
        return Err(AppError::BadRequest(
            "maximum 100 URIs per batch request".into(),
        ));
    }

    let rows = db::atproto::get_signatures_by_uris(&state.pool, &uri_strs).await?;

    // URI → 署名配列のマップに変換
    let mut map: HashMap<String, Vec<db::models::AtprotoSignatureWithKeyRow>> = HashMap::new();
    for uri in &uri_strs {
        map.insert(uri.to_string(), vec![]);
    }
    for row in rows {
        map.entry(row.atproto_uri.clone()).or_default().push(row);
    }

    Ok(Json(BatchSignatureResponse { signatures: map }))
}

#[derive(Deserialize)]
struct UserSignatureQuery {
    collection: Option<String>,
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Serialize)]
struct UserSignatureResponse {
    signatures: Vec<db::models::AtprotoSignatureRow>,
    cursor: Option<String>,
}

/// ユーザの署名一覧を取得する（公開API）
async fn get_user_signatures(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Query(query): Query<UserSignatureQuery>,
) -> Result<Json<UserSignatureResponse>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    #[cfg(not(feature = "postgres"))]
    let db_cursor = query
        .cursor
        .as_deref()
        .map(cursor_to_sqlite_timestamp)
        .transpose()?;
    #[cfg(feature = "postgres")]
    let db_cursor = query.cursor.clone();

    let sigs = db::atproto::get_signatures_by_user(
        &state.pool,
        &user_id,
        query.collection.as_deref(),
        limit,
        db_cursor.as_deref(),
    )
    .await?;

    #[cfg(not(feature = "postgres"))]
    let next_cursor = sigs
        .last()
        .and_then(|s| sqlite_timestamp_to_cursor(&s.created_at))
        .or_else(|| sigs.last().map(|s| s.created_at.clone()));
    #[cfg(feature = "postgres")]
    let next_cursor = sigs.last().map(|s| {
        s.created_at
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
    });

    Ok(Json(UserSignatureResponse {
        signatures: sigs,
        cursor: next_cursor,
    }))
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonicalize_empty_object() {
        let v: serde_json::Value = serde_json::json!({});
        assert_eq!(canonicalize_json(&v), "{}");
    }

    #[test]
    fn test_canonicalize_key_sort() {
        let v: serde_json::Value = serde_json::json!({"b": 2, "a": 1});
        assert_eq!(canonicalize_json(&v), r#"{"a":1,"b":2}"#);
    }

    #[test]
    fn test_canonicalize_nested() {
        let v: serde_json::Value = serde_json::json!({"z": {"b": 2, "a": 1}, "a": "x"});
        assert_eq!(canonicalize_json(&v), r#"{"a":"x","z":{"a":1,"b":2}}"#);
    }

    #[test]
    fn test_canonicalize_array_order_preserved() {
        let v: serde_json::Value = serde_json::json!({"items": [3, 1, 2]});
        assert_eq!(canonicalize_json(&v), r#"{"items":[3,1,2]}"#);
    }

    #[test]
    fn test_canonicalize_special_chars() {
        let v: serde_json::Value = serde_json::json!({"msg": "hello\nworld"});
        assert_eq!(canonicalize_json(&v), r#"{"msg":"hello\nworld"}"#);
    }

    #[test]
    fn test_canonicalize_atproto_record() {
        let v: serde_json::Value = serde_json::json!({
            "cid": "bafyreiexample",
            "record": {
                "$type": "app.bsky.feed.post",
                "text": "Hello",
                "createdAt": "2026-02-16T00:00:00.000Z",
                "langs": ["ja"]
            },
            "uri": "at://did:plc:xxx/app.bsky.feed.post/yyy"
        });
        let expected = r#"{"cid":"bafyreiexample","record":{"$type":"app.bsky.feed.post","createdAt":"2026-02-16T00:00:00.000Z","langs":["ja"],"text":"Hello"},"uri":"at://did:plc:xxx/app.bsky.feed.post/yyy"}"#;
        assert_eq!(canonicalize_json(&v), expected);
    }

    #[test]
    fn test_canonicalize_null() {
        let v: serde_json::Value = serde_json::json!({"a": null, "b": 1});
        assert_eq!(canonicalize_json(&v), r#"{"a":null,"b":1}"#);
    }

    #[test]
    fn test_canonicalize_boolean() {
        let v: serde_json::Value = serde_json::json!({"flag": true, "other": false});
        assert_eq!(canonicalize_json(&v), r#"{"flag":true,"other":false}"#);
    }

    #[test]
    fn test_canonicalize_empty_containers() {
        let v: serde_json::Value = serde_json::json!({"arr": [], "obj": {}});
        assert_eq!(canonicalize_json(&v), r#"{"arr":[],"obj":{}}"#);
    }

    #[test]
    fn test_canonicalize_unicode() {
        let v: serde_json::Value = serde_json::json!({"emoji": "🔑", "日本語": "テスト"});
        assert_eq!(canonicalize_json(&v), r#"{"emoji":"🔑","日本語":"テスト"}"#);
    }

    #[test]
    fn test_validate_did_plc() {
        assert!(validate_did("did:plc:abcdefghijklmnopqrstuvwx").is_ok());
        assert!(validate_did("did:plc:short").is_err());
        assert!(validate_did("did:plc:ABCDEFGHIJKLMNOPQRSTUVWX").is_err());
    }

    #[test]
    fn test_validate_did_web() {
        assert!(validate_did("did:web:example.com").is_ok());
        assert!(validate_did("did:web:").is_err());
    }

    #[test]
    fn test_validate_did_unknown() {
        assert!(validate_did("did:key:z6Mk...").is_err());
    }

    #[test]
    fn test_validate_at_uri() {
        assert!(validate_at_uri("at://did:plc:xxx/app.bsky.feed.post/yyy").is_ok());
        assert!(validate_at_uri("https://example.com").is_err());
        assert!(validate_at_uri("at://did:plc:xxx").is_err());
    }

    #[test]
    fn test_validate_nsid() {
        assert!(validate_nsid("app.bsky.feed.post").is_ok());
        assert!(validate_nsid("com.atproto.repo.createRecord").is_ok());
        assert!(validate_nsid("invalid").is_err());
        assert!(validate_nsid("a.b").is_err());
    }

    #[test]
    fn test_validate_handle() {
        assert!(validate_handle("alice.bsky.social").is_ok());
        assert!(validate_handle("test-user.example.com").is_ok());
        assert!(validate_handle("").is_err());
        assert!(validate_handle("a b c").is_err());
    }

    #[test]
    fn test_encode_query_value_preserves_at_uri() {
        // AT Protocol URI の : / @ はそのまま保持される
        let uri = "at://did:plc:xyz123abc456def789/app.bsky.feed.post/abc";
        assert_eq!(encode_query_value(uri), uri);
    }

    #[test]
    fn test_encode_query_value_escapes_structural_chars() {
        assert_eq!(encode_query_value("a&b"), "a%26b");
        assert_eq!(encode_query_value("a=b"), "a%3Db");
        assert_eq!(encode_query_value("a#b"), "a%23b");
        assert_eq!(encode_query_value("100%"), "100%25");
    }

    #[test]
    fn test_build_query_string() {
        let qs = build_query_string(
            [
                ("uri", "at://did:plc:xxx/app.bsky.feed.post/yyy"),
                ("depth", "6"),
            ]
            .into_iter(),
        );
        assert_eq!(qs, "uri=at://did:plc:xxx/app.bsky.feed.post/yyy&depth=6");
    }

    #[test]
    fn test_is_private_ip() {
        assert!(is_private_ip(&"127.0.0.1".parse().unwrap()));
        assert!(is_private_ip(&"10.0.0.1".parse().unwrap()));
        assert!(is_private_ip(&"192.168.1.1".parse().unwrap()));
        assert!(is_private_ip(&"172.16.0.1".parse().unwrap()));
        assert!(is_private_ip(&"::1".parse().unwrap()));
        assert!(is_private_ip(&"fc00::1".parse().unwrap()));
        assert!(is_private_ip(&"fe80::1".parse().unwrap()));
        assert!(!is_private_ip(&"8.8.8.8".parse().unwrap()));
        assert!(!is_private_ip(&"1.1.1.1".parse().unwrap()));
    }

    #[test]
    fn test_extract_pds_url() {
        let doc = serde_json::json!({
            "service": [
                {
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://bsky.social"
                }
            ]
        });
        assert_eq!(
            extract_pds_url(&doc),
            Some("https://bsky.social".to_string())
        );
    }

    #[test]
    fn test_extract_pds_url_missing() {
        let doc = serde_json::json!({"service": []});
        assert_eq!(extract_pds_url(&doc), None);
    }

    #[cfg(not(feature = "postgres"))]
    #[test]
    fn test_sqlite_timestamp_to_cursor() {
        assert_eq!(
            sqlite_timestamp_to_cursor("2026-02-16 00:00:00"),
            Some("2026-02-16T00:00:00Z".to_string())
        );
    }

    #[cfg(not(feature = "postgres"))]
    #[test]
    fn test_cursor_to_sqlite_timestamp() {
        assert_eq!(
            cursor_to_sqlite_timestamp("2026-02-16T09:10:11+09:00").unwrap(),
            "2026-02-16 00:10:11".to_string()
        );
    }
}
