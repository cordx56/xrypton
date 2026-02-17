-- ユーザ削除時に外部キー制約違反を防ぐため、
-- created_by / sender_id を nullable にし ON DELETE SET NULL を設定する。

-- chat_groups.created_by
ALTER TABLE chat_groups ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE chat_groups DROP CONSTRAINT chat_groups_created_by_fkey;
ALTER TABLE chat_groups ADD CONSTRAINT chat_groups_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- threads.created_by
ALTER TABLE threads ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE threads DROP CONSTRAINT threads_created_by_fkey;
ALTER TABLE threads ADD CONSTRAINT threads_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- messages.sender_id
ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;
