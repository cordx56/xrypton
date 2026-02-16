use super::models::PushSubscriptionRow;
use super::{Db, sql};
use crate::types::{SubscriptionId, UserId};

#[tracing::instrument(skip(pool, p256dh, auth), err)]
pub async fn upsert_subscription(
    pool: &Db,
    id: &SubscriptionId,
    user_id: &UserId,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
) -> Result<(), sqlx::Error> {
    // endpoint + user_id が同一なら更新、なければ挿入
    // 同一ブラウザ（同一endpoint）で複数アカウントが購読できるようにする
    let q = sql(
        "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint, user_id) DO UPDATE SET
            p256dh = excluded.p256dh,
            auth = excluded.auth",
    );
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(user_id.as_str())
        .bind(endpoint)
        .bind(p256dh)
        .bind(auth)
        .execute(pool)
        .await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_subscriptions_for_user(
    pool: &Db,
    user_id: &UserId,
) -> Result<Vec<PushSubscriptionRow>, sqlx::Error> {
    let q = sql("SELECT * FROM push_subscriptions WHERE user_id = ?");
    sqlx::query_as::<_, PushSubscriptionRow>(&q)
        .bind(user_id.as_str())
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn delete_subscription_by_endpoint(pool: &Db, endpoint: &str) -> Result<(), sqlx::Error> {
    let q = sql("DELETE FROM push_subscriptions WHERE endpoint = ?");
    sqlx::query(&q).bind(endpoint).execute(pool).await?;
    Ok(())
}
