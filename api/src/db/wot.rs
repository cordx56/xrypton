use std::collections::HashMap;

use super::Db;
use super::models::{UserRow, WotSignatureRow};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeDirection {
    Inbound,
    Outbound,
    Both,
}

#[tracing::instrument(skip(pool), err)]
pub async fn insert_signature(
    pool: &Db,
    id: &str,
    target_fingerprint: &str,
    signer_fingerprint: &str,
    signature_b64: &str,
    signature_hash: &str,
    signature_created_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, sqlx::Error> {
    let mut qb = sqlx::QueryBuilder::new(
        "INSERT INTO wot_signatures (id, target_fingerprint, signer_fingerprint, signature_b64, signature_hash, signature_created_at) ",
    );
    qb.push("VALUES (")
        .push_bind(id)
        .push(", ")
        .push_bind(target_fingerprint)
        .push(", ")
        .push_bind(signer_fingerprint)
        .push(", ")
        .push_bind(signature_b64)
        .push(", ")
        .push_bind(signature_hash)
        .push(", ");
    #[cfg(not(feature = "postgres"))]
    qb.push_bind(
        signature_created_at
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
    );
    #[cfg(feature = "postgres")]
    qb.push_bind(signature_created_at);
    qb.push(") ON CONFLICT (signature_hash) DO NOTHING");

    let result = qb.build().execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_edges_for_frontier(
    pool: &Db,
    fingerprints: &[String],
    direction: EdgeDirection,
) -> Result<Vec<WotSignatureRow>, sqlx::Error> {
    if fingerprints.is_empty() {
        return Ok(Vec::new());
    }

    let mut qb = sqlx::QueryBuilder::new(
        "SELECT id, target_fingerprint, signer_fingerprint, signature_b64, signature_hash, signature_created_at, received_at, revoked FROM wot_signatures WHERE ",
    );

    match direction {
        EdgeDirection::Inbound => {
            qb.push("target_fingerprint IN (");
            let mut separated = qb.separated(", ");
            for fp in fingerprints {
                separated.push_bind(fp);
            }
            separated.push_unseparated(")");
        }
        EdgeDirection::Outbound => {
            qb.push("signer_fingerprint IN (");
            let mut separated = qb.separated(", ");
            for fp in fingerprints {
                separated.push_bind(fp);
            }
            separated.push_unseparated(")");
        }
        EdgeDirection::Both => {
            qb.push("(target_fingerprint IN (");
            {
                let mut separated = qb.separated(", ");
                for fp in fingerprints {
                    separated.push_bind(fp);
                }
                separated.push_unseparated(")");
            }
            qb.push(" OR signer_fingerprint IN (");
            {
                let mut separated = qb.separated(", ");
                for fp in fingerprints {
                    separated.push_bind(fp);
                }
                separated.push_unseparated(")");
            }
            qb.push(")");
        }
    }

    qb.push(" ORDER BY received_at DESC");

    qb.build_query_as::<WotSignatureRow>().fetch_all(pool).await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_users_by_fingerprints(
    pool: &Db,
    fingerprints: &[String],
) -> Result<HashMap<String, UserRow>, sqlx::Error> {
    if fingerprints.is_empty() {
        return Ok(HashMap::new());
    }

    let mut qb = sqlx::QueryBuilder::new(
        "SELECT id, encryption_public_key, signing_public_key, primary_key_fingerprint, created_at, updated_at FROM users WHERE primary_key_fingerprint IN (",
    );
    let mut separated = qb.separated(", ");
    for fp in fingerprints {
        separated.push_bind(fp);
    }
    separated.push_unseparated(")");

    let users = qb.build_query_as::<UserRow>().fetch_all(pool).await?;
    Ok(users
        .into_iter()
        .map(|row| (row.primary_key_fingerprint.clone(), row))
        .collect())
}
