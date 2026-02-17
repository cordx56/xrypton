-- ファイル送受信機能: filesテーブル追加とmessagesにfile_idカラム追加

CREATE TABLE files (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    s3_key TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE messages ADD COLUMN file_id TEXT REFERENCES files(id);
