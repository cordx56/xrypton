use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::header;
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::error::AppError;
use crate::types::UserId;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/user/{id}/keys",
            get(get_keys).post(post_keys).delete(delete_user),
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

/// ユーザ登録（認証不要）または公開鍵更新
async fn post_keys(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PostKeysBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;

    // signing key ID を抽出して検証
    let public_keys = crypton_common::keys::PublicKeys::try_from(body.signing_public_key.as_str())
        .map_err(|e| AppError::BadRequest(format!("invalid signing public key: {e}")))?;
    let signing_key_id = public_keys
        .get_signing_sub_key_id()
        .map_err(|e| AppError::BadRequest(format!("failed to get signing key id: {e}")))?;

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

async fn get_keys(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    let user = db::users::get_user(&state.pool, &user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".into()))?;

    Ok(Json(serde_json::json!({
        "id": user.id,
        "encryption_public_key": user.encryption_public_key,
        "signing_public_key": user.signing_public_key,
        "signing_key_id": user.signing_key_id,
    })))
}

async fn delete_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    auth: AuthenticatedUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    if auth.user_id != user_id {
        return Err(AppError::Forbidden("can only delete own account".into()));
    }
    db::users::delete_user(&state.pool, &user_id).await?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn get_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    let profile = db::users::get_profile(&state.pool, &user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("profile not found".into()))?;

    // アイコンURLの生成（S3キーがある場合）
    let icon_url = profile
        .icon_key
        .as_ref()
        .map(|_| format!("/v1/user/{}/icon", user_id.as_str()));

    Ok(Json(serde_json::json!({
        "user_id": profile.user_id,
        "display_name": profile.display_name,
        "status": profile.status,
        "bio": profile.bio,
        "icon_url": icon_url,
    })))
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
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
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
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
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
    let user_id =
        UserId::validate(&id).map_err(|e| AppError::BadRequest(format!("invalid user ID: {e}")))?;
    let profile = db::users::get_profile(&state.pool, &user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("profile not found".into()))?;

    let s3_key = profile
        .icon_key
        .ok_or_else(|| AppError::NotFound("no icon set".into()))?;

    let data = state
        .storage
        .get_object(&s3_key)
        .await
        .map_err(|e| AppError::Internal(format!("storage error: {e}")))?;

    // Content-Type の推定（S3キーの拡張子が無いため image/png をデフォルトに）
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(data))
        .unwrap())
}
