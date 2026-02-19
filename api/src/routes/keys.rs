use std::collections::HashSet;
use std::time::{Duration, Instant};

use axum::extract::{Path, Query, State};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::auth::AuthenticatedUser;
use crate::db;
use crate::db::models::WotSignatureRow;
use crate::db::nonces::NonceType;
use crate::db::wot::EdgeDirection;
use crate::error::AppError;

const SIGNATURE_MAX_BYTES: usize = 16 * 1024;
const QR_NONCE_WINDOW_SECONDS: i64 = 5 * 60;
const DEFAULT_MAX_DEPTH: u32 = 2;
const MAX_MAX_DEPTH: u32 = 4;
const DEFAULT_MAX_NODES: usize = 200;
const MAX_MAX_NODES: usize = 1000;
const DEFAULT_MAX_EDGES: usize = 500;
const MAX_MAX_EDGES: usize = 3000;
const TIME_BUDGET_MS: u64 = 1200;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/keys/{fingerprint}", axum::routing::get(get_key))
        .route(
            "/keys/{fingerprint}/signature",
            axum::routing::post(post_signature),
        )
        .route(
            "/keys/{fingerprint}/signatures",
            axum::routing::get(get_signatures),
        )
}

fn validate_fingerprint(fingerprint: &str) -> Result<(), AppError> {
    let valid = (40..=128).contains(&fingerprint.len())
        && fingerprint.len().is_multiple_of(2)
        && fingerprint
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_lowercase());
    if valid {
        Ok(())
    } else {
        Err(AppError::BadRequest("invalid fingerprint format".into()))
    }
}

#[derive(Serialize)]
struct GetKeyResponse {
    fingerprint: String,
    armored_public_key: String,
    user_id: String,
    revoked: bool,
    fetched_at: String,
}

