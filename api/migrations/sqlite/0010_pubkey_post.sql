-- ATprotoアカウントに公開鍵検証投稿のURIを保存
ALTER TABLE atproto_accounts ADD COLUMN pubkey_post_uri TEXT;
