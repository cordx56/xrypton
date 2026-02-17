use atrium_api::client::AtpServiceClient;
use atrium_api::com::atproto::repo::get_record;
use atrium_api::types::string::{Did, Nsid, RecordKey};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::{HeaderMap, header};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::db::models::ExternalAccount;
use crate::error::AppError;
use crate::types::UserId;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/user/{id}/keys",
            get(get_keys)
                .post(post_keys)
                .put(update_keys)
                .delete(delete_user),
        )
        .route("/user/{id}/profile", get(get_profile).post(update_profile))
        .route(
            "/user/{id}/icon",
            get(get_icon)
                .post(upload_icon)
                .layer(DefaultBodyLimit::max(6 * 1024 * 1024)),
        )
}

#[derive(Deserialize)]
struct PostKeysBody {
    encryption_public_key: String,
    signing_public_key: String,
}

/// ユーザ登録（認証不要）
///
/// カスタムドメイン対応: `user@custom-domain` 形式のIDが渡された場合、
/// DNS TXTレコード（`_xrypton.custom-domain`）を検証し、解決先が自サーバであれば
/// ローカルユーザとして登録する。
async fn post_keys(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PostKeysBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = if let Some((local_part, domain)) = id.split_once('@') {
        // DNS解決を試み、自サーバへの解決を確認する。
        // DNS Mapped → 元ドメインを保持して保存（カスタムドメイン対応）。
        // DNS Original → server_hostname を付与して保存。
        match state.dns_resolver.resolve(domain, local_part).await {
            crate::federation::dns::ResolvedDomain::Mapped {
                local_part: resolved_local,
                domain: resolved_domain,
            } => {
                if resolved_domain == state.config.server_hostname {
                    // 元のドメインを保持: alice@custom.com → alice@custom.com
                    UserId::new_local(&resolved_local, domain)
                        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?
                } else {
                    return Err(AppError::BadRequest(
                        "domain does not resolve to this server".into(),
                    ));
                }
            }
            // DNSマッピングなし
            crate::federation::dns::ResolvedDomain::Original => {
                if domain != state.config.server_hostname {
                    // カスタムドメインを明示指定しているのにDNSマッピングがない → 拒否
                    return Err(AppError::BadRequest(
                        "DNS mapping not found for this domain".into(),
                    ));
                }
                UserId::new_local(local_part, &state.config.server_hostname)
                    .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?
            }
        }
    } else {
        UserId::new_local(&id, &state.config.server_hostname)
            .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?
    };

    // signing key ID を抽出して検証
    let public_keys = xrypton_common::keys::PublicKeys::try_from(body.signing_public_key.as_str())
        .map_err(|e| AppError::BadRequest(format!("invalid signing public key: {e}")))?;
    let signing_key_id = public_keys
        .get_signing_sub_key_id()
        .map_err(|e| AppError::BadRequest(format!("failed to get signing key id: {e}")))?;

    // PGP公開鍵のユーザIDが登録IDと一致するか検証（ドメインだけでなく名前も確認）
    let key_address = public_keys
        .get_primary_user_address()
        .map_err(|e| AppError::BadRequest(format!("invalid signing key user ID: {e}")))?;
    if key_address != user_id.as_str() {
        return Err(AppError::BadRequest(format!(
            "signing key user ID ({key_address}) does not match registration ID ({})",
            user_id.as_str()
        )));
    }

    let existing = db::users::get_user(&state.pool, &user_id).await?;
    if existing.is_some() {
        return Err(AppError::Conflict("user already exists".into()));
    }

    db::users::create_user(
        &state.pool,
        &user_id,
        &body.encryption_public_key,
        &body.signing_public_key,
        &signing_key_id,
    )
    .await?;

    Ok(Json(serde_json::json!({ "id": user_id.as_str() })))
}

