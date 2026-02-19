import { useState, useEffect, useCallback } from "react";
import { apiClient, authApiClient } from "@/api/client";
import { fromBase64Url } from "@/utils/base64";

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const shouldRotateSubscription = (
  subscription: PushSubscription,
  expectedServerKey: Uint8Array,
): boolean => {
  const key = subscription.options.applicationServerKey;
  if (!key) return true;
  return !sameBytes(new Uint8Array(key), expectedServerKey);
};

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const cloned = Uint8Array.from(bytes);
  return cloned.buffer as ArrayBuffer;
};

export const useServiceWorker = () => {
  const [registration, setRegistration] = useState<
    ServiceWorkerRegistration | undefined
  >(undefined);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service_worker.js", { scope: "/" })
        .then(setRegistration)
        .catch((e) => {
          console.warn("service worker registration failed", e);
        });
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
        const serverKey = fromBase64Url(
          await apiClient().notification.publicKey(),
        );
        const serverKeyBuffer = asArrayBuffer(serverKey);

        let subscription = await reg.pushManager.getSubscription();
        if (subscription && shouldRotateSubscription(subscription, serverKey)) {
          // 既存購読が現在のVAPID鍵と不一致なら再生成する
          try {
            await subscription.unsubscribe();
          } catch {
            // ignore stale subscription errors
          }
          subscription = null;
        }

        if (!subscription) {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKeyBuffer,
          });
        }

        try {
          // 現在のアカウントの署名でバックエンドに登録（アカウント切替時も確実に紐付ける）
          await authApiClient(signedMessage).notification.subscribe(
            subscription,
          );
        } catch {
          // endpoint破損等に備えて、1回だけ再生成して再登録する
          try {
            await subscription.unsubscribe();
          } catch {
            // ignore stale subscription errors
          }
          const renewed = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKeyBuffer,
          });
          await authApiClient(signedMessage).notification.subscribe(renewed);
        }
        return true;
      } catch (e) {
        console.warn("push subscription failed", e);
        return false;
      }
    },
    [resolveRegistration],
  );

  return { registration, subscribe };
};
