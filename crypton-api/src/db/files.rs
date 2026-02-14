use super::models::FileRow;
use super::{Db, sql};
use crate::types::{ChatId, FileId};

#[tracing::instrument(skip(pool), err)]
pub async fn create_file(
    pool: &Db,
    id: &FileId,
    chat_id: &ChatId,
    s3_key: &str,
    size: i32,
) -> Result<(), sqlx::Error> {
    let q = sql("INSERT INTO files (id, chat_id, s3_key, size) VALUES (?, ?, ?, ?)");
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(chat_id.as_str())
        .bind(s3_key)
        .bind(size)
        .execute(pool)
        .await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_file(pool: &Db, id: &FileId) -> Result<Option<FileRow>, sqlx::Error> {
    let q = sql("SELECT * FROM files WHERE id = ?");
    sqlx::query_as::<_, FileRow>(&q)
        .bind(id.as_str())
        .fetch_optional(pool)
        .await
}
