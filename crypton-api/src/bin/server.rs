use std::sync::Arc;

use crypton_api::AppState;
use crypton_api::config::AppConfig;
use crypton_api::db;
use crypton_api::routes::build_router;
use crypton_api::storage::S3Storage;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "crypton_api=debug,tower_http=debug".parse().unwrap()),
        )
        .init();

    let config = AppConfig::from_env();
    tracing::info!("starting server on {}", config.listen_addr);

    let pool = db::connect(&config.database_url)
        .await
        .expect("failed to connect to database");
    db::migrate(&pool).await.expect("failed to run migrations");

    let storage = Arc::new(S3Storage::new(&config).await);

    let state = AppState {
        pool,
        config: config.clone(),
        storage,
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(&config.listen_addr)
        .await
        .expect("failed to bind");
    tracing::info!("listening on {}", config.listen_addr);
    axum::serve(listener, app).await.expect("server error");
}
