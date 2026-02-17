use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder,
};

use crate::config::AppConfig;
use crate::db;
use crate::types::{ChatId, MessageId, ThreadId, UserId};
use xrypton_common::keys::PublicKeys;

const PGP_MESSAGE_PREFIX: &str = "-----BEGIN PGP MESSAGE-----";

/// 送信者の表示名を取得する。署名済み(PGP armored)の場合は検証して平文を抽出する。
async fn resolve_display_name(pool: &db::Db, user_id: &UserId) -> Option<String> {
    let profile = db::users::get_profile(pool, user_id).await.ok()??;
    let name = profile.display_name;
    if name.is_empty() {
        return None;
    }
    if !name.starts_with(PGP_MESSAGE_PREFIX) {
        return Some(name);
    }
    // 署名済み display_name → 公開鍵で検証して平文を抽出
    let user = db::users::get_user(pool, user_id).await.ok()??;
    let pub_keys = PublicKeys::try_from(user.signing_public_key.as_str()).ok()?;
    let plaintext_bytes = pub_keys.verify_and_extract(&name).ok()?;
    String::from_utf8(plaintext_bytes).ok()
}

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

    // 送信者の表示名を取得（署名済みの場合は平文を抽出する）
    let sender_name = resolve_display_name(pool, sender_id)
        .await
        .unwrap_or_else(|| qualified_sender_id.clone());

    // 各メンバーにrecipient_id付きのペイロードを送信
    for member in &members {
        let qualified_member = if member.user_id.contains('@') {
            member.user_id.clone()
        } else {
            format!("{}@{}", member.user_id, config.server_hostname)
        };
        let is_sender = qualified_member == qualified_sender_id;
        let member_payload = serde_json::json!({
            "type": "message",
            "sender_id": qualified_sender_id,
            "sender_name": sender_name,
            "chat_id": chat_id.0,
            "thread_id": thread_id.0,
            "message_id": message_id.0,
            "is_self": is_sender,
            "recipient_id": qualified_member,
        })
        .to_string();
        let member_user_id = UserId(member.user_id.clone());
        send_push_to_user(
            pool,
            vapid_private,
            &client,
            &member_user_id,
            &member_payload,
        )
        .await;
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

    for user_id in user_ids {
        // 各ユーザにrecipient_idを付与したペイロードを送信
        let qualified = if user_id.0.contains('@') {
            user_id.0.clone()
        } else {
            format!("{}@{}", user_id.0, config.server_hostname)
        };
        let mut user_payload = payload.clone();
        if let Some(obj) = user_payload.as_object_mut() {
            obj.insert("recipient_id".into(), serde_json::Value::String(qualified));
        }
        send_push_to_user(
            pool,
            vapid_private,
            &client,
            user_id,
            &user_payload.to_string(),
        )
        .await;
    }

    Ok(())
}
