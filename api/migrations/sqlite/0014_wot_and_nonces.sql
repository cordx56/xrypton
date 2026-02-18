DROP TABLE IF EXISTS used_nonces;

CREATE TABLE nonces (
    nonce_type TEXT NOT NULL,
    nonce_value TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (nonce_type, nonce_value)
);
CREATE INDEX idx_nonces_expires_at ON nonces(expires_at);
CREATE INDEX idx_nonces_user_id ON nonces(user_id);

CREATE TABLE wot_signatures (
    id TEXT PRIMARY KEY,
    target_fingerprint TEXT NOT NULL,
    signer_fingerprint TEXT NOT NULL,
    signature_b64 TEXT NOT NULL,
    signature_hash TEXT NOT NULL UNIQUE,
    signature_created_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_wot_signatures_target ON wot_signatures(target_fingerprint);
CREATE INDEX idx_wot_signatures_signer ON wot_signatures(signer_fingerprint);
