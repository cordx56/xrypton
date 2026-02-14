use super::{Db, sql};

/// nonce が未使用であれば記録して true を返す。既に使用済みなら false を返す。
/// FK制約なしのため、user_idは&strで受け取る（外部ユーザ対応）。
#[tracing::instrument(skip(pool), err)]
pub async fn try_use_nonce(pool: &Db, nonce: &str, user_id: &str) -> Result<bool, sqlx::Error> {
    let q = sql(
        "INSERT INTO used_nonces (nonce, user_id) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING",
    );
    let result = sqlx::query(&q)
        .bind(nonce)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// nonce が既に使用されているか確認する（連合検証のコールバック判定用）。
#[tracing::instrument(skip(pool), err)]
pub async fn is_nonce_used(pool: &Db, nonce: &str) -> Result<bool, sqlx::Error> {
    let q = sql("SELECT 1 FROM used_nonces WHERE nonce = ?");
    let row: Option<(i32,)> = sqlx::query_as(&q).bind(nonce).fetch_optional(pool).await?;
    Ok(row.is_some())
}

/// 指定日数より古いnonceを削除し、削除件数を返す。
#[tracing::instrument(skip(pool), err)]
pub async fn delete_nonces_older_than_days(
    pool: &Db,
    retention_days: i64,
) -> Result<u64, sqlx::Error> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
    let q = sql("DELETE FROM used_nonces WHERE used_at < ?");

    #[cfg(not(feature = "postgres"))]
    let cutoff_bind = cutoff.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    #[cfg(feature = "postgres")]
    let cutoff_bind = cutoff;

    let result = sqlx::query(&q).bind(cutoff_bind).execute(pool).await?;
    Ok(result.rows_affected())
}
