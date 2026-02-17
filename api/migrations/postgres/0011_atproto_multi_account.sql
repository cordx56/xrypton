-- 複数のXryptonアカウントが同一ATProto DIDを紐付け可能にする
DROP INDEX idx_atproto_accounts_did;
CREATE INDEX idx_atproto_accounts_did ON atproto_accounts(atproto_did);
