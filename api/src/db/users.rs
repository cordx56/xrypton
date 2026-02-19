use super::models::{ProfileRow, UserRow};
use super::{Db, sql};
use crate::types::UserId;

/// 表示名を取得する。
pub async fn resolve_display_name(pool: &Db, user_id: &UserId) -> Option<String> {
    let profile = get_profile(pool, user_id).await.ok()??;
    let name = profile.display_name;
    if name.is_empty() {
        return None;
    }
    Some(name)
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_user(pool: &Db, id: &UserId) -> Result<Option<UserRow>, sqlx::Error> {
    let q = sql("SELECT * FROM users WHERE id = ?");
    sqlx::query_as::<_, UserRow>(&q)
        .bind(id.as_str())
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_user_by_fingerprint(
    pool: &Db,
    fingerprint: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    let q = sql("SELECT * FROM users WHERE primary_key_fingerprint = ?");
    sqlx::query_as::<_, UserRow>(&q)
        .bind(fingerprint)
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool, encryption_public_key, signing_public_key), err)]
pub async fn create_user(
    pool: &Db,
    id: &UserId,
    encryption_public_key: &str,
    signing_public_key: &str,
    primary_key_fingerprint: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let q = sql(
        "INSERT INTO users (id, encryption_public_key, signing_public_key, primary_key_fingerprint) VALUES (?, ?, ?, ?)",
    );
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(encryption_public_key)
        .bind(signing_public_key)
        .bind(primary_key_fingerprint)
        .execute(&mut *tx)
        .await?;

    // プロフィールも同時に作成
    let q = sql("INSERT INTO profiles (user_id) VALUES (?)");
    sqlx::query(&q).bind(id.as_str()).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn delete_user(
    pool: &Db,
    id: &UserId,
    primary_key_fingerprint: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let insert_q = sql("INSERT INTO deleted_users (id, primary_key_fingerprint) VALUES (?, ?)");
    sqlx::query(&insert_q)
        .bind(id.as_str())
        .bind(primary_key_fingerprint)
        .execute(&mut *tx)
        .await?;

    let delete_q = sql("DELETE FROM users WHERE id = ?");
    let result = sqlx::query(&delete_q)
        .bind(id.as_str())
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(
    skip(
        pool,
        encryption_public_key,
        signing_public_key,
        primary_key_fingerprint
    ),
    err
)]
pub async fn update_user_keys(
    pool: &Db,
    id: &UserId,
    encryption_public_key: &str,
    signing_public_key: &str,
    primary_key_fingerprint: &str,
) -> Result<bool, sqlx::Error> {
    let now = chrono::Utc::now();
    let q = sql("UPDATE users
         SET encryption_public_key = ?,
             signing_public_key = ?,
             primary_key_fingerprint = ?,
             updated_at = ?
         WHERE id = ?");
    #[cfg(not(feature = "postgres"))]
    let now_bind = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    #[cfg(feature = "postgres")]
    let now_bind = now;
    let result = sqlx::query(&q)
        .bind(encryption_public_key)
        .bind(signing_public_key)
        .bind(primary_key_fingerprint)
        .bind(now_bind)
        .bind(id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_profile(pool: &Db, user_id: &UserId) -> Result<Option<ProfileRow>, sqlx::Error> {
    let q = sql("SELECT * FROM profiles WHERE user_id = ?");
    sqlx::query_as::<_, ProfileRow>(&q)
        .bind(user_id.as_str())
        .fetch_optional(pool)
        .await
}

#[derive(Debug, Clone, Default)]
pub struct UpdateProfileFields<'a> {
    pub display_name: Option<&'a str>,
    pub display_name_signature: Option<&'a str>,
    pub status: Option<&'a str>,
    pub status_signature: Option<&'a str>,
    pub bio: Option<&'a str>,
    pub bio_signature: Option<&'a str>,
    pub icon_key: Option<&'a str>,
    pub icon_signature: Option<&'a str>,
}

#[tracing::instrument(skip(pool), err)]
pub async fn update_profile(
    pool: &Db,
    user_id: &UserId,
    fields: UpdateProfileFields<'_>,
) -> Result<bool, sqlx::Error> {
    let now = chrono::Utc::now();
    let q = sql("UPDATE profiles SET
            display_name = COALESCE(?, display_name),
            display_name_signature = COALESCE(?, display_name_signature),
            status = COALESCE(?, status),
            status_signature = COALESCE(?, status_signature),
            bio = COALESCE(?, bio),
            bio_signature = COALESCE(?, bio_signature),
            icon_key = COALESCE(?, icon_key),
            icon_signature = COALESCE(?, icon_signature),
            updated_at = ?
         WHERE user_id = ?");
    #[cfg(not(feature = "postgres"))]
    let now_bind = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    #[cfg(feature = "postgres")]
    let now_bind = now;
    let result = sqlx::query(&q)
        .bind(fields.display_name)
        .bind(fields.display_name_signature)
        .bind(fields.status)
        .bind(fields.status_signature)
        .bind(fields.bio)
        .bind(fields.bio_signature)
        .bind(fields.icon_key)
        .bind(fields.icon_signature)
        .bind(now_bind)
        .bind(user_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// 大文字小文字を区別しないユーザ検索
#[tracing::instrument(skip(pool), err)]
pub async fn get_user_case_insensitive(
    pool: &Db,
    id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    let q = sql("SELECT * FROM users WHERE LOWER(id) = LOWER(?)");
    sqlx::query_as::<_, UserRow>(&q)
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// 外部ユーザの公開鍵をupsertする（INSERT ON CONFLICT UPDATE）
#[tracing::instrument(skip(pool, encryption_public_key, signing_public_key), err)]
pub async fn upsert_external_user(
    pool: &Db,
    full_id: &str,
    encryption_public_key: &str,
    signing_public_key: &str,
    primary_key_fingerprint: &str,
) -> Result<(), sqlx::Error> {
    let q = sql(
        "INSERT INTO users (id, encryption_public_key, signing_public_key, primary_key_fingerprint)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
             encryption_public_key = ?,
             signing_public_key = ?,
             primary_key_fingerprint = ?",
    );
    sqlx::query(&q)
        .bind(full_id)
        .bind(encryption_public_key)
        .bind(signing_public_key)
        .bind(primary_key_fingerprint)
        .bind(encryption_public_key)
        .bind(signing_public_key)
        .bind(primary_key_fingerprint)
        .execute(pool)
        .await?;
    Ok(())
}
