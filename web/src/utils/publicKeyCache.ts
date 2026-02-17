import { getKey, setKey, deleteKey, deleteKeysWithPrefix } from "./keyStore";

/**
 * IndexedDB にキャッシュされた公開鍵情報。
 * keyStore の汎用 KV ストアを `pubkey:{userId}` キーで利用する。
 */
export type CachedPublicKeys = {
  primary_key_fingerprint: string;
  signing_public_key: string;
  encryption_public_key: string;
};

const PREFIX = "pubkey:";

export async function getCachedPublicKeys(
  userId: string,
): Promise<CachedPublicKeys | undefined> {
  const raw = await getKey(`${PREFIX}${userId}`);
  if (!raw) return undefined;
  return JSON.parse(raw) as CachedPublicKeys;
}

export async function setCachedPublicKeys(
  userId: string,
  keys: CachedPublicKeys,
): Promise<void> {
  await setKey(`${PREFIX}${userId}`, JSON.stringify(keys));
}

export async function deleteCachedPublicKeys(userId: string): Promise<void> {
  await deleteKey(`${PREFIX}${userId}`);
}

export async function clearAllCachedPublicKeys(): Promise<void> {
  await deleteKeysWithPrefix(PREFIX);
}
