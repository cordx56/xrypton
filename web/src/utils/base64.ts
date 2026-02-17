/** Uint8Array を標準 base64 文字列にエンコードする（大きなバッファでも安全） */
export const bytesToBase64 = (input: Uint8Array): string => {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < input.length; i += CHUNK) {
    parts.push(String.fromCharCode(...input.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
};

/** 標準 base64 文字列を Uint8Array にデコードする */
export const base64ToBytes = (b64: string): Uint8Array => {
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** base64url文字列をUint8Arrayにデコードする */
export const fromBase64Url = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  return base64ToBytes(base64 + pad);
};

/** Uint8Arrayをbase64url文字列にエンコードする */
export const toBase64Url = (input: Uint8Array): string => {
  const b64 = bytesToBase64(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** base64url文字列をUTF-8文字列にデコードする */
export const decodeBase64Url = (value: string): string =>
  new TextDecoder().decode(fromBase64Url(value));

/** UTF-8文字列を標準base64にエンコードする */
export const encodeToBase64 = (text: string): string =>
  bytesToBase64(new TextEncoder().encode(text));

/** 標準base64文字列をbase64url形式に変換する */
export const base64ToBase64Url = (b64: string): string =>
  b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
