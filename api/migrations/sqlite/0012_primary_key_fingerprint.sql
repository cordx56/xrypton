-- signing_key_id を primary_key_fingerprint にリネーム。
-- 値の更新はランタイムマイグレーションで行う（PGP鍵のパースが必要なため）。
ALTER TABLE users RENAME COLUMN signing_key_id TO primary_key_fingerprint;
