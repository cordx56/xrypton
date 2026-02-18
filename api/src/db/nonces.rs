use super::{Db, sql};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NonceType {
    Auth,
    Qr,
}

impl NonceType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::Qr => "qr",
        }
    }
}

/// nonce が未使用であれば記録して true を返す。既に使用済みなら false を返す。
#[tracing::instrument(skip(pool), err)]
pub async fn try_use_nonce(
    pool: &Db,
    nonce_type: NonceType,
    nonce_value: &str,
    user_id: &str,
    expires_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, sqlx::Error> {
    let q = sql(
        "INSERT INTO nonces (nonce_type, nonce_value, user_id, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (nonce_type, nonce_value) DO NOTHING",
    );
    #[cfg(not(feature = "postgres"))]
    let expires_at_bind = expires_at.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    #[cfg(feature = "postgres")]
    let expires_at_bind = expires_at;

    let result = sqlx::query(&q)
        .bind(nonce_type.as_str())
        .bind(nonce_value)
        .bind(user_id)
        .bind(expires_at_bind)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// nonce が既に使用されているか確認する（連合検証のコールバック判定用）。
#[tracing::instrument(skip(pool), err)]
pub async fn is_nonce_used(
    pool: &Db,
    nonce_type: NonceType,
    nonce_value: &str,
) -> Result<bool, sqlx::Error> {
    let q = sql("SELECT 1 FROM nonces WHERE nonce_type = ? AND nonce_value = ?");
    let row: Option<(i32,)> = sqlx::query_as(&q)
        .bind(nonce_type.as_str())
        .bind(nonce_value)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// 期限切れnonceを削除し、削除件数を返す。
#[tracing::instrument(skip(pool), err)]
pub async fn delete_expired_nonces(pool: &Db) -> Result<u64, sqlx::Error> {
    let now = chrono::Utc::now();
    let q = sql("DELETE FROM nonces WHERE expires_at < ?");

    #[cfg(not(feature = "postgres"))]
    let now_bind = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    #[cfg(feature = "postgres")]
    let now_bind = now;

    let result = sqlx::query(&q).bind(now_bind).execute(pool).await?;
    Ok(result.rows_affected())
}
