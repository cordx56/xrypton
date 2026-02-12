use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub database_url: String,
    pub listen_addr: String,
    pub s3_bucket: String,
    pub s3_endpoint: Option<String>,
    pub s3_region: String,
    /// VAPID public key for Web Push (base64url)
    pub vapid_public_key: Option<String>,
    /// VAPID private key for Web Push (base64url)
    pub vapid_private_key: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:crypton.db?mode=rwc".into()),
            listen_addr: env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            s3_bucket: env::var("S3_BUCKET").unwrap_or_else(|_| "crypton".into()),
            s3_endpoint: env::var("S3_ENDPOINT").ok(),
            s3_region: env::var("S3_REGION").unwrap_or_else(|_| "auto".into()),
            vapid_public_key: env::var("VAPID_PUBLIC_KEY").ok(),
            vapid_private_key: env::var("VAPID_PRIVATE_KEY").ok(),
        }
    }
}
