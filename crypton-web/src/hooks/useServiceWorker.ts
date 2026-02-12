import { useState, useEffect, useCallback } from "react";
import { z } from "zod";
import { apiClient, authApiClient } from "@/api/client";
import { Notification } from "@/utils/schema";

export const useServiceWorker = (
  onEvent?: (data: z.infer<typeof Notification>) => void,
) => {
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

  // SWからのpostMessageをリッスンし、onEventに転送
  useEffect(() => {
    if (!onEvent || !("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const parsed = Notification.safeParse(event.data);
      if (parsed.success) {
        onEvent(parsed.data);
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [onEvent]);

  const subscribe = useCallback(
    async (signedMessage: string) => {
      if (!registration) return;
      try {
        const key = await apiClient().notification.publicKey();
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await authApiClient(signedMessage).notification.subscribe(subscription);
      } catch {
        // push subscription failed
      }
    },
    [registration],
  );

  return { registration, subscribe };
};
