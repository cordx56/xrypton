use super::{Db, sql};

/// tombstoneレコードを挿入する。
pub async fn insert_tombstone(
    pool: &Db,
    user_id: &str,
    fingerprint: Option<&str>,
) -> Result<(), sqlx::Error> {
    let q = sql("INSERT INTO deleted_users (id, primary_key_fingerprint) VALUES (?, ?)");
    sqlx::query(&q)
        .bind(user_id)
        .bind(fingerprint)
        .execute(pool)
        .await?;
    Ok(())
}

/// user_id が削除済みか判定する。
pub async fn is_deleted(pool: &Db, user_id: &str) -> Result<bool, sqlx::Error> {
    let q = sql("SELECT 1 FROM deleted_users WHERE id = ?");
    let row: Option<(i32,)> = sqlx::query_as(&q)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// 指定 fingerprint のうち削除済みのものを返す。
pub async fn get_deleted_fingerprints(
    pool: &Db,
    fingerprints: &[String],
) -> Result<Vec<String>, sqlx::Error> {
    if fingerprints.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders: Vec<&str> = fingerprints.iter().map(|_| "?").collect();
    let raw = format!(
        "SELECT primary_key_fingerprint FROM deleted_users WHERE primary_key_fingerprint IN ({})",
        placeholders.join(", ")
    );
    let q = sql(&raw);
    let mut query = sqlx::query_as::<_, (String,)>(&q);
    for fp in fingerprints {
        query = query.bind(fp);
    }
    let rows = query.fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(fp,)| fp).collect())
}
