-- ATproto accounts: CryptonユーザとAT Protocol DIDの紐付け
CREATE TABLE atproto_accounts (
    user_id TEXT NOT NULL,
    atproto_did TEXT NOT NULL,
    atproto_handle TEXT,
    pds_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, atproto_did),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_atproto_accounts_did ON atproto_accounts(atproto_did);

-- ATproto signatures: PGP署名の保存
CREATE TABLE atproto_signatures (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    atproto_did TEXT NOT NULL,
    atproto_uri TEXT NOT NULL,
    atproto_cid TEXT NOT NULL,
    collection TEXT NOT NULL,
    record_json TEXT NOT NULL,
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_atproto_signatures_uri ON atproto_signatures(atproto_uri);
CREATE INDEX idx_atproto_signatures_did ON atproto_signatures(atproto_did);
CREATE INDEX idx_atproto_signatures_user ON atproto_signatures(user_id);
CREATE UNIQUE INDEX idx_atproto_signatures_uri_cid ON atproto_signatures(atproto_uri, atproto_cid);
