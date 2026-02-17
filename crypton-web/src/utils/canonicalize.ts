/**
 * JSON値を正規化してキーソート済みのJSON文字列を返す。
 * RFC 8785 (JSON Canonicalization Scheme) の簡略化版。
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]));
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * ATproto署名対象データを構築する。
 * canonicalize({ cid, record, uri }) と等価。
 */
export function buildSignatureTarget(
  uri: string,
  cid: string,
  record: unknown,
): string {
  return canonicalize({ cid, record, uri });
}
