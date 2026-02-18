import { z } from "zod";
import init, { decrypt, sign } from "xrypton-wasm";
import { Notification, WasmReturnValue } from "@/utils/schema";
import { decodeBase64Url } from "@/utils/base64";
import { getKey } from "@/utils/keyStore";

/** アクティブアカウントのプレフィックス付きキーを取得する */
const getAccountKey = async (key: string): Promise<string | undefined> => {
  const activeId = await getKey("activeAccountId");
  if (!activeId) return getKey(key);
  return getKey(`account:${activeId}:${key}`);
};

const wasmReady = init();

// @ts-ignore
const sw: ServiceWorkerGlobalScope = self;

/** メインアプリのすべてのクライアントにメッセージを転送する。
 *  可視状態のクライアントに転送できた場合は true を返す。 */
const forwardToClients = async (
  data: z.infer<typeof Notification>,
): Promise<boolean> => {
  const clients = await sw.clients.matchAll({ type: "window" });
  let hasVisible = false;
  for (const client of clients) {
    client.postMessage(data);
    if ((client as WindowClient).visibilityState === "visible") {
      hasVisible = true;
    }
  }
  return hasVisible;
};

/** 復号結果(WasmReturnValue)からプレーンテキストを抽出する */
const extractPlaintext = (
  result: z.infer<typeof WasmReturnValue>,
): string | undefined => {
  if (result.result !== "ok") return undefined;
  const first = result.value[0];
  if (!first || first.type !== "base64") return undefined;
  try {
    return decodeBase64Url(first.data);
  } catch {
    return undefined;
  }
};

/** 認証付きfetchヘルパー。WASM sign()でPGP署名を生成しAuthorizationヘッダに付与する */
const authenticatedFetch = async (
  url: string,
  privateKeys: string,
  subPassphrase: string,
): Promise<Response | null> => {
  try {
    const payload = JSON.stringify({
      nonce: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    const encoded = new TextEncoder().encode(payload);
    const signResult = WasmReturnValue.safeParse(
      sign(privateKeys, subPassphrase, encoded),
    );
    if (
      !signResult.success ||
      signResult.data.result !== "ok" ||
      signResult.data.value[0]?.type !== "base64"
    ) {
      return null;
    }
    // base64urlエンコードされたarmoredメッセージをデコード
    const armoredMessage = decodeBase64Url(signResult.data.value[0].data);
    const resp = await fetch(url, {
      headers: { Authorization: btoa(armoredMessage) },
    });
    if (!resp.ok) return null;
    return resp;
  } catch {
    return null;
  }
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
};

sw.addEventListener("push", (ev) => {
  const data = Notification.safeParse(ev.data?.json());
  if (!data.success) {
    return;
  }

  const notification = data.data;

  switch (notification.type) {
    case "message": {
      ev.waitUntil(
        (async () => {
          // クライアントへ転送（自己メッセージでもデータ同期のため転送する）
          const hasVisible = await forwardToClients(notification);

          // 自己メッセージはデータ同期のみでブラウザ通知を表示しない
          if (notification.is_self) return;

          // 連絡先外を非表示にする設定: recipient_idで対象アカウントを特定して判定
          if (notification.sender_id) {
            const shouldSuppress = await shouldSuppressNonContact(
              notification.sender_id,
              notification.recipient_id,
            );
            if (shouldSuppress) return;
          }

          // 可視クライアントがいればブラウザ通知をスキップ
          // iOS Safariではclients.matchAll()が空を返す場合があるが、
          // その場合は hasVisible=false となりフォールバックで通知を表示する
          if (hasVisible) return;

          // 送信者名（バックエンドが付与、空文字やundefinedならフォールバック）
          const title = notification.sender_name || "New message";

          // sender_idからアイコンURLを構築（絶対URLにする）
          let icon: string | undefined;
          if (notification.sender_id) {
            icon = `${sw.location.origin}/api/v1/user/${encodeURIComponent(notification.sender_id)}/icon`;
          }

          const notifOptions: NotificationOptions = {
            icon,
            tag: `msg-${notification.thread_id ?? notification.chat_id ?? "default"}`,
            data: {
              chatId: notification.chat_id,
              threadId: notification.thread_id,
            },
          };

          // thread_id / message_id がない場合はフォールバック表示
          if (!notification.thread_id || !notification.message_id) {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "You have a new message",
            });
            return;
          }

          // IndexedDBからアクティブアカウントの秘密鍵とパスフレーズを取得
          const keys = await getAccountKey("privateKeys");
          if (!keys) {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "You have a new message",
            });
            return;
          }
          const pass = await getAccountKey("subPassphrase");
          if (!pass) {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "Encrypted",
            });
            return;
          }

          // APIからメッセージを取得して復号（WASM初期化失敗時はフォールバック通知）
          try {
            await wasmReady;
            const apiUrl = `${sw.location.origin}/api/v1/chat/${notification.chat_id}/${notification.thread_id}/message/${notification.message_id}`;
            const resp = await authenticatedFetch(apiUrl, keys, pass);
            if (!resp) {
              await sw.registration.showNotification(title, {
                ...notifOptions,
                body: "You have a new message",
              });
              return;
            }

            const msg = await resp.json();
            const content = msg.content;
            if (!content || typeof content !== "string") {
              await sw.registration.showNotification(title, {
                ...notifOptions,
                body: "You have a new message",
              });
              return;
            }

            const result = WasmReturnValue.safeParse(
              decrypt(keys, pass, content),
            );
            if (!result.success) {
              await sw.registration.showNotification(title, {
                ...notifOptions,
                body: "You have a new message",
              });
              return;
            }
            const plaintext = extractPlaintext(result.data);
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: plaintext ?? "You have a new message",
            });
          } catch {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "You have a new message",
            });
          }
        })(),
      );
      break;
    }

    case "added_to_group": {
      ev.waitUntil(
        (async () => {
          await sw.registration.showNotification("New group", {
            body: `Added to group '${notification.name}'`,
          });
          await forwardToClients(notification);
        })(),
      );
      break;
    }

    case "new_thread": {
      ev.waitUntil(
        (async () => {
          await sw.registration.showNotification("New thread", {
            body: `New thread '${notification.name}'`,
          });
          await forwardToClients(notification);
        })(),
      );
      break;
    }

    case "realtime_offer": {
      ev.waitUntil(
        (async () => {
          const hasVisible = await forwardToClients(notification);
          if (!hasVisible) {
            await sw.registration.showNotification("Real-time Chat", {
              body: `Real-time chat: ${notification.name}`,
              data: {
                chatId: notification.chat_id,
                type: "realtime",
              },
            });
          }
        })(),
      );
      break;
    }

    case "realtime_answer": {
      ev.waitUntil(forwardToClients(notification));
      break;
    }
  }
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
