-- endpointのみのUNIQUE制約を(endpoint, user_id)に変更
-- 同一ブラウザの複数アカウントが同じendpointでPush購読できるようにする
CREATE TABLE push_subscriptions_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(endpoint, user_id)
);

INSERT INTO push_subscriptions_new (id, user_id, endpoint, p256dh, auth, created_at)
SELECT id, user_id, endpoint, p256dh, auth, created_at
FROM push_subscriptions;

DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;