async fn get_key(
    State(state): State<AppState>,
    Path(fingerprint): Path<String>,
) -> Result<Json<GetKeyResponse>, AppError> {
    validate_fingerprint(&fingerprint)?;
    let user = db::users::get_user_by_fingerprint(&state.pool, &fingerprint)
        .await?
        .ok_or_else(|| AppError::NotFound("key not found".into()))?;

    Ok(Json(GetKeyResponse {
        fingerprint: user.primary_key_fingerprint,
        armored_public_key: user.signing_public_key,
        user_id: user.id,
        revoked: false,
        fetched_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

#[derive(Deserialize)]
struct NoncePayload {
    random: String,
    time: String,
}

#[derive(Deserialize)]
struct PostSignatureBody {
    signature_b64: String,
    signature_type: String,
    hash_algo: String,
    qr_nonce: NoncePayload,
}

#[derive(Serialize)]
struct PostSignatureResponse {
    signature_id: String,
    target_fingerprint: String,
    signer_fingerprint: String,
    received_at: String,
}

async fn post_signature(
    State(state): State<AppState>,
    Path(fingerprint): Path<String>,
    auth: AuthenticatedUser,
    Json(body): Json<PostSignatureBody>,
) -> Result<Json<PostSignatureResponse>, AppError> {
    validate_fingerprint(&fingerprint)?;

    if body.signature_type != "certification" {
        return Err(AppError::BadRequest(
            "signature_type must be certification".into(),
        ));
    }
    if body.hash_algo != "sha256" {
        return Err(AppError::BadRequest("hash_algo must be sha256".into()));
    }

    let nonce_uuid = uuid::Uuid::parse_str(&body.qr_nonce.random)
        .map_err(|_| AppError::BadRequest("invalid qr_nonce.random".into()))?;
    let nonce_time: chrono::DateTime<chrono::Utc> = body
        .qr_nonce
        .time
        .parse()
        .map_err(|_| AppError::BadRequest("invalid qr_nonce.time".into()))?;
    let diff = (chrono::Utc::now() - nonce_time).num_seconds().abs();
    if diff > QR_NONCE_WINDOW_SECONDS {
        return Err(AppError::BadRequest(
            "qr_nonce timestamp out of range".into(),
        ));
    }

    let raw = STANDARD
        .decode(&body.signature_b64)
        .map_err(|_| AppError::BadRequest("invalid base64 signature".into()))?;
    if raw.len() > SIGNATURE_MAX_BYTES {
        return Err(AppError::PayloadTooLarge(
            "signature payload too large".into(),
        ));
    }

    let info = xrypton_common::keys::parse_certification_signature_info_from_bytes(&raw)
        .map_err(|e| AppError::BadRequest(format!("invalid signature packet: {e}")))?;
    if !info.is_certification {
        return Err(AppError::BadRequest(
            "signature is not certification type".into(),
        ));
    }
    let signer_public_keys =
        xrypton_common::keys::PublicKeys::try_from(auth.signing_public_key.as_str())
            .map_err(|e| AppError::Unauthorized(format!("invalid signer key: {e}")))?;
    let signer_primary_fingerprint = signer_public_keys.get_primary_fingerprint();
    if signer_primary_fingerprint != auth.primary_key_fingerprint {
        return Err(AppError::Forbidden(
            "authenticated signer fingerprint mismatch".into(),
        ));
    }
    if signer_primary_fingerprint == fingerprint {
        return Err(AppError::BadRequest("self-signature is not allowed".into()));
    }

    let target_user = db::users::get_user_by_fingerprint(&state.pool, &fingerprint)
        .await?
        .ok_or_else(|| AppError::NotFound("target key not found".into()))?;
    let valid_target = xrypton_common::keys::verify_certification_signature_for_target(
        &auth.signing_public_key,
        &target_user.signing_public_key,
        &raw,
    )
    .map_err(|e| AppError::BadRequest(format!("signature verification failed: {e}")))?;
    if !valid_target {
        return Err(AppError::BadRequest(
            "signature does not certify target key".into(),
        ));
    }

    let nonce_is_new = db::nonces::try_use_nonce(
        &state.pool,
        NonceType::Qr,
        &nonce_uuid.to_string(),
        auth.user_id.as_str(),
        nonce_time + chrono::Duration::minutes(5),
    )
    .await?;
    if !nonce_is_new {
        return Err(AppError::Conflict("qr_nonce already used".into()));
    }

    let hash = Sha256::digest(&raw);
    let signature_hash = format!("sha256:{}", to_hex(&hash));
    let signature_id = format!("sig_{}", uuid::Uuid::new_v4().simple());
    let inserted = db::wot::insert_signature(
        &state.pool,
        &signature_id,
        &fingerprint,
        &signer_primary_fingerprint,
        &body.signature_b64,
        &signature_hash,
        info.created_at,
    )
    .await?;
    if !inserted {
        return Err(AppError::Conflict("signature already exists".into()));
    }

    Ok(Json(PostSignatureResponse {
        signature_id,
        target_fingerprint: fingerprint,
        signer_fingerprint: signer_primary_fingerprint,
        received_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

fn to_hex(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(data.len() * 2);
    for b in data {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[derive(Debug, Deserialize)]
struct SignatureQuery {
    max_depth: Option<u32>,
    max_nodes: Option<usize>,
    max_edges: Option<usize>,
    direction: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SignatureNodeResponse {
    fingerprint: String,
    user_id: Option<String>,
    revoked: bool,
}

#[derive(Serialize, Deserialize)]
struct SignatureEdgeResponse {
    signature_id: String,
    from_fingerprint: String,
    to_fingerprint: String,
    signature_b64: String,
    signature_hash: String,
    received_at: crate::db::models::Timestamp,
    revoked: bool,
}

#[derive(Serialize, Deserialize)]
struct LimitsApplied {
    depth_capped: bool,
    node_capped: bool,
    edge_capped: bool,
    time_budget_ms: u64,
}

#[derive(Serialize, Deserialize)]
struct SignatureMeta {
    server_time: String,
    truncated: bool,
    next_cursor: Option<String>,
    limits_applied: LimitsApplied,
    data_freshness_sec: u64,
}

#[derive(Serialize, Deserialize)]
struct SignatureQueryEcho {
    max_depth: u32,
    max_nodes: usize,
    max_edges: usize,
    direction: String,
}

#[derive(Serialize, Deserialize)]
struct SignatureGraphResponse {
    root_fingerprint: String,
    query: SignatureQueryEcho,
    nodes: Vec<SignatureNodeResponse>,
    edges: Vec<SignatureEdgeResponse>,
    meta: SignatureMeta,
}

/// 外部ユーザのホームサーバに署名グラフリクエストをプロキシする。
async fn proxy_get_signatures(
    state: &AppState,
    domain: &str,
    fingerprint: &str,
    query: &SignatureQuery,
    auth_header: &str,
) -> Result<Json<SignatureGraphResponse>, AppError> {
    let base = crate::federation::client::base_url(domain, state.config.federation_allow_http);
    let mut params = Vec::new();
    if let Some(d) = query.max_depth {
        params.push(format!("max_depth={d}"));
    }
    if let Some(n) = query.max_nodes {
        params.push(format!("max_nodes={n}"));
    }
    if let Some(e) = query.max_edges {
        params.push(format!("max_edges={e}"));
    }
    if let Some(ref dir) = query.direction {
        params.push(format!("direction={dir}"));
    }
    let qs = if params.is_empty() {
        String::new()
    } else {
        format!("?{}", params.join("&"))
    };
    let url = format!(
        "{base}/v1/keys/{}/signatures{qs}",
        urlencoding::encode(fingerprint),
    );

    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", auth_header)
        .send()
        .await
        .map_err(|e| AppError::BadGateway(format!("federation signatures proxy failed: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::BadGateway(format!(
            "federation signatures proxy returned {status}: {body}"
        )));
    }
    resp.json::<SignatureGraphResponse>()
        .await
        .map_err(|e| AppError::BadGateway(format!("invalid federation signatures response: {e}")))
        .map(Json)
}

async fn get_signatures(
    State(state): State<AppState>,
    Path(fingerprint): Path<String>,
    Query(query): Query<SignatureQuery>,
    auth: AuthenticatedUser,
) -> Result<Json<SignatureGraphResponse>, AppError> {
    validate_fingerprint(&fingerprint)?;

    let user = db::users::get_user_by_fingerprint(&state.pool, &fingerprint)
        .await?
        .ok_or_else(|| AppError::NotFound("key not found".into()))?;

    // 外部ユーザの場合、ホームサーバにプロキシ
    if let Some((_local, domain)) = user.id.split_once('@')
        && domain != state.config.server_hostname
    {
        return proxy_get_signatures(&state, domain, &fingerprint, &query, &auth.raw_auth_header)
            .await;
    }

    let direction = match query.direction.as_deref().unwrap_or("inbound") {
        "inbound" => EdgeDirection::Inbound,
        "outbound" => EdgeDirection::Outbound,
        "both" => EdgeDirection::Both,
        _ => return Err(AppError::BadRequest("invalid direction".into())),
    };
    let direction_echo = match direction {
        EdgeDirection::Inbound => "inbound".to_string(),
        EdgeDirection::Outbound => "outbound".to_string(),
        EdgeDirection::Both => "both".to_string(),
    };
    let max_depth = query
        .max_depth
        .unwrap_or(DEFAULT_MAX_DEPTH)
        .clamp(1, MAX_MAX_DEPTH);
    let max_nodes = query
        .max_nodes
        .unwrap_or(DEFAULT_MAX_NODES)
        .clamp(1, MAX_MAX_NODES);
    let max_edges = query
        .max_edges
        .unwrap_or(DEFAULT_MAX_EDGES)
        .clamp(1, MAX_MAX_EDGES);

    let start = Instant::now();
    let budget = Duration::from_millis(TIME_BUDGET_MS);

    let mut visited_nodes: HashSet<String> = HashSet::from([fingerprint.clone()]);
    let mut frontier: Vec<String> = vec![fingerprint.clone()];
    let mut edge_seen: HashSet<String> = HashSet::new();
    let mut collected_edges: Vec<WotSignatureRow> = Vec::new();

    let mut depth_capped = false;
    let mut node_capped = false;
    let mut edge_capped = false;
    let mut truncated = false;
    let mut last_depth = 0_u32;

    while last_depth < max_depth && !frontier.is_empty() {
        if start.elapsed() >= budget {
            truncated = true;
            break;
        }
        last_depth += 1;

        let frontier_set: HashSet<&str> = frontier.iter().map(String::as_str).collect();
        let edges = db::wot::get_edges_for_frontier(&state.pool, &frontier, direction).await?;
        let mut next_candidates: HashSet<String> = HashSet::new();

        for edge in edges {
            if edge.signer_fingerprint == edge.target_fingerprint {
                // 自己署名は表示・探索対象から除外する
                continue;
            }
            let is_relevant = match direction {
                EdgeDirection::Inbound => frontier_set.contains(edge.target_fingerprint.as_str()),
                EdgeDirection::Outbound => frontier_set.contains(edge.signer_fingerprint.as_str()),
                EdgeDirection::Both => {
                    frontier_set.contains(edge.target_fingerprint.as_str())
                        || frontier_set.contains(edge.signer_fingerprint.as_str())
                }
            };
            if !is_relevant || edge_seen.contains(&edge.id) {
                continue;
            }

            if collected_edges.len() >= max_edges {
                edge_capped = true;
                truncated = true;
                break;
            }

            edge_seen.insert(edge.id.clone());
            match direction {
                EdgeDirection::Inbound => {
                    next_candidates.insert(edge.signer_fingerprint.clone());
                }
                EdgeDirection::Outbound => {
                    next_candidates.insert(edge.target_fingerprint.clone());
                }
                EdgeDirection::Both => {
                    if frontier_set.contains(edge.target_fingerprint.as_str()) {
                        next_candidates.insert(edge.signer_fingerprint.clone());
                    }
                    if frontier_set.contains(edge.signer_fingerprint.as_str()) {
                        next_candidates.insert(edge.target_fingerprint.clone());
                    }
                }
            }
            collected_edges.push(edge);
        }

        if edge_capped {
            break;
        }

        let mut next_frontier = Vec::new();
        for fp in next_candidates {
            if visited_nodes.contains(&fp) {
                continue;
            }
            if visited_nodes.len() >= max_nodes {
                node_capped = true;
                truncated = true;
                break;
            }
            visited_nodes.insert(fp.clone());
            next_frontier.push(fp);
        }
        frontier = next_frontier;
    }

    if last_depth >= max_depth && !frontier.is_empty() {
        depth_capped = true;
        truncated = true;
    }
    if start.elapsed() >= budget {
        truncated = true;
    }

    let mut node_fingerprints: Vec<String> = visited_nodes.into_iter().collect();
    node_fingerprints.sort_unstable();
    let users = db::wot::get_users_by_fingerprints(&state.pool, &node_fingerprints).await?;

    // 削除済みユーザーの fingerprint を除外
    let deleted_fps: HashSet<String> =
        db::deleted_users::get_deleted_fingerprints(&state.pool, &node_fingerprints)
            .await?
            .into_iter()
            .collect();

    let nodes = node_fingerprints
        .iter()
        .filter(|fp| !deleted_fps.contains(fp.as_str()))
        .map(|fp| SignatureNodeResponse {
            fingerprint: fp.clone(),
            user_id: users.get(fp).map(|u| u.id.clone()),
            revoked: false,
        })
        .collect();

    let edges = collected_edges
        .into_iter()
        .filter(|edge| {
            !deleted_fps.contains(&edge.signer_fingerprint)
                && !deleted_fps.contains(&edge.target_fingerprint)
        })
        .map(|edge| SignatureEdgeResponse {
            signature_id: edge.id,
            from_fingerprint: edge.signer_fingerprint,
            to_fingerprint: edge.target_fingerprint,
            signature_b64: edge.signature_b64,
            signature_hash: edge.signature_hash,
            received_at: edge.received_at,
            revoked: edge.revoked,
        })
        .collect();

    let response = SignatureGraphResponse {
        root_fingerprint: fingerprint,
        query: SignatureQueryEcho {
            max_depth,
            max_nodes,
            max_edges,
            direction: direction_echo,
        },
        nodes,
        edges,
        meta: SignatureMeta {
            server_time: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            truncated,
            next_cursor: None,
            limits_applied: LimitsApplied {
                depth_capped,
                node_capped,
                edge_capped,
                time_budget_ms: TIME_BUDGET_MS,
            },
            data_freshness_sec: start.elapsed().as_secs(),
        },
    };
    Ok(Json(response))
}
