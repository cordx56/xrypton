CREATE TABLE deleted_users (
    id TEXT PRIMARY KEY,
    primary_key_fingerprint TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deleted_users_fingerprint ON deleted_users(primary_key_fingerprint);
