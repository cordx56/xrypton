-- endpointのみのUNIQUE制約を(endpoint, user_id)に変更
-- 同一ブラウザの複数アカウントが同じendpointでPush購読できるようにする
ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_endpoint_key;
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_user_id_key UNIQUE (endpoint, user_id);