/// 公開鍵更新（認証必要）
async fn update_keys(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
    Json(body): Json<PostKeysBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = UserId::resolve_local(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    if auth.user_id != user_id {
        return Err(AppError::Forbidden("can only update own keys".into()));
    }

    let public_keys = xrypton_common::keys::PublicKeys::try_from(body.signing_public_key.as_str())
        .map_err(|e| AppError::BadRequest(format!("invalid signing public key: {e}")))?;
    let signing_key_id = public_keys
        .get_signing_sub_key_id()
        .map_err(|e| AppError::BadRequest(format!("failed to get signing key id: {e}")))?;

    let updated = db::users::update_user_keys(
        &state.pool,
        &user_id,
        &body.encryption_public_key,
        &body.signing_public_key,
        &signing_key_id,
    )
    .await?;

    if !updated {
        return Err(AppError::NotFound("user not found".into()));
    }

    Ok(Json(serde_json::json!({ "id": user_id.as_str() })))
}

/// ローカルユーザの公開鍵をJSON形式で返すヘルパー
async fn fetch_local_user_keys(
    state: &AppState,
    user_id: &UserId,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = db::users::get_user(&state.pool, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".into()))?;
    Ok(Json(serde_json::json!({
        "id": user.id,
        "encryption_public_key": user.encryption_public_key,
        "signing_public_key": user.signing_public_key,
        "signing_key_id": user.signing_key_id,
    })))
}

/// 公開鍵取得（認証必須 — 連合対応）
///
/// AuthenticatedUser extractorを使わず手動で認証を行う。
/// 連合3ホップ目のコールバック（認証ユーザ自身の鍵要求でnonce再利用）のみ許可する。
/// それ以外のnonce再利用はリプレイ攻撃（ユーザ存在の総当たり検索）を防ぐため拒否する。
async fn get_keys(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let auth_header_raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("missing authorization header".into()))?;

    let result = crate::auth::authenticate(
        &state.pool,
        &state.config,
        &state.dns_resolver,
        auth_header_raw,
    )
    .await?;
    let auth = result.user;

    // nonce再利用の場合、連合3ホップ目のコールバックパターンのみ許可:
    // パスIDを正規化して認証ユーザ自身の鍵を要求している場合。
    // 自身の鍵取得なので新たな情報漏洩はなく、安全。
    if !result.nonce_is_new {
        let normalized = UserId::resolve(&id, &state.config.server_hostname)
            .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
        if normalized == auth.user_id {
            return fetch_local_user_keys(&state, &normalized).await;
        }
        return Err(AppError::Unauthorized("nonce already used".into()));
    }

    // CASE A: リクエストIDに@あり
    if let Some((local_part, domain)) = id.split_once('@') {
        // DNS TXTレコードによるドメイン解決
        let (resolved_local, resolved_domain) =
            match state.dns_resolver.resolve(domain, local_part).await {
                crate::federation::dns::ResolvedDomain::Mapped {
                    local_part: rl,
                    domain: rd,
                } => {
                    tracing::debug!("DNS resolved {local_part}@{domain} -> {rl}@{rd}");
                    (rl, rd)
                }
                crate::federation::dns::ResolvedDomain::Original => {
                    (local_part.to_string(), domain.to_string())
                }
            };

        if resolved_domain == state.config.server_hostname {
            // DNS解決後のドメインが自サーバ → 元ドメインを保持してローカル検索
            let user_id = UserId::new_local(&resolved_local, domain)
                .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
            return fetch_local_user_keys(&state, &user_id).await;
        }

        // DNS解決がOriginalでも、リクエストIDでDBに存在すればローカルとして返す
        // （DNS一時障害時のフォールバック）
        let raw_user_id = UserId::validate_full(&id)
            .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
        if let Ok(keys) = fetch_local_user_keys(&state, &raw_user_id).await {
            return Ok(keys);
        }

        // 外部サーバのユーザ → 連合リクエスト（DNS解決後のドメインで取得）
        let remote_keys = crate::federation::client::fetch_user_keys(
            &resolved_domain,
            &resolved_local,
            &auth.raw_auth_header,
            state.config.federation_allow_http,
        )
        .await?;

        // キャッシュとしてローカルに保存（元のIDを維持）
        let full_id = format!("{local_part}@{domain}");
        let public_keys =
            xrypton_common::keys::PublicKeys::try_from(remote_keys.signing_public_key.as_str())
                .map_err(|e| AppError::BadGateway(format!("invalid remote signing key: {e}")))?;
        let remote_signing_key_id = public_keys
            .get_signing_sub_key_id()
            .map_err(|e| AppError::BadGateway(format!("failed to get remote key id: {e}")))?;
        db::users::upsert_external_user(
            &state.pool,
            &full_id,
            &remote_keys.encryption_public_key,
            &remote_keys.signing_public_key,
            &remote_signing_key_id,
        )
        .await?;

        return Ok(Json(serde_json::json!({
            "id": remote_keys.id,
            "encryption_public_key": remote_keys.encryption_public_key,
            "signing_public_key": remote_keys.signing_public_key,
            "signing_key_id": remote_keys.signing_key_id,
        })));
    }

    // CASE B: リクエストIDに@なし → server_hostname付きでローカル検索
    let user_id = UserId::new_local(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    fetch_local_user_keys(&state, &user_id).await
}

async fn delete_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = UserId::resolve_local(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    if auth.user_id != user_id {
        return Err(AppError::Forbidden("can only delete own account".into()));
    }
    db::users::delete_user(&state.pool, &user_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// ATProtoアカウント等から外部アカウント情報を構築する。
/// 公開鍵投稿の署名を検証し、成功した場合のみ validated=true にする。
async fn build_external_accounts(state: &AppState, user_id: &str) -> Vec<ExternalAccount> {
    let accounts = db::atproto::list_accounts(&state.pool, user_id)
        .await
        .unwrap_or_default();

    let mut result = Vec::with_capacity(accounts.len());
    for a in accounts {
        let validated = match &a.pubkey_post_uri {
            Some(uri) => verify_pubkey_post(&state.pool, uri, &a.pds_url).await,
            None => false,
        };
        result.push(ExternalAccount::Atproto {
            validated,
            did: a.atproto_did,
            handle: a.atproto_handle,
        });
    }
    result
}

/// AT URIをパースして (Did, Nsid, RecordKey) に分解する
fn parse_at_uri(uri: &str) -> Option<(Did, Nsid, RecordKey)> {
    let rest = uri.strip_prefix("at://")?;
    let mut parts = rest.splitn(3, '/');
    let did: Did = parts.next()?.parse().ok()?;
    let collection: Nsid = parts.next()?.parse().ok()?;
    let rkey: RecordKey = parts.next()?.parse().ok()?;
    Some((did, collection, rkey))
}

/// 公開鍵投稿をPDSから実際に取得し、DB上の署名と照合して検証する
async fn verify_pubkey_post(pool: &db::Db, uri: &str, pds_url: &str) -> bool {
    // 1. DB から署名を取得
    let sigs = match db::atproto::get_signatures_by_uri(pool, uri, None).await {
        Ok(s) => s,
        Err(_) => return false,
    };
    let Some(sig) = sigs.first() else {
        return false;
    };

    // 2. PGP署名を検証
    let Ok(public_keys) =
        xrypton_common::keys::PublicKeys::try_from(sig.signing_public_key.as_str())
    else {
        return false;
    };
    let Ok(payload_bytes) = public_keys.verify_and_extract(&sig.signature) else {
        return false;
    };
    let Ok(payload_text) = String::from_utf8(payload_bytes) else {
        return false;
    };

    // 3. AT URIをパースしてPDSから実際のレコードを取得
    let Some((did, collection, rkey)) = parse_at_uri(uri) else {
        return false;
    };

    // SSRF防止: PDSのURLがプライベートIPでないことを検証
    if super::atproto::validate_url_not_private(pds_url)
        .await
        .is_err()
    {
        return false;
    }

    let Ok(http_client) = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
    else {
        return false;
    };
    let client = AtpServiceClient::new(
        atrium_xrpc_client::reqwest::ReqwestClientBuilder::new(pds_url)
            .client(http_client)
            .build(),
    );
    let params: get_record::Parameters = get_record::ParametersData {
        repo: did.into(),
        collection,
        rkey,
        cid: None,
    }
    .into();
    let Ok(output) = client.service.com.atproto.repo.get_record(params).await else {
        return false;
    };

    // 4. 取得したレコードから署名対象を構築し、署名の平文と照合
    let cid_str = output
        .cid
        .as_ref()
        .and_then(|c| serde_json::to_value(c).ok())
        .and_then(|v| v.get("$link").and_then(|s| s.as_str()).map(String::from));
    let Some(cid_str) = cid_str else {
        return false;
    };
    let Ok(record_value) = serde_json::to_value(&output.value) else {
        return false;
    };
    let target = serde_json::json!({
        "cid": cid_str,
        "record": record_value,
        "uri": uri,
    });
    let expected = super::atproto::canonicalize_json(&target);
    payload_text == expected
}

async fn get_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = UserId::resolve(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    // まずDBに存在するか確認（ドメイン付きIDで検索）
    let profile = db::users::get_profile(&state.pool, &user_id).await?;

    if let Some(profile) = profile {
        // ローカルユーザ
        let icon_url = profile
            .icon_key
            .as_ref()
            .map(|_| format!("/v1/user/{}/icon", user_id.as_str()));

        let external_accounts = build_external_accounts(&state, user_id.as_str()).await;

        return Ok(Json(serde_json::json!({
            "user_id": profile.user_id,
            "display_name": profile.display_name,
            "status": profile.status,
            "bio": profile.bio,
            "icon_url": icon_url,
            "external_accounts": external_accounts,
        })));
    }

    // usersテーブルに存在すればローカルユーザ（プロフィール未設定）
    if db::users::get_user(&state.pool, &user_id).await?.is_some() {
        let external_accounts = build_external_accounts(&state, user_id.as_str()).await;

        return Ok(Json(serde_json::json!({
            "user_id": user_id.as_str(),
            "display_name": "",
            "status": "",
            "bio": "",
            "icon_url": null,
            "external_accounts": external_accounts,
        })));
    }

    // DBにない場合、ドメインが自サーバ以外ならリモートプロキシ
    if let Some(domain) = user_id.domain()
        && domain != state.config.server_hostname
    {
        let base = crate::federation::client::base_url(domain, state.config.federation_allow_http);
        let url = format!("{base}/v1/user/{}/profile", user_id.local_part());
        let resp = reqwest::Client::new()
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy request failed: {e}")))?;
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::BadGateway(format!("invalid proxy response: {e}")))?;
        return Ok(Json(body));
    }

    Err(AppError::NotFound("profile not found".into()))
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    display_name: Option<String>,
    status: Option<String>,
    bio: Option<String>,
}

async fn update_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
    Json(body): Json<UpdateProfileBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = UserId::resolve_local(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    if auth.user_id != user_id {
        return Err(AppError::Forbidden("can only update own profile".into()));
    }

    db::users::update_profile(
        &state.pool,
        &user_id,
        body.display_name.as_deref(),
        body.status.as_deref(),
        body.bio.as_deref(),
        None,
    )
    .await?;

    Ok(Json(serde_json::json!({ "updated": true })))
}

/// アイコン画像をアップロード（multipart/form-data）
async fn upload_icon(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id = UserId::resolve_local(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    if auth.user_id != user_id {
        return Err(AppError::Forbidden("can only update own icon".into()));
    }

    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
        .ok_or_else(|| AppError::BadRequest("no file field".into()))?;

    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| AppError::BadRequest(format!("failed to read file: {e}")))?;

    const MAX_ICON_SIZE: usize = 5 * 1024 * 1024;
    if data.len() > MAX_ICON_SIZE {
        return Err(AppError::PayloadTooLarge(
            "icon must be 5 MB or smaller".into(),
        ));
    }

    let s3_key = format!("profiles/{}/icon", user_id.as_str());
    state
        .storage
        .put_object(&s3_key, data.to_vec(), &content_type)
        .await
        .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;

    // プロフィールの icon_key を更新
    db::users::update_profile(&state.pool, &user_id, None, None, None, Some(&s3_key)).await?;

    Ok(Json(serde_json::json!({ "uploaded": true })))
}

/// アイコン画像を取得
async fn get_icon(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let user_id = UserId::resolve(&id, &state.config.server_hostname)
        .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    // まずDBに存在するか確認
    let profile = db::users::get_profile(&state.pool, &user_id).await?;

    if let Some(profile) = profile {
        let s3_key = profile
            .icon_key
            .ok_or_else(|| AppError::NotFound("no icon set".into()))?;

        let data = state
            .storage
            .get_object(&s3_key)
            .await
            .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;

        return Ok(Response::builder()
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::from(data))
            .unwrap());
    }

    // usersテーブルに存在すればローカルユーザ（アイコン未設定）
    if db::users::get_user(&state.pool, &user_id).await?.is_some() {
        return Err(AppError::NotFound("no icon set".into()));
    }

    // DBにない場合、ドメインが自サーバ以外ならリモートプロキシ
    if let Some(domain) = user_id.domain()
        && domain != state.config.server_hostname
    {
        let base = crate::federation::client::base_url(domain, state.config.federation_allow_http);
        let url = format!("{base}/v1/user/{}/icon", user_id.local_part());
        let resp = reqwest::Client::new()
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy request failed: {e}")))?;
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy response failed: {e}")))?;
        return Ok(Response::builder()
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::from(bytes))
            .unwrap());
    }

    Err(AppError::NotFound("icon not found".into()))
}
