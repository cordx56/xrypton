DROP TABLE IF EXISTS used_nonces;

CREATE TABLE nonces (
    nonce_type TEXT NOT NULL,
    nonce_value TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    signature_created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_wot_signatures_target ON wot_signatures(target_fingerprint);
CREATE INDEX idx_wot_signatures_signer ON wot_signatures(signer_fingerprint);
