pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod federation;
pub mod push;
pub mod routes;
pub mod storage;
pub mod types;

use std::sync::Arc;

use config::AppConfig;
use federation::dns::DnsTxtResolver;
use storage::S3Storage;

/// Application state shared across all handlers.
#[derive(Clone)]
pub struct AppState {
    pub pool: db::Db,
    pub config: AppConfig,
    pub storage: Arc<S3Storage>,
    pub dns_resolver: DnsTxtResolver,
}
