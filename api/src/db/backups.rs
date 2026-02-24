use super::models::SecretKeyBackupRow;
use super::{Db, sql};

#[tracing::instrument(skip(pool, armor, webauthn_credential_id_b64), err)]
pub async fn upsert_secret_key_backup(
    pool: &Db,
    user_id: &str,
    armor: &str,
    version: i32,
    webauthn_credential_id_b64: &str,
) -> Result<(), sqlx::Error> {
    let q = sql(
        "INSERT INTO secret_key_backups (user_id, armor, version, webauthn_credential_id_b64) \
         VALUES (?, ?, ?, ?) \
         ON CONFLICT (user_id) DO UPDATE SET \
         armor = ?, version = ?, webauthn_credential_id_b64 = ?, updated_at = CURRENT_TIMESTAMP",
    );

    sqlx::query(&q)
        .bind(user_id)
        .bind(armor)
        .bind(version)
        .bind(webauthn_credential_id_b64)
        .bind(armor)
        .bind(version)
        .bind(webauthn_credential_id_b64)
        .execute(pool)
        .await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_secret_key_backup(
    pool: &Db,
    user_id: &str,
) -> Result<Option<SecretKeyBackupRow>, sqlx::Error> {
    let q = sql("SELECT * FROM secret_key_backups WHERE user_id = ?");
    sqlx::query_as::<_, SecretKeyBackupRow>(&q)
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn delete_secret_key_backup(pool: &Db, user_id: &str) -> Result<bool, sqlx::Error> {
    let q = sql("DELETE FROM secret_key_backups WHERE user_id = ?");
    let result = sqlx::query(&q).bind(user_id).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}
