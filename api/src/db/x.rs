use super::models::XAccountRow;
use super::{Db, sql};

#[tracing::instrument(skip(pool), err)]
pub async fn link_account(
    pool: &Db,
    user_id: &str,
    handle: &str,
    author_url: &str,
    post_url: &str,
    proof_json: &str,
    signature: &str,
) -> Result<bool, sqlx::Error> {
    let q = sql(
        "INSERT INTO x_accounts (user_id, x_handle, x_author_url, x_post_url, proof_json, signature) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT (user_id, x_handle) DO UPDATE SET \
         x_author_url = ?, x_post_url = ?, proof_json = ?, signature = ?, updated_at = CURRENT_TIMESTAMP",
    );
    let result = sqlx::query(&q)
        .bind(user_id)
        .bind(handle)
        .bind(author_url)
        .bind(post_url)
        .bind(proof_json)
        .bind(signature)
        .bind(author_url)
        .bind(post_url)
        .bind(proof_json)
        .bind(signature)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn list_accounts(pool: &Db, user_id: &str) -> Result<Vec<XAccountRow>, sqlx::Error> {
    let q = sql("SELECT * FROM x_accounts WHERE user_id = ? ORDER BY created_at DESC");
    sqlx::query_as::<_, XAccountRow>(&q)
        .bind(user_id)
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_account(
    pool: &Db,
    user_id: &str,
    handle: &str,
) -> Result<Option<XAccountRow>, sqlx::Error> {
    let q = sql("SELECT * FROM x_accounts WHERE user_id = ? AND x_handle = ?");
    sqlx::query_as::<_, XAccountRow>(&q)
        .bind(user_id)
        .bind(handle)
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn unlink_account(pool: &Db, user_id: &str, handle: &str) -> Result<bool, sqlx::Error> {
    let q = sql("DELETE FROM x_accounts WHERE user_id = ? AND x_handle = ?");
    let result = sqlx::query(&q)
        .bind(user_id)
        .bind(handle)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
