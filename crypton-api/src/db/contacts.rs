use super::models::ContactRow;
use super::{Db, sql};
use crate::types::UserId;

#[tracing::instrument(skip(pool), err)]
pub async fn get_contacts(pool: &Db, user_id: &UserId) -> Result<Vec<ContactRow>, sqlx::Error> {
    let q = sql("SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC");
    sqlx::query_as::<_, ContactRow>(&q)
        .bind(user_id.as_str())
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn add_contact(
    pool: &Db,
    user_id: &UserId,
    contact_user_id: &UserId,
) -> Result<bool, sqlx::Error> {
    let q = sql(
        "INSERT INTO contacts (user_id, contact_user_id) VALUES (?, ?) ON CONFLICT (user_id, contact_user_id) DO NOTHING",
    );
    let result = sqlx::query(&q)
        .bind(user_id.as_str())
        .bind(contact_user_id.as_str())
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}
