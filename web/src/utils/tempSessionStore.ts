// sessionStorageベースのtemporary session鍵管理ユーティリティ

type TempKeys = {
  privateKey: string;
  passphrase: string;
};

type TempPubKeys = Record<string, string>;

function getItem<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function setItem<T>(key: string, value: T): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}

// 自分の一時鍵（秘密鍵 + パスフレーズ）
export function getTempKeys(threadId: string): TempKeys | null {
  return getItem<TempKeys>(`temp_keys:${threadId}`);
}

export function setTempKeys(threadId: string, keys: TempKeys): void {
  setItem(`temp_keys:${threadId}`, keys);
}

// メンバーの一時公開鍵（userId -> armored public key）
export function getTempPubKeys(threadId: string): TempPubKeys | null {
  return getItem<TempPubKeys>(`temp_pubkeys:${threadId}`);
}

export function setTempPubKeys(threadId: string, pubKeys: TempPubKeys): void {
  setItem(`temp_pubkeys:${threadId}`, pubKeys);
}

// 送信保留メッセージ（平文の配列）
export function getPendingMessages(threadId: string): string[] {
  return getItem<string[]>(`temp_pending:${threadId}`) ?? [];
}

export function setPendingMessages(threadId: string, msgs: string[]): void {
  setItem(`temp_pending:${threadId}`, msgs);
}

export function clearPendingMessages(threadId: string): void {
  sessionStorage.removeItem(`temp_pending:${threadId}`);
}
