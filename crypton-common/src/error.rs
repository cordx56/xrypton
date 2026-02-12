#[derive(Debug, thiserror::Error)]
pub enum CryptonError {
    #[error("key format error: {0}")]
    KeyFormat(String),
    #[error("verification error: {0}")]
    Verification(String),
    #[error("invalid payload: {0}")]
    InvalidPayload(String),
}
