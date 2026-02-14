use super::models::MessageRow;
use super::{Db, sql};
use crate::types::{FileId, MessageId, ThreadId, UserId};

#[tracing::instrument(skip(pool), err)]
pub async fn get_message_by_id(
    pool: &Db,
    id: &MessageId,
) -> Result<Option<MessageRow>, sqlx::Error> {
    let q = sql("SELECT * FROM messages WHERE id = ?");
    sqlx::query_as::<_, MessageRow>(&q)
        .bind(id.as_str())
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool, content), err)]
pub async fn create_message(
    pool: &Db,
    id: &MessageId,
    thread_id: &ThreadId,
    sender_id: &UserId,
    content: &str,
    file_id: Option<&FileId>,
) -> Result<(), sqlx::Error> {
    let q = sql(
        "INSERT INTO messages (id, thread_id, sender_id, content, file_id) VALUES (?, ?, ?, ?, ?)",
    );
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(thread_id.as_str())
        .bind(sender_id.as_str())
        .bind(content)
        .bind(file_id.map(FileId::as_str))
        .execute(pool)
        .await?;
    Ok(())
}

/// メッセージをページネーションで取得。
/// `from` と `until` は最新からの負のオフセット。
/// 例: from=-30, until=-10 は最新30件目〜10件目を取得。
#[tracing::instrument(skip(pool), err)]
pub async fn get_messages(
    pool: &Db,
    thread_id: &ThreadId,
    from: i64,
    until: i64,
) -> Result<(Vec<MessageRow>, i64), sqlx::Error> {
    let q = sql("SELECT COUNT(*) FROM messages WHERE thread_id = ?");
    let total: (i64,) = sqlx::query_as(&q)
        .bind(thread_id.as_str())
        .fetch_one(pool)
        .await?;
    let total = total.0;

    // 負のオフセットを正のオフセットに変換
    // from=-30 => skip = total - 30, until=-10 => limit = 30 - 10 = 20
    let skip = (total + from).max(0);
    let limit = (until - from).max(0);

    let q = sql("SELECT * FROM messages WHERE thread_id = ?
         ORDER BY created_at ASC
         LIMIT ? OFFSET ?");
    let messages = sqlx::query_as::<_, MessageRow>(&q)
        .bind(thread_id.as_str())
        .bind(limit)
        .bind(skip)
        .fetch_all(pool)
        .await?;

    Ok((messages, total))
}
