use super::models::{ThreadRow, Timestamp};
use super::{Db, sql};
use crate::types::{ChatId, ThreadId, UserId};

#[tracing::instrument(skip(pool), err)]
pub async fn create_thread(
    pool: &Db,
    id: &ThreadId,
    chat_id: &ChatId,
    name: &str,
    created_by: &UserId,
    expires_at: Option<&Timestamp>,
) -> Result<(), sqlx::Error> {
    let q = sql(
        "INSERT INTO threads (id, chat_id, name, created_by, expires_at) VALUES (?, ?, ?, ?, ?)",
    );
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(chat_id.as_str())
        .bind(name)
        .bind(created_by.as_str())
        .bind(expires_at)
        .execute(pool)
        .await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_threads_by_chat(
    pool: &Db,
    chat_id: &ChatId,
) -> Result<Vec<ThreadRow>, sqlx::Error> {
    let q = sql(
        "SELECT * FROM threads WHERE chat_id = ? AND archived_at IS NULL ORDER BY created_at DESC",
    );
    sqlx::query_as::<_, ThreadRow>(&q)
        .bind(chat_id.as_str())
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_archived_threads_by_chat(
    pool: &Db,
    chat_id: &ChatId,
) -> Result<Vec<ThreadRow>, sqlx::Error> {
    let q = sql(
        "SELECT * FROM threads WHERE chat_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC",
    );
    sqlx::query_as::<_, ThreadRow>(&q)
        .bind(chat_id.as_str())
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn archive_thread(pool: &Db, thread_id: &ThreadId) -> Result<bool, sqlx::Error> {
    let q = sql("UPDATE threads SET archived_at = CURRENT_TIMESTAMP WHERE id = ?");
    let result = sqlx::query(&q)
        .bind(thread_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn unarchive_thread(pool: &Db, thread_id: &ThreadId) -> Result<bool, sqlx::Error> {
    let q = sql("UPDATE threads SET archived_at = NULL WHERE id = ?");
    let result = sqlx::query(&q)
        .bind(thread_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_thread(pool: &Db, thread_id: &ThreadId) -> Result<Option<ThreadRow>, sqlx::Error> {
    let q = sql("SELECT * FROM threads WHERE id = ?");
    sqlx::query_as::<_, ThreadRow>(&q)
        .bind(thread_id.as_str())
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn update_thread_name(
    pool: &Db,
    thread_id: &ThreadId,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let q = sql("UPDATE threads SET name = ? WHERE id = ?");
    let result = sqlx::query(&q)
        .bind(name)
        .bind(thread_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
