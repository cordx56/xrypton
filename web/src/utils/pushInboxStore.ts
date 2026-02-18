import { z } from "zod";
import { Notification } from "@/utils/schema";
import {
  deleteKey,
  getEntriesWithPrefix,
  getKey,
  setKey,
} from "@/utils/keyStore";

const INBOX_PREFIX = "push:inbox:";
const MAX_ENTRIES = 300;
const MAX_AGE_MS = 30 * 60 * 1000;

export type PushInboxEntry = {
  key: string;
  notification: z.infer<typeof Notification>;
  receivedAt: number;
};

type StoredPushNotification = {
  receivedAt: number;
  notification: z.infer<typeof Notification>;
};

function parseStored(raw: string): StoredPushNotification | null {
  try {
    const parsed = JSON.parse(raw) as StoredPushNotification;
    if (typeof parsed.receivedAt !== "number") return null;
    const notif = Notification.safeParse(parsed.notification);
    if (!notif.success) return null;
    return { receivedAt: parsed.receivedAt, notification: notif.data };
  } catch {
    return null;
  }
}

export async function enqueuePushNotification(
  notification: z.infer<typeof Notification>,
): Promise<string> {
  const now = Date.now();
  const key = `${INBOX_PREFIX}${now}:${crypto.randomUUID()}`;
  const value: StoredPushNotification = { receivedAt: now, notification };
  await setKey(key, JSON.stringify(value));
  await trimPushInbox();
  return key;
}

export async function loadPushInbox(limit = 100): Promise<PushInboxEntry[]> {
  const now = Date.now();
  const entries = await getEntriesWithPrefix(INBOX_PREFIX);
  const valid: PushInboxEntry[] = [];

  for (const [key, raw] of entries) {
    const parsed = parseStored(raw);
    if (!parsed) {
      await deleteKey(key);
      continue;
    }
    if (now - parsed.receivedAt > MAX_AGE_MS) {
      await deleteKey(key);
      continue;
    }
    valid.push({
      key,
      notification: parsed.notification,
      receivedAt: parsed.receivedAt,
    });
  }

  valid.sort((a, b) => a.receivedAt - b.receivedAt);
  return valid.slice(0, limit);
}

export async function removePushInboxEntry(key: string): Promise<void> {
  await deleteKey(key);
}

export async function hasPushInboxEntry(key: string): Promise<boolean> {
  const value = await getKey(key);
  return value !== undefined;
}

async function trimPushInbox(): Promise<void> {
  const all = await loadPushInbox(MAX_ENTRIES + 200);
  if (all.length <= MAX_ENTRIES) return;
  const toDelete = all.slice(0, all.length - MAX_ENTRIES);
  for (const entry of toDelete) {
    await deleteKey(entry.key);
  }
}
