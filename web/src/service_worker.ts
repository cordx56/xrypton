import { z } from "zod";
import { Notification } from "@/utils/schema";
import { getKey } from "@/utils/keyStore";
import {
  enqueuePushNotification,
  hasPushInboxEntry,
} from "@/utils/pushInboxStore";

// @ts-ignore
const sw: ServiceWorkerGlobalScope = self;

const NOTIFY_ACK_WAIT_MS = 1000;
const ORIGIN = sw.location.origin;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const resolveNotificationIconUrl = (iconUrl?: string): string | undefined => {
  if (!iconUrl) return undefined;
  if (/^https?:\/\//i.test(iconUrl)) return iconUrl;
  if (iconUrl.startsWith("/api/")) return `${ORIGIN}${iconUrl}`;
  if (iconUrl.startsWith("/v1/")) return `${ORIGIN}/api${iconUrl}`;
  if (iconUrl.startsWith("/")) return `${ORIGIN}${iconUrl}`;
  return `${ORIGIN}/${iconUrl}`;
};

const buildSenderIconUrl = (senderId?: string): string | undefined => {
  if (!senderId) return undefined;
  return `${ORIGIN}/api/v1/user/${encodeURIComponent(senderId)}/icon`;
};

sw.addEventListener("install", (event) => {
  const a = z.object({});
  a.parse({});
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(sw.clients.claim());
});

/** 連絡先外の送信者からの通知を抑制すべきか判定する。
 *  recipient_idが指定されていればそのアカウントのみ、なければ全アカウントを確認する。
 *  - 設定が無効なアカウントがあれば → 通知を表示（false）
 *  - 設定が有効で送信者が連絡先にいるアカウントがあれば → 通知を表示（false）
 *  - 対象アカウントで設定が有効かつ連絡先にいなければ → 抑制（true） */
const shouldSuppressNonContact = async (
  senderId: string,
  recipientId?: string,
): Promise<boolean> => {
  try {
    let accountIds: string[];

    if (recipientId) {
      // recipient_id指定時はそのアカウントのみ確認
      accountIds = [recipientId];
    } else {
      // フォールバック: 全アカウントを確認
      const idsRaw = await getKey("accountIds");
      if (!idsRaw) return false;
      try {
        accountIds = JSON.parse(idsRaw);
      } catch {
        return false;
      }
      if (accountIds.length === 0) return false;
    }

    for (const acctId of accountIds) {
      const hide = await getKey(`account:${acctId}:hideNonContactChannels`);
      if (hide !== "true") return false; // このアカウントはフィルタ無効 → 表示

      const contactsRaw = await getKey(`account:${acctId}:contactIds`);
      if (!contactsRaw) continue; // キャッシュなし → 判定不能、次のアカウントへ
      try {
        const contactIds: string[] = JSON.parse(contactsRaw);
        if (contactIds.includes(senderId)) return false; // 連絡先にいる → 表示
      } catch {
        continue;
      }
    }

    return true; // 対象アカウントが抑制に同意
  } catch {
    // IDB障害時は通知抑制しない（受信欠落を防ぐ）
    return false;
  }
};

sw.addEventListener("push", (ev) => {
  let rawData: unknown;
  try {
    rawData = ev.data?.json();
  } catch {
    return;
  }

  const data = Notification.safeParse(rawData);
  if (!data.success) {
    return;
  }

  const notification = data.data;
  ev.waitUntil(
    (async () => {
      let inboxKey: string | null = null;
      try {
        inboxKey = await enqueuePushNotification(notification);
      } catch {
        // IndexedDB 書き込み失敗時も通知表示は継続する
      }

      const shouldShowAfterAckWait = async () => {
        await sleep(NOTIFY_ACK_WAIT_MS);
        if (!inboxKey) return true;
        try {
          return await hasPushInboxEntry(inboxKey);
        } catch {
          return true;
        }
      };

      switch (notification.type) {
        case "message": {
          if (notification.is_self) return;
          if (notification.sender_id) {
            const shouldSuppress = await shouldSuppressNonContact(
              notification.sender_id,
              notification.recipient_id,
            );
            if (shouldSuppress) return;
          }
          if (!(await shouldShowAfterAckWait())) return;
          const icon =
            resolveNotificationIconUrl(notification.icon_url) ??
            buildSenderIconUrl(notification.sender_id);
          await sw.registration.showNotification(
            notification.sender_name || "New message",
            {
              body: "You have a new message",
              tag: `msg-${notification.thread_id ?? notification.chat_id ?? "default"}`,
              icon,
              data: {
                chatId: notification.chat_id,
                threadId: notification.thread_id,
              },
            },
          );
          break;
        }

        case "added_to_group": {
          if (!(await shouldShowAfterAckWait())) return;
          await sw.registration.showNotification("New group", {
            body: `Added to group '${notification.name}'`,
            data: { chatId: notification.chat_id },
          });
          break;
        }

        case "new_thread": {
          if (!(await shouldShowAfterAckWait())) return;
          await sw.registration.showNotification("New thread", {
            body: `New thread '${notification.name}'`,
            data: { chatId: notification.chat_id },
          });
          break;
        }

        case "realtime_offer": {
          if (!(await shouldShowAfterAckWait())) return;
          await sw.registration.showNotification("Real-time Chat", {
            body: `Real-time chat: ${notification.name}`,
            data: {
              chatId: notification.chat_id,
              type: "realtime",
            },
          });
          break;
        }

        case "realtime_answer": {
          break;
        }
      }
    })(),
  );
});

/** 通知タップ時にアプリを開く/フォーカスする */
sw.addEventListener("notificationclick", (ev) => {
  ev.notification.close();

  const chatId = ev.notification.data?.chatId;
  const threadId = ev.notification.data?.threadId;
  const urlPath =
    chatId && threadId
      ? `/chat/${chatId}/${threadId}`
      : chatId
        ? `/chat/${chatId}`
        : "/";

  ev.waitUntil(
    sw.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // 既に開いているウィンドウがあればフォーカス
        for (const client of clients) {
          if ("focus" in client) {
            return client.focus();
          }
        }
        // なければ新しいウィンドウを開く
        return sw.clients.openWindow(urlPath);
      }),
  );
});
