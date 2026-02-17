pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod federation;
pub mod push;
pub mod routes;
pub mod storage;
pub mod types;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use config::AppConfig;
use federation::dns::DnsTxtResolver;
use storage::S3Storage;
use tokio::sync::RwLock;
use tokio::time::Instant;

/// DID解決結果のキャッシュ。ATproto DIDおよびハンドル解決結果をTTL付きで保持する。
#[derive(Clone)]
pub struct DidCache {
    inner: Arc<RwLock<HashMap<String, (serde_json::Value, Instant)>>>,
    ttl: Duration,
}

impl DidCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            ttl,
        }
    }

    pub async fn get(&self, key: &str) -> Option<serde_json::Value> {
        let cache = self.inner.read().await;
        cache
            .get(key)
            .filter(|(_, expires_at)| *expires_at > Instant::now())
            .map(|(value, _)| value.clone())
    }

    pub async fn set(&self, key: String, value: serde_json::Value) {
        let mut cache = self.inner.write().await;
        cache.insert(key, (value, Instant::now() + self.ttl));
    }
}

/// Application state shared across all handlers.
#[derive(Clone)]
pub struct AppState {
    pub pool: db::Db,
    pub config: AppConfig,
    pub storage: Arc<S3Storage>,
    pub dns_resolver: DnsTxtResolver,
    pub did_cache: DidCache,
}
