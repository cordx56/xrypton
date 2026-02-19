CREATE TABLE deleted_users (
    id TEXT PRIMARY KEY,
    primary_key_fingerprint TEXT,
    deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_deleted_users_fingerprint ON deleted_users(primary_key_fingerprint);
