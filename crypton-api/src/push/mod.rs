use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder,
};

use crate::config::AppConfig;
use crate::db;
use crate::types::{ChatId, UserId};

/// 1ユーザの全サブスクリプションにPush通知を送信する内部ヘルパー。
async fn send_push_to_user(
    pool: &db::Db,
    vapid_private: &str,
    client: &IsahcWebPushClient,
    user_id: &UserId,
    payload: &str,
) {
    let subscriptions = match db::push::get_subscriptions_for_user(pool, user_id).await {
        Ok(subs) => subs,
        Err(e) => {
            tracing::warn!("failed to get subscriptions for {user_id}: {e}");
            return;
        }
    };

    for sub in &subscriptions {
        let subscription = SubscriptionInfo::new(&sub.endpoint, &sub.p256dh, &sub.auth);

        let partial = match VapidSignatureBuilder::from_base64_no_sub(vapid_private) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("vapid key error: {e}");
                continue;
            }
        };
        let sig = match partial.add_sub_info(&subscription).build() {
            Ok(sig) => sig,
            Err(e) => {
                tracing::warn!("vapid build error: {e}");
                continue;
            }
        };

        let mut msg_builder = WebPushMessageBuilder::new(&subscription);
        msg_builder.set_vapid_signature(sig);
        msg_builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());

        let message = match msg_builder.build() {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("push message build error: {e}");
                continue;
            }
        };

        match client.send(message).await {
            Ok(()) => {}
            Err(e) => {
                let err_str = e.to_string();
                // 410 Gone: 購読が無効化されたので削除
                if err_str.contains("410") {
                    tracing::info!("removing expired subscription for {user_id}");
                    let _ = db::push::delete_subscription_by_endpoint(pool, &sub.endpoint).await;
                } else {
                    tracing::warn!("push send error for {user_id}: {e}");
                }
            }
        }
    }
}

/// チャットグループの全メンバー（送信者除く）にPush通知を送信する。
/// ペイロードはJSON形式: {"type":"message","sender_id":"...","sender_name":"...","chat_id":"...","encrypted":"..."}
pub async fn send_to_members(
    pool: &db::Db,
    config: &AppConfig,
    chat_id: &ChatId,
    sender_id: &UserId,
    encrypted_content: &str,
) -> Result<(), String> {
    let vapid_private = match config.vapid_private_key.as_ref() {
        Some(key) => key,
        None => return Ok(()),
    };

    let members = db::chat::get_chat_members(pool, chat_id)
        .await
        .map_err(|e| e.to_string())?;

    let client = IsahcWebPushClient::new().map_err(|e| e.to_string())?;

    // 送信者の表示名を取得（取得失敗時はuser_idをフォールバックに使う）
    let sender_name = db::users::get_profile(pool, sender_id)
        .await
        .ok()
        .flatten()
        .map(|p| p.display_name)
        .unwrap_or_else(|| sender_id.0.clone());

    // Web Pushペイロードは約4KBまで。暗号文が大きすぎる場合はencryptedなしで送信
    let payload = if encrypted_content.len() <= 3500 {
        serde_json::json!({
            "type": "message",
            "sender_id": sender_id.0,
            "sender_name": sender_name,
            "chat_id": chat_id.0,
            "encrypted": encrypted_content,
        })
    } else {
        serde_json::json!({
            "type": "message",
            "sender_id": sender_id.0,
            "sender_name": sender_name,
            "chat_id": chat_id.0,
        })
    }
    .to_string();

    for member in &members {
        if member.user_id == sender_id.as_str() {
            continue;
        }
        let member_user_id = UserId(member.user_id.clone());
        send_push_to_user(pool, vapid_private, &client, &member_user_id, &payload).await;
    }

    Ok(())
}

/// 指定ユーザ群に任意JSONペイロードのPush通知を送信する。
pub async fn send_event_to_users(
    pool: &db::Db,
    config: &AppConfig,
    user_ids: &[UserId],
    payload: &serde_json::Value,
) -> Result<(), String> {
    let vapid_private = match config.vapid_private_key.as_ref() {
        Some(key) => key,
        None => return Ok(()),
    };

    let client = IsahcWebPushClient::new().map_err(|e| e.to_string())?;
    let payload_str = payload.to_string();

    for user_id in user_ids {
        send_push_to_user(pool, vapid_private, &client, user_id, &payload_str).await;
    }

    Ok(())
}
