CREATE TABLE secret_key_backups (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    armor TEXT NOT NULL,
    version INTEGER NOT NULL,
    webauthn_credential_id_b64 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_secret_key_backups_updated_at ON secret_key_backups(updated_at);
