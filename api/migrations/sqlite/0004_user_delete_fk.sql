-- ユーザ削除時に外部キー制約違反を防ぐため、
-- created_by / sender_id を nullable にし ON DELETE SET NULL を設定する。
-- SQLite では ALTER COLUMN が使えないためテーブルを再作成する。

PRAGMA foreign_keys = OFF;

-- messages (他テーブルからの参照なし)
CREATE TABLE messages_new (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO messages_new SELECT * FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at);

-- threads (messages から参照されるが、上で再作成済み)
CREATE TABLE threads_new (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    archived_at TEXT
);
INSERT INTO threads_new SELECT * FROM threads;
DROP TABLE threads;
ALTER TABLE threads_new RENAME TO threads;

-- chat_groups (threads, chat_members から参照されるが、threads は再作成済み)
CREATE TABLE chat_groups_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    archived_at TEXT
);
INSERT INTO chat_groups_new SELECT * FROM chat_groups;
DROP TABLE chat_groups;
ALTER TABLE chat_groups_new RENAME TO chat_groups;

PRAGMA foreign_keys = ON;
