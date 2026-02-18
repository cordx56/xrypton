use std::sync::Arc;

use tokio::time::{Duration, sleep};
use xrypton_api::AppState;
use xrypton_api::DidCache;
use xrypton_api::config::AppConfig;
use xrypton_api::db;
use xrypton_api::federation::dns::DnsTxtResolver;
use xrypton_api::routes::build_router;
use xrypton_api::storage::S3Storage;

const NONCE_CLEANUP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "xrypton_api=debug,tower_http=debug".parse().unwrap()),
        )
        .init();

    let config = AppConfig::from_env();
    tracing::info!("starting server on {}", config.listen_addr);

    let pool = db::connect(&config.database_url)
        .await
        .expect("failed to connect to database");
    db::migrate(&pool).await.expect("failed to run migrations");
    db::migrate_user_ids(&pool, &config.server_hostname)
        .await
        .expect("failed to migrate user IDs");
    db::migrate_primary_key_fingerprint(&pool)
        .await
        .expect("failed to migrate primary key fingerprints");

    {
        let cleanup_pool = pool.clone();
        tokio::spawn(async move {
            loop {
                match db::nonces::delete_expired_nonces(&cleanup_pool).await {
                    Ok(deleted) => {
                        tracing::info!(deleted, "nonce cleanup finished");
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "nonce cleanup failed"
                        );
                    }
                }
                sleep(NONCE_CLEANUP_INTERVAL).await;
            }
        });
    }

    let storage = Arc::new(S3Storage::new(&config).await);
    let dns_resolver = DnsTxtResolver::new(Duration::from_secs(3600));
    let did_cache = DidCache::new(Duration::from_secs(86400));

    let state = AppState {
        pool,
        config: config.clone(),
        storage,
        dns_resolver,
        did_cache,
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&config.listen_addr)
        .await
        .expect("failed to bind");
    tracing::info!("listening on {}", config.listen_addr);
    axum::serve(listener, app).await.expect("server error");
}
