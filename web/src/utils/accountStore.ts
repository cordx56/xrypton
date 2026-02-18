/**
 * マルチアカウント用ストレージヘルパー。
 * keyStore の getKey/setKey をラップし、アカウントごとのプレフィックス付きキーを管理する。
 */

import {
  getKey,
  setKey,
  deleteKey,
  deleteKeysWithPrefix,
  getEntriesWithPrefix,
} from "./keyStore";
import type { AccountInfo } from "@/types/user";

const ACCOUNT_IDS_KEY = "accountIds";
const ACTIVE_ACCOUNT_KEY = "activeAccountId";

// アカウント別キー名を生成
function accountKey(userId: string, key: string): string {
  return `account:${userId}:${key}`;
}

// --- アカウント一覧 ---

export async function getAccountIds(): Promise<string[]> {
  const raw = await getKey(ACCOUNT_IDS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function setAccountIds(ids: string[]): Promise<void> {
  await setKey(ACCOUNT_IDS_KEY, JSON.stringify(ids));
}

export async function addAccountId(userId: string): Promise<void> {
  const ids = await getAccountIds();
  if (!ids.includes(userId)) {
    ids.push(userId);
    await setAccountIds(ids);
  }
}

export async function removeAccountId(userId: string): Promise<void> {
  const ids = await getAccountIds();
  await setAccountIds(ids.filter((id) => id !== userId));
}

// --- アクティブアカウント ---

export async function getActiveAccountId(): Promise<string | undefined> {
  return getKey(ACTIVE_ACCOUNT_KEY);
}

export async function setActiveAccountId(
  userId: string | undefined,
): Promise<void> {
  if (userId) {
    await setKey(ACTIVE_ACCOUNT_KEY, userId);
  } else {
    await deleteKey(ACTIVE_ACCOUNT_KEY);
  }
}

// --- アカウント別キー操作 ---

export async function getAccountValue(
  userId: string,
  key: string,
): Promise<string | undefined> {
  return getKey(accountKey(userId, key));
}

export async function setAccountValue(
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  await setKey(accountKey(userId, key), value);
}

export async function deleteAccountValue(
  userId: string,
  key: string,
): Promise<void> {
  await deleteKey(accountKey(userId, key));
}

/** アカウントIDを変更する（ドメイン付与マイグレーション用）。
 *  `account:{oldId}:*` のキーを `account:{newId}:*` にコピーし、旧キーを削除。
 *  `accountIds` と `activeAccountId` も更新する。 */
export async function renameAccount(
  oldId: string,
  newId: string,
): Promise<void> {
  if (oldId === newId) return;

  // 旧プレフィックスのエントリを読み取り、新プレフィックスにコピー
  const oldPrefix = `account:${oldId}:`;
  const newPrefix = `account:${newId}:`;
  const entries = await getEntriesWithPrefix(oldPrefix);
  await Promise.all(
    entries.map(([key, value]) => {
      const suffix = key.slice(oldPrefix.length);
      return setKey(`${newPrefix}${suffix}`, value);
    }),
  );

  // 旧キーを削除
  await deleteKeysWithPrefix(oldPrefix);

  // accountIds を更新
  const ids = await getAccountIds();
  const newIds = ids.map((id) => (id === oldId ? newId : id));
  await setAccountIds(newIds);

  // activeAccountId を更新
  const activeId = await getActiveAccountId();
  if (activeId === oldId) {
    await setActiveAccountId(newId);
  }
}

/** アカウントに紐づく全データを削除する */
export async function deleteAccountData(userId: string): Promise<void> {
  await deleteKeysWithPrefix(`account:${userId}:`);
  await removeAccountId(userId);
}

// --- 連絡先IDキャッシュ（Service Worker通知フィルタ用） ---

/** 連絡先ユーザIDの一覧をキャッシュする */
export async function setCachedContactIds(
  userId: string,
  contactIds: string[],
): Promise<void> {
  await setAccountValue(userId, "contactIds", JSON.stringify(contactIds));
}

// --- プロフィールキャッシュ（アカウントセレクタ表示用） ---

export async function getCachedProfile(
  userId: string,
): Promise<AccountInfo | undefined> {
  const raw = await getKey(accountKey(userId, "profileCache"));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AccountInfo;
  } catch {
    return undefined;
  }
}

/** 既存のキャッシュとマージして保存（signingPublicKey など既存フィールドを保持） */
export async function setCachedProfile(
  userId: string,
  info: Partial<AccountInfo> & { userId: string },
): Promise<void> {
  const existing = await getCachedProfile(userId);
  const merged: AccountInfo = { ...existing, ...info };
  await setKey(accountKey(userId, "profileCache"), JSON.stringify(merged));
}

// --- 設定の localStorage 同期（アカウント切り替え前に呼ぶ） ---

/** 対象アカウントのテーマ・言語設定を localStorage に書き出す。
 *  useLocalStorage が JSON.stringify/parse するため同じ形式で保存する。 */
export async function syncSettingsToLocalStorage(
  userId: string,
): Promise<void> {
  const [themeColor, themeMode, locale] = await Promise.all([
    getAccountValue(userId, "themeColor"),
    getAccountValue(userId, "themeMode"),
    getAccountValue(userId, "locale"),
  ]);
  if (themeColor)
    localStorage.setItem("theme-color", JSON.stringify(themeColor));
  if (themeMode) localStorage.setItem("theme-mode", JSON.stringify(themeMode));
  if (locale) localStorage.setItem("locale", JSON.stringify(locale));
}

// --- マイグレーション（フラットキー → プレフィックス付き） ---

/** 既存のフラットキーをマルチアカウント形式にマイグレーションする。
 *  accountIds が既に存在すればスキップする。 */
export async function migrateToMultiAccount(): Promise<void> {
  const existing = await getKey(ACCOUNT_IDS_KEY);
  if (existing) return; // マイグレーション済み

  const userId = await getKey("userId");
  if (!userId) return; // 新規インストール、何もしない

  // フラットキーを読み取ってプレフィックス付きにコピー
  const keys = [
    "privateKeys",
    "subPassphrase",
    "isRegistered",
    "webauthnCredentialId",
    "webauthnUserHandle",
    "reauthPolicyDays",
    "lastReauthAt",
  ];

  await Promise.all(
    keys.map(async (key) => {
      const value = await getKey(key);
      if (value !== undefined) {
        await setKey(accountKey(userId, key), value);
      }
    }),
  );

  // アカウントリストとアクティブアカウントを書き込み
  await setAccountIds([userId]);
  await setActiveAccountId(userId);

  // フラットキーを削除
  await Promise.all([
    deleteKey("userId"),
    ...keys.map((key) => deleteKey(key)),
  ]);
}
