use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder,
};

use crate::config::AppConfig;
use crate::db;
use crate::types::{ChatId, MessageId, ThreadId, UserId};

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

/// チャットグループの全メンバーにPush通知を送信する。
/// 送信者自身にも送信し、ペイロードに `is_self: true` を付与する（他デバイス同期用）。
/// ペイロードはJSON形式: {"type":"message","sender_id":"...","sender_name":"...","chat_id":"...","thread_id":"...","message_id":"...","is_self":bool}
pub async fn send_to_members(
    pool: &db::Db,
    config: &AppConfig,
    chat_id: &ChatId,
    sender_id: &UserId,
    thread_id: &ThreadId,
    message_id: &MessageId,
) -> Result<(), String> {
    let vapid_private = match config.vapid_private_key.as_ref() {
        Some(key) => key,
        None => return Ok(()),
    };

    let members = db::chat::get_chat_members(pool, chat_id)
        .await
        .map_err(|e| e.to_string())?;

    let client = IsahcWebPushClient::new().map_err(|e| e.to_string())?;

    // sender_idに@が含まれない場合はserver_hostnameを付与して完全修飾IDにする
    let qualified_sender_id = if sender_id.0.contains('@') {
        sender_id.0.clone()
    } else {
        format!("{}@{}", sender_id.0, config.server_hostname)
    };

    // 送信者の表示名を取得（空文字や取得失敗時はuser_idをフォールバックに使う）
    let sender_name = db::users::get_profile(pool, sender_id)
        .await
        .ok()
        .flatten()
        .map(|p| p.display_name)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| qualified_sender_id.clone());

    let payload = serde_json::json!({
        "type": "message",
        "sender_id": qualified_sender_id,
        "sender_name": sender_name,
        "chat_id": chat_id.0,
        "thread_id": thread_id.0,
        "message_id": message_id.0,
    })
    .to_string();

    let self_payload = serde_json::json!({
        "type": "message",
        "sender_id": qualified_sender_id,
        "sender_name": sender_name,
        "chat_id": chat_id.0,
        "thread_id": thread_id.0,
        "message_id": message_id.0,
        "is_self": true,
    })
    .to_string();

    // 両方を完全修飾IDに正規化して比較（ドメイン違いの同名ユーザを区別する）
    for member in &members {
        let qualified_member = if member.user_id.contains('@') {
            member.user_id.clone()
        } else {
            format!("{}@{}", member.user_id, config.server_hostname)
        };
        let is_sender = qualified_member == qualified_sender_id;
        let member_user_id = UserId(member.user_id.clone());
        let p = if is_sender { &self_payload } else { &payload };
        send_push_to_user(pool, vapid_private, &client, &member_user_id, p).await;
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
