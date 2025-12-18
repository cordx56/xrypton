import { z } from "zod";
import init, { decrypt } from "crypton-wasm";
import { Notification, WasmReturnValue } from "crypton-common";
import { getPrivateKeys, getSubPassphrase } from "@/utils/context";

init();

// @ts-ignore
const sw: ServiceWorkerGlobalScope = self;

const logPrefix = "[ServiceWorker][WebRTC]";

sw.addEventListener("install", (event) => {
  const a = z.object({});
  a.parse({});
  console.log(`${logPrefix} installing`);
  event.waitUntil(sw.skipWaiting());
});

sw.addEventListener("activate", (event) => {
  console.log(`${logPrefix} activated`);
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener("push", (ev) => {
  const data = Notification.safeParse(ev.data?.json());
  if (!data.success) {
    return;
  }
  const keys = getPrivateKeys();
  if (keys === undefined) {
    return;
  }
  const pass = getSubPassphrase();
  if (pass === undefined) {
    ev.waitUntil(
      sw.registration.showNotification("New message received", {
        body: "Encrypted",
      }),
    );
    return;
  }
  const result = WasmReturnValue.safeParse(
    decrypt(keys, pass, data.data.encrypted),
  );
  if (!result.success || result.data.result !== "ok") {
    return;
  }
  ev.waitUntil(sw.registration.showNotification("", { body: "" }));
});
