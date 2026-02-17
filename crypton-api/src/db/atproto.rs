use super::models::{AtprotoAccountRow, AtprotoSignatureRow, AtprotoSignatureWithKeyRow};
use super::{Db, sql};

// --- アカウント紐付け ---

#[tracing::instrument(skip(pool), err)]
pub async fn link_account(
    pool: &Db,
    user_id: &str,
    did: &str,
    handle: Option<&str>,
    pds_url: &str,
) -> Result<bool, sqlx::Error> {
    let q = sql(
        "INSERT INTO atproto_accounts (user_id, atproto_did, atproto_handle, pds_url) \
         VALUES (?, ?, ?, ?) \
         ON CONFLICT (user_id, atproto_did) DO UPDATE SET \
         atproto_handle = ?, pds_url = ?, updated_at = CURRENT_TIMESTAMP",
    );
    let result = sqlx::query(&q)
        .bind(user_id)
        .bind(did)
        .bind(handle)
        .bind(pds_url)
        .bind(handle)
        .bind(pds_url)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn list_accounts(
    pool: &Db,
    user_id: &str,
) -> Result<Vec<AtprotoAccountRow>, sqlx::Error> {
    let q = sql("SELECT * FROM atproto_accounts WHERE user_id = ? ORDER BY created_at DESC");
    sqlx::query_as::<_, AtprotoAccountRow>(&q)
        .bind(user_id)
        .fetch_all(pool)
        .await
}

/// 指定ユーザが指定DIDを紐付け済みか確認する
#[tracing::instrument(skip(pool), err)]
pub async fn get_account(
    pool: &Db,
    user_id: &str,
    did: &str,
) -> Result<Option<AtprotoAccountRow>, sqlx::Error> {
    let q = sql("SELECT * FROM atproto_accounts WHERE user_id = ? AND atproto_did = ?");
    sqlx::query_as::<_, AtprotoAccountRow>(&q)
        .bind(user_id)
        .bind(did)
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn unlink_account(pool: &Db, user_id: &str, did: &str) -> Result<bool, sqlx::Error> {
    let q = sql("DELETE FROM atproto_accounts WHERE user_id = ? AND atproto_did = ?");
    let result = sqlx::query(&q)
        .bind(user_id)
        .bind(did)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// 公開鍵検証投稿のURIを保存
#[tracing::instrument(skip(pool), err)]
pub async fn set_pubkey_post_uri(
    pool: &Db,
    user_id: &str,
    did: &str,
    uri: &str,
) -> Result<(), sqlx::Error> {
    let q = sql(
        "UPDATE atproto_accounts SET pubkey_post_uri = ?, updated_at = CURRENT_TIMESTAMP \
         WHERE user_id = ? AND atproto_did = ?",
    );
    sqlx::query(&q)
        .bind(uri)
        .bind(user_id)
        .bind(did)
        .execute(pool)
        .await?;
    Ok(())
}

// --- 署名管理 ---

pub struct NewSignature<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub atproto_did: &'a str,
    pub atproto_uri: &'a str,
    pub atproto_cid: &'a str,
    pub collection: &'a str,
    pub record_json: &'a str,
    pub signature: &'a str,
}

#[tracing::instrument(skip(pool, sig), err)]
pub async fn save_signature(pool: &Db, sig: &NewSignature<'_>) -> Result<(), sqlx::Error> {
    let q = sql("INSERT INTO atproto_signatures \
         (id, user_id, atproto_did, atproto_uri, atproto_cid, collection, record_json, signature) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    sqlx::query(&q)
        .bind(sig.id)
        .bind(sig.user_id)
        .bind(sig.atproto_did)
        .bind(sig.atproto_uri)
        .bind(sig.atproto_cid)
        .bind(sig.collection)
        .bind(sig.record_json)
        .bind(sig.signature)
        .execute(pool)
        .await?;
    Ok(())
}

/// URI(+任意のCID)で署名を取得する。公開鍵をJOINして返す。
#[tracing::instrument(skip(pool), err)]
pub async fn get_signatures_by_uri(
    pool: &Db,
    uri: &str,
    cid: Option<&str>,
) -> Result<Vec<AtprotoSignatureWithKeyRow>, sqlx::Error> {
    if let Some(cid) = cid {
        let q = sql(
            "SELECT s.id, s.user_id, s.atproto_did, s.atproto_uri, s.atproto_cid, \
             s.collection, s.record_json, s.signature, s.created_at, u.signing_public_key \
             FROM atproto_signatures s JOIN users u ON s.user_id = u.id \
             WHERE s.atproto_uri = ? AND s.atproto_cid = ?",
        );
        sqlx::query_as::<_, AtprotoSignatureWithKeyRow>(&q)
            .bind(uri)
            .bind(cid)
            .fetch_all(pool)
            .await
    } else {
        let q = sql(
            "SELECT s.id, s.user_id, s.atproto_did, s.atproto_uri, s.atproto_cid, \
             s.collection, s.record_json, s.signature, s.created_at, u.signing_public_key \
             FROM atproto_signatures s JOIN users u ON s.user_id = u.id \
             WHERE s.atproto_uri = ?",
        );
        sqlx::query_as::<_, AtprotoSignatureWithKeyRow>(&q)
            .bind(uri)
            .fetch_all(pool)
            .await
    }
}

/// 複数URIの署名を一括取得する。公開鍵をJOINして返す。
#[tracing::instrument(skip(pool), err)]
pub async fn get_signatures_by_uris(
    pool: &Db,
    uris: &[&str],
) -> Result<Vec<AtprotoSignatureWithKeyRow>, sqlx::Error> {
    if uris.is_empty() {
        return Ok(vec![]);
    }
    let placeholders: String = (0..uris.len())
        .map(|_| "?".to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let raw_query = format!(
        "SELECT s.id, s.user_id, s.atproto_did, s.atproto_uri, s.atproto_cid, \
         s.collection, s.record_json, s.signature, s.created_at, u.signing_public_key \
         FROM atproto_signatures s JOIN users u ON s.user_id = u.id \
         WHERE s.atproto_uri IN ({placeholders})"
    );
    let query_str = sql(&raw_query);
    let mut query = sqlx::query_as::<_, AtprotoSignatureWithKeyRow>(&query_str);
    for uri in uris {
        query = query.bind(*uri);
    }
    query.fetch_all(pool).await
}

/// ユーザIDで署名一覧を取得する（ページネーション付き）
#[tracing::instrument(skip(pool), err)]
pub async fn get_signatures_by_user(
    pool: &Db,
    user_id: &str,
    collection: Option<&str>,
    limit: i64,
    cursor: Option<&str>,
) -> Result<Vec<AtprotoSignatureRow>, sqlx::Error> {
    match (collection, cursor) {
        (Some(col), Some(cur)) => {
            let q = sql("SELECT * FROM atproto_signatures \
                 WHERE user_id = ? AND collection = ? AND created_at < ? \
                 ORDER BY created_at DESC LIMIT ?");
            sqlx::query_as::<_, AtprotoSignatureRow>(&q)
                .bind(user_id)
                .bind(col)
                .bind(cur)
                .bind(limit)
                .fetch_all(pool)
                .await
        }
        (Some(col), None) => {
            let q = sql("SELECT * FROM atproto_signatures \
                 WHERE user_id = ? AND collection = ? \
                 ORDER BY created_at DESC LIMIT ?");
            sqlx::query_as::<_, AtprotoSignatureRow>(&q)
                .bind(user_id)
                .bind(col)
                .bind(limit)
                .fetch_all(pool)
                .await
        }
        (None, Some(cur)) => {
            let q = sql("SELECT * FROM atproto_signatures \
                 WHERE user_id = ? AND created_at < ? \
                 ORDER BY created_at DESC LIMIT ?");
            sqlx::query_as::<_, AtprotoSignatureRow>(&q)
                .bind(user_id)
                .bind(cur)
                .bind(limit)
                .fetch_all(pool)
                .await
        }
        (None, None) => {
            let q = sql("SELECT * FROM atproto_signatures \
                 WHERE user_id = ? \
                 ORDER BY created_at DESC LIMIT ?");
            sqlx::query_as::<_, AtprotoSignatureRow>(&q)
                .bind(user_id)
                .bind(limit)
                .fetch_all(pool)
                .await
        }
    }
}

/// URI+CIDの組み合わせが既存かチェック
#[tracing::instrument(skip(pool), err)]
pub async fn signature_exists(pool: &Db, uri: &str, cid: &str) -> Result<bool, sqlx::Error> {
    let q = sql("SELECT COUNT(*) as cnt FROM atproto_signatures \
         WHERE atproto_uri = ? AND atproto_cid = ?");
    let row: (i64,) = sqlx::query_as(&q)
        .bind(uri)
        .bind(cid)
        .fetch_one(pool)
        .await?;
    Ok(row.0 > 0)
}
