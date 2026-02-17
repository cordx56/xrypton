-- 連合対応: FK制約の緩和とserver_domainカラム追加
-- 外部ユーザ（user@domain形式）はusersテーブルに存在しない場合があるため、
-- FK制約を外す必要がある。

PRAGMA foreign_keys = OFF;

-- chat_groups に server_domain カラムを追加
ALTER TABLE chat_groups ADD COLUMN server_domain TEXT;

-- used_nonces: user_id の FK 制約を外す
CREATE TABLE used_nonces_new (
    nonce TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO used_nonces_new SELECT * FROM used_nonces;
DROP TABLE used_nonces;
ALTER TABLE used_nonces_new RENAME TO used_nonces;

-- contacts: contact_user_id の FK 制約を外す（user_id は自ユーザなので維持）
CREATE TABLE contacts_new (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, contact_user_id)
);
INSERT INTO contacts_new SELECT * FROM contacts;
DROP TABLE contacts;
ALTER TABLE contacts_new RENAME TO contacts;

-- chat_members: user_id の FK 制約を外す（chat_id は維持）
CREATE TABLE chat_members_new (
    chat_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (chat_id, user_id)
);
INSERT INTO chat_members_new SELECT * FROM chat_members;
DROP TABLE chat_members;
ALTER TABLE chat_members_new RENAME TO chat_members;

-- messages: sender_id の FK 制約を外す（thread_id は維持）
CREATE TABLE messages_new (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    sender_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO messages_new SELECT * FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at);

PRAGMA foreign_keys = ON;
