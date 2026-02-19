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

  const resolveRegistration = useCallback(async () => {
    if (registration) return registration;
    if (!("serviceWorker" in navigator)) return undefined;
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return undefined;
    }
  }, [registration]);

  const subscribe = useCallback(
    async (signedMessage: string) => {
      const reg = await resolveRegistration();
      if (!reg) return false;
      try {
        // 既存の購読があればそれを再利用し、なければ新規作成
        let subscription = await reg.pushManager.getSubscription();
        if (!subscription) {
          const key = await apiClient().notification.publicKey();
          subscription = await reg.pushManager.subscribe({
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
    [resolveRegistration],
  );

  return { registration, subscribe };
};
