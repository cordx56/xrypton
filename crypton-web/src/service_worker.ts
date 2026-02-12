import { z } from "zod";
import init, { decrypt } from "crypton-wasm";
import { Notification, WasmReturnValue } from "@/utils/schema";
import { getKey } from "@/utils/keyStore";

init();

// @ts-ignore
const sw: ServiceWorkerGlobalScope = self;

/** メインアプリのすべてのクライアントにメッセージを転送する */
const forwardToClients = async (data: z.infer<typeof Notification>) => {
  const clients = await sw.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage(data);
  }
};

/** 復号結果(WasmReturnValue)からプレーンテキストを抽出する */
const extractPlaintext = (
  result: z.infer<typeof WasmReturnValue>,
): string | undefined => {
  if (result.result !== "ok") return undefined;
  const first = result.value[0];
  if (!first || first.type !== "base64") return undefined;
  try {
    const raw = atob(first.data);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
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
          // iOS Safariではclients.matchAll()が空を返す場合があるため、
          // 可視判定に関係なく常にクライアントへ転送する
          await forwardToClients(notification);

          const allClients = await sw.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          const hasVisible = allClients.some(
            (c) => c.visibilityState === "visible",
          );

          // 可視クライアントがあればOS通知は不要
          if (hasVisible) return;

          // 送信者名（バックエンドが付与、なければフォールバック）
          const title = notification.sender_name ?? "New message";

          // sender_idからアイコンURLを構築（絶対URLにする）
          let icon: string | undefined;
          if (notification.sender_id) {
            icon = `${sw.location.origin}/api/v1/user/${notification.sender_id}/icon`;
          }

          const notifOptions: NotificationOptions = {
            icon,
            data: { chatId: notification.chat_id },
          };

          // 暗号文がない場合（ペイロードが大きすぎた場合）
          if (!notification.encrypted) {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "You have a new message",
            });
            return;
          }

          // IndexedDBから秘密鍵とパスフレーズを取得
          const keys = await getKey("privateKeys");
          if (!keys) {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "You have a new message",
            });
            return;
          }
          const pass = await getKey("subPassphrase");
          if (!pass) {
            await sw.registration.showNotification(title, {
              ...notifOptions,
              body: "Encrypted",
            });
            return;
          }

          // 復号を試みる
          try {
            const result = WasmReturnValue.safeParse(
              decrypt(keys, pass, notification.encrypted),
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
  }
});

/** 通知タップ時にアプリを開く/フォーカスする */
sw.addEventListener("notificationclick", (ev) => {
  ev.notification.close();

  const chatId = ev.notification.data?.chatId;
  const urlPath = chatId ? `/chat/${chatId}` : "/";

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
