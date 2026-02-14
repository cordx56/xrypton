-- 連合対応: FK制約の緩和とserver_domainカラム追加

ALTER TABLE chat_groups ADD COLUMN server_domain TEXT;

ALTER TABLE used_nonces DROP CONSTRAINT IF EXISTS used_nonces_user_id_fkey;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_user_id_fkey;
ALTER TABLE chat_members DROP CONSTRAINT IF EXISTS chat_members_user_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
