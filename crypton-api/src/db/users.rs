use super::models::{ProfileRow, UserRow};
use super::{Db, sql};
use crate::types::UserId;

#[tracing::instrument(skip(pool), err)]
pub async fn get_user(pool: &Db, id: &UserId) -> Result<Option<UserRow>, sqlx::Error> {
    let q = sql("SELECT * FROM users WHERE id = ?");
    sqlx::query_as::<_, UserRow>(&q)
        .bind(id.as_str())
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_user_by_signing_key_id(
    pool: &Db,
    signing_key_id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    let q = sql("SELECT * FROM users WHERE signing_key_id = ?");
    sqlx::query_as::<_, UserRow>(&q)
        .bind(signing_key_id)
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool, encryption_public_key, signing_public_key), err)]
pub async fn create_user(
    pool: &Db,
    id: &UserId,
    encryption_public_key: &str,
    signing_public_key: &str,
    signing_key_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let q = sql(
        "INSERT INTO users (id, encryption_public_key, signing_public_key, signing_key_id) VALUES (?, ?, ?, ?)",
    );
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(encryption_public_key)
        .bind(signing_public_key)
        .bind(signing_key_id)
        .execute(&mut *tx)
        .await?;

    // プロフィールも同時に作成
    let q = sql("INSERT INTO profiles (user_id) VALUES (?)");
    sqlx::query(&q).bind(id.as_str()).execute(&mut *tx).await?;

    tx.commit().await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn delete_user(pool: &Db, id: &UserId) -> Result<bool, sqlx::Error> {
    let q = sql("DELETE FROM users WHERE id = ?");
    let result = sqlx::query(&q).bind(id.as_str()).execute(pool).await?;
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

#[tracing::instrument(skip(pool), err)]
pub async fn update_profile(
    pool: &Db,
    user_id: &UserId,
    display_name: Option<&str>,
    status: Option<&str>,
    bio: Option<&str>,
    icon_key: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let now = chrono::Utc::now();
    let q = sql("UPDATE profiles SET
            display_name = COALESCE(?, display_name),
            status = COALESCE(?, status),
            bio = COALESCE(?, bio),
            icon_key = COALESCE(?, icon_key),
            updated_at = ?
         WHERE user_id = ?");
    #[cfg(not(feature = "postgres"))]
    let now_bind = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    #[cfg(feature = "postgres")]
    let now_bind = now;
    let result = sqlx::query(&q)
        .bind(display_name)
        .bind(status)
        .bind(bio)
        .bind(icon_key)
        .bind(now_bind)
        .bind(user_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
