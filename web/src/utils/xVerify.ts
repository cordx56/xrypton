import { apiClient } from "@/api/client";
import type { WorkerBridge } from "@/utils/atprotoVerify";

/**
 * X (Twitter) の公開鍵投稿をフロントエンドで検証する。
 *
 * 1. oEmbed API で投稿 HTML を取得
 * 2. html フィールドから fingerprint を正規表現で抽出
 * 3. ユーザの公開鍵 fingerprint と照合
 */
export async function verifyXPost(
  postUrl: string,
  userId: string,
  expectedAuthorUrl: string,
  worker: WorkerBridge,
): Promise<boolean> {
  void worker;
  try {
    // oEmbed API で投稿情報を取得
    const resp = await fetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}&_=${Date.now()}`,
      { cache: "no-store" },
    );
    if (!resp.ok) return false;
    const data = await resp.json();
    const authorUrl =
      typeof data.author_url === "string" ? data.author_url : "";
    if (!authorUrl) return false;

    // 保存済み author_url と、oEmbed が返す author_url の整合を確認する
    const normalizeAuthor = (url: string): string | null => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const allowedHosts = new Set([
          "x.com",
          "twitter.com",
          "www.x.com",
          "www.twitter.com",
          "mobile.twitter.com",
        ]);
        if (!allowedHosts.has(host)) return null;
        const first = parsed.pathname.split("/").filter(Boolean).at(0);
        if (!first) return null;
        return first.toLowerCase();
      } catch {
        return null;
      }
    };
    const gotAuthorHandle = normalizeAuthor(authorUrl);
    const expectedHandle = normalizeAuthor(expectedAuthorUrl);
    if (
      !gotAuthorHandle ||
      !expectedHandle ||
      gotAuthorHandle !== expectedHandle
    ) {
      return false;
    }

    // html フィールドから fingerprint パターンを抽出
    // Long Key ID: 4文字×4グループ（スペース区切り）
    const fpMatch = (data.html as string).match(
      /([0-9A-Fa-f]{4}\s[0-9A-Fa-f]{4}\s[0-9A-Fa-f]{4}\s[0-9A-Fa-f]{4})/,
    );
    if (!fpMatch) return false;

    // ユーザの公開鍵 fingerprint と照合
    const keys = await apiClient().user.getKeys(userId, { fresh: true });
    const primaryFingerprint: string = keys.primary_key_fingerprint;
    const expectedFpTail = primaryFingerprint.slice(-16).toUpperCase();
    const extractedFp = fpMatch[1].replace(/\s/g, "").toUpperCase();

    return extractedFp === expectedFpTail;
  } catch {
    return false;
  }
}
