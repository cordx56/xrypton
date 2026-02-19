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

    // 主鍵フィンガープリントを抽出
    let public_keys = xrypton_common::keys::PublicKeys::try_from(body.signing_public_key.as_str())
        .map_err(|e| AppError::BadRequest(format!("invalid signing public key: {e}")))?;
    let fingerprint = public_keys.get_primary_fingerprint();

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
        &fingerprint,
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
    let fingerprint = public_keys.get_primary_fingerprint();

    let updated = db::users::update_user_keys(
        &state.pool,
        &user_id,
        &body.encryption_public_key,
        &body.signing_public_key,
        &fingerprint,
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
        "primary_key_fingerprint": user.primary_key_fingerprint,
    })))
}

/// 公開鍵取得（認証不要）
async fn get_keys(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    // CASE A: リクエストIDに@あり
    if let Some((local_part, domain)) = id.split_once('@') {
        // まずはリクエストIDそのままでローカルDBを検索し、DNSクエリを避ける。
        let raw_user_id = UserId::validate_full(&id)
            .map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
        if let Ok(keys) = fetch_local_user_keys(&state, &raw_user_id).await {
            return Ok(keys);
        }

        // ローカルにない外部検索は認証済みリクエストのみ許可。
        let auth = match headers.get(header::AUTHORIZATION) {
            Some(v) => {
                let auth_header_raw = v
                    .to_str()
                    .map_err(|_| AppError::Unauthorized("invalid authorization header".into()))?;
                Some(
                    crate::auth::authenticate(
                        &state.pool,
                        &state.config,
                        &state.dns_resolver,
                        auth_header_raw,
                    )
                    .await?,
                )
            }
            None => None,
        };
        if auth.is_none() {
            return Err(AppError::BadRequest(
                "authentication required for external key lookup".into(),
            ));
        }

        // 外部検索（旧仕様）: DNS TXTレコードによるドメイン解決
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

        // 外部サーバのユーザ → 連合リクエスト（DNS解決後のドメインで取得）
        let remote_keys = crate::federation::client::fetch_user_keys(
            &resolved_domain,
            &resolved_local,
            state.config.federation_allow_http,
        )
        .await?;

        // キャッシュとしてローカルに保存（元のIDを維持）
        let full_id = format!("{local_part}@{domain}");
        let public_keys =
            xrypton_common::keys::PublicKeys::try_from(remote_keys.signing_public_key.as_str())
                .map_err(|e| AppError::BadGateway(format!("invalid remote signing key: {e}")))?;
        let fingerprint = public_keys.get_primary_fingerprint();
        db::users::upsert_external_user(
            &state.pool,
            &full_id,
            &remote_keys.encryption_public_key,
            &remote_keys.signing_public_key,
            &fingerprint,
        )
        .await?;

        return Ok(Json(serde_json::json!({
            "id": remote_keys.id,
            "encryption_public_key": remote_keys.encryption_public_key,
            "signing_public_key": remote_keys.signing_public_key,
            "primary_key_fingerprint": fingerprint,
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

/// ATProto・Xアカウント等から外部アカウント情報を構築する。
async fn build_external_accounts(state: &AppState, user_id: &str) -> Vec<ExternalAccount> {
    let mut accounts: Vec<ExternalAccount> = db::atproto::list_accounts(&state.pool, user_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(ExternalAccount::from)
        .collect();
    accounts.extend(
        db::x::list_accounts(&state.pool, user_id)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(ExternalAccount::from),
    );
    accounts
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
            "display_name_signature": profile.display_name_signature,
            "status": profile.status,
            "status_signature": profile.status_signature,
            "bio": profile.bio,
            "bio_signature": profile.bio_signature,
            "icon_url": icon_url,
            "icon_signature": profile.icon_signature,
            "external_accounts": external_accounts,
        })));
    }

    // usersテーブルに存在すればローカルユーザ（プロフィール未設定）
    if db::users::get_user(&state.pool, &user_id).await?.is_some() {
        let external_accounts = build_external_accounts(&state, user_id.as_str()).await;

        return Ok(Json(serde_json::json!({
            "user_id": user_id.as_str(),
            "display_name": "",
            "display_name_signature": "",
            "status": "",
            "status_signature": "",
            "bio": "",
            "bio_signature": "",
            "icon_url": null,
            "icon_signature": "",
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
    display_name_signature: Option<String>,
    status: Option<String>,
    status_signature: Option<String>,
    bio: Option<String>,
    bio_signature: Option<String>,
}

fn validate_detached_signature(
    field_name: &str,
    value: Option<&str>,
    signature: Option<&str>,
) -> Result<(), AppError> {
    if let Some(v) = value
        && !v.is_empty()
        && signature.map(str::is_empty).unwrap_or(true)
    {
        return Err(AppError::BadRequest(format!(
            "{field_name}_signature is required when {field_name} is not empty"
        )));
    }
    Ok(())
}

fn normalize_detached_signature<'a>(
    value: Option<&'a str>,
    signature: Option<&'a str>,
) -> Option<&'a str> {
    match value {
        Some("") => Some(""),
        Some(_) => signature,
        None => None,
    }
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

    validate_detached_signature(
        "display_name",
        body.display_name.as_deref(),
        body.display_name_signature.as_deref(),
    )?;
    validate_detached_signature(
        "status",
        body.status.as_deref(),
        body.status_signature.as_deref(),
    )?;
    validate_detached_signature("bio", body.bio.as_deref(), body.bio_signature.as_deref())?;

    let display_name_signature = normalize_detached_signature(
        body.display_name.as_deref(),
        body.display_name_signature.as_deref(),
    );
    let status_signature =
        normalize_detached_signature(body.status.as_deref(), body.status_signature.as_deref());
    let bio_signature =
        normalize_detached_signature(body.bio.as_deref(), body.bio_signature.as_deref());

    db::users::update_profile(
        &state.pool,
        &user_id,
        db::users::UpdateProfileFields {
            display_name: body.display_name.as_deref(),
            display_name_signature,
            status: body.status.as_deref(),
            status_signature,
            bio: body.bio.as_deref(),
            bio_signature,
            icon_key: None,
            icon_signature: None,
        },
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

    let mut icon_content_type = String::from("application/octet-stream");
    let mut icon_data: Option<Vec<u8>> = None;
    let mut icon_signature = String::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("multipart error: {e}")))?
    {
        match field.name() {
            Some("icon") => {
                if let Some(content_type) = field.content_type() {
                    icon_content_type = content_type.to_string();
                }
                icon_data = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("failed to read icon: {e}")))?
                        .to_vec(),
                );
            }
            Some("icon_signature") => {
                icon_signature = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read signature: {e}")))?;
            }
            _ => {}
        }
    }

    let data = icon_data.ok_or_else(|| AppError::BadRequest("icon field is required".into()))?;
    if icon_signature.is_empty() {
        return Err(AppError::BadRequest("icon_signature is required".into()));
    }
    if !icon_content_type.starts_with("image/") {
        return Err(AppError::BadRequest(
            "icon content-type must be image/*".into(),
        ));
    }

    const MAX_ICON_SIZE: usize = 5 * 1024 * 1024;
    if data.len() > MAX_ICON_SIZE {
        return Err(AppError::PayloadTooLarge(
            "icon must be 5 MB or smaller".into(),
        ));
    }

    let s3_key = format!("profiles/{}/icon", user_id.as_str());
    state
        .storage
        .put_object(&s3_key, data, icon_content_type.as_str())
        .await
        .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;

    // プロフィールの icon_key を更新
    db::users::update_profile(
        &state.pool,
        &user_id,
        db::users::UpdateProfileFields {
            display_name: None,
            display_name_signature: None,
            status: None,
            status_signature: None,
            bio: None,
            bio_signature: None,
            icon_key: Some(&s3_key),
            icon_signature: Some(icon_signature.as_str()),
        },
    )
    .await?;

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

        let object = state
            .storage
            .get_object_with_metadata(&s3_key)
            .await
            .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;
        let content_type = object
            .content_type
            .unwrap_or_else(|| "application/octet-stream".to_string());

        return Ok(Response::builder()
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::from(object.data))
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
        let content_type = resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::BadGateway(format!("proxy response failed: {e}")))?;
        return Ok(Response::builder()
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CACHE_CONTROL, "public, max-age=3600")
            .body(Body::from(bytes))
            .unwrap());
    }

    Err(AppError::NotFound("icon not found".into()))
}
