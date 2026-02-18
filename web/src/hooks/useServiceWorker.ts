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
