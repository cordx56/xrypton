import { useState, useEffect, useCallback } from "react";
import { apiClient, authApiClient } from "@/api/client";
import { fromBase64Url } from "@/utils/base64";

export const useServiceWorker = () => {
  const [registration, setRegistration] = useState<
    ServiceWorkerRegistration | undefined
  >(undefined);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service_worker.js", { scope: "/" })
        .then(setRegistration)
        .catch(() => {});
    }
  }, []);

  const subscribe = useCallback(
    async (signedMessage: string) => {
      if (!registration) return false;
      try {
        // 既存の購読があればそれを再利用し、なければ新規作成
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          const key = await apiClient().notification.publicKey();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: fromBase64Url(key).buffer as ArrayBuffer,
          });
        }
        // 現在のアカウントの署名でバックエンドに登録（アカウント切替時も確実に紐付ける）
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
