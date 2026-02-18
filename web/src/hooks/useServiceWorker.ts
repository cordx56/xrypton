import { useState, useEffect, useCallback, useRef } from "react";
import { z } from "zod";
import { apiClient, authApiClient } from "@/api/client";
import { fromBase64Url } from "@/utils/base64";
import { Notification } from "@/utils/schema";

export const useServiceWorker = (
  onEvent?: (data: z.infer<typeof Notification>) => void,
) => {
  const [registration, setRegistration] = useState<
    ServiceWorkerRegistration | undefined
  >(undefined);
  // onEventをrefで保持し、リスナー再登録によるイベント取りこぼしを防ぐ
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service_worker.js", { scope: "/" })
        .then(setRegistration)
        .catch(() => {});
    }
  }, []);

  // SWからのpostMessageをリッスンし、onEventに転送
  // ページが可視状態の場合はSWが表示した通知を閉じる（アプリ内通知に置き換えるため）
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = async (event: MessageEvent) => {
      const parsed = Notification.safeParse(event.data);
      if (parsed.success && onEventRef.current) {
        onEventRef.current(parsed.data);
        // SWはuserVisibleOnly制約のため常に通知を表示するので、
        // ページが可視状態ならSW通知を閉じてアプリ内通知のみにする
        if (document.visibilityState === "visible" && registration) {
          const notifications = await registration.getNotifications();
          for (const n of notifications) {
            n.close();
          }
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [registration]);

  const subscribe = useCallback(
    async (signedMessage: string) => {
      if (!registration) return false;
      try {
        const key = await apiClient().notification.publicKey();
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: fromBase64Url(key).buffer as ArrayBuffer,
        });
        await authApiClient(signedMessage).notification.subscribe(subscription);
        return true;
      } catch {
        // push subscription failed
        return false;
      }
    },
    [registration],
  );

  return { registration, subscribe };
};
