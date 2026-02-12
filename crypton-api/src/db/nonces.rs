use super::{Db, sql};
use crate::types::UserId;

/// nonce が未使用であれば記録して true を返す。既に使用済みなら false を返す。
#[tracing::instrument(skip(pool), err)]
pub async fn try_use_nonce(pool: &Db, nonce: &str, user_id: &UserId) -> Result<bool, sqlx::Error> {
    let q = sql(
        "INSERT INTO used_nonces (nonce, user_id) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING",
    );
    let result = sqlx::query(&q)
        .bind(nonce)
        .bind(user_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
