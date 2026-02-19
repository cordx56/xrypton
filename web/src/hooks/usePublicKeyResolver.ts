"use client";

import { useCallback, useRef, createElement } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import {
  useSignatureVerifier,
  isSignedMessage,
} from "@/hooks/useSignatureVerifier";
import { authApiClient } from "@/api/client";
import { GetKeysResponse } from "@/utils/schema";
import {
  getCachedPublicKeys,
  setCachedPublicKeys,
  type CachedPublicKeys,
} from "@/utils/publicKeyCache";

export type RefreshResult =
  | { status: "unchanged" }
  | { status: "changed"; keys: CachedPublicKeys; confirmed: boolean };

/**
 * 公開鍵の IDB キャッシュ一元管理フック。
 * resolveKeys / refreshKeys / withKeyRetry を提供する。
 */
export function usePublicKeyResolver() {
  const auth = useAuth();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { verifyExtract, verifyDetachedSignature } = useSignatureVerifier();
  const refreshingUsers = useRef<Map<string, Promise<RefreshResult>>>(
    new Map(),
  );

  /** IDB キャッシュ優先で公開鍵を取得。ミス時は API → IDB 保存 */
  const resolveKeys = useCallback(
    async (userId: string): Promise<CachedPublicKeys | null> => {
      const cached = await getCachedPublicKeys(userId);
      if (cached) return cached;

      try {
        const signed = await auth.getSignedMessage();
        if (!signed) return null;
        const raw = await authApiClient(signed.signedMessage).user.getKeys(
          userId,
        );
        const parsed = GetKeysResponse.safeParse(raw);
        if (!parsed.success) return null;
        const keys: CachedPublicKeys = {
          primary_key_fingerprint: parsed.data.primary_key_fingerprint,
          signing_public_key: parsed.data.signing_public_key,
          encryption_public_key: parsed.data.encryption_public_key,
        };
        await setCachedPublicKeys(userId, keys);
        return keys;
      } catch {
        return null;
      }
    },
    [auth.getSignedMessage],
  );

  /** サーバから最新を取得し IDB キャッシュと比較。変更時は確認ダイアログを表示。 */
  const refreshKeys = useCallback(
    (userId: string): Promise<RefreshResult> => {
      const existing = refreshingUsers.current.get(userId);
      if (existing) return existing;

      const promise = (async (): Promise<RefreshResult> => {
        try {
          const signed = await auth.getSignedMessage();
          if (!signed) return { status: "unchanged" };
          const raw = await authApiClient(signed.signedMessage).user.getKeys(
            userId,
          );
          const parsed = GetKeysResponse.safeParse(raw);
          if (!parsed.success) return { status: "unchanged" };

          const newKeys: CachedPublicKeys = {
            primary_key_fingerprint: parsed.data.primary_key_fingerprint,
            signing_public_key: parsed.data.signing_public_key,
            encryption_public_key: parsed.data.encryption_public_key,
          };

          const cached = await getCachedPublicKeys(userId);
          const changed =
            !cached ||
            cached.primary_key_fingerprint !==
              newKeys.primary_key_fingerprint ||
            cached.signing_public_key !== newKeys.signing_public_key;

          if (!changed) return { status: "unchanged" };

          // 確認ダイアログ（ブロッキング）
          const confirmed = await confirm(({ ok, cancel }) =>
            createElement(
              "div",
              { className: "flex flex-col" },
              createElement(
                "div",
                {
                  className:
                    "flex justify-between border-b border-accent px-2 pb-2 mb-4",
                },
                createElement(
                  "div",
                  { className: "font-medium" },
                  t("security.key_changed_title"),
                ),
              ),
              createElement(
                "div",
                { className: "px-2 space-y-3" },
                createElement(
                  "p",
                  { className: "text-sm" },
                  t("security.key_changed_message"),
                ),
                createElement(
                  "p",
                  { className: "text-sm text-muted" },
                  t("security.key_changed_detail"),
                ),
                createElement(
                  "div",
                  { className: "flex gap-2" },
                  createElement(
                    "button",
                    {
                      type: "button",
                      onClick: ok,
                      className:
                        "px-4 py-2 bg-accent/30 rounded hover:bg-accent/50",
                    },
                    t("common.ok"),
                  ),
                  createElement(
                    "button",
                    {
                      type: "button",
                      onClick: cancel,
                      className:
                        "px-4 py-2 border border-accent/30 rounded hover:bg-accent/10",
                    },
                    t("common.cancel"),
                  ),
                ),
              ),
            ),
          );

          if (confirmed) {
            await setCachedPublicKeys(userId, newKeys);
          }

          return { status: "changed", keys: newKeys, confirmed };
        } catch {
          return { status: "unchanged" };
        } finally {
          refreshingUsers.current.delete(userId);
        }
      })();

      refreshingUsers.current.set(userId, promise);
      return promise;
    },
    [auth.getSignedMessage, confirm, t],
  );

  /**
   * 汎用リトライラッパー。
   * 1. resolveKeys でキャッシュ済み鍵を取得
   * 2. operation(signingKey) を実行（失敗時は throw）
   * 3. 失敗 → refreshKeys でサーバから取得
   * 4. 鍵が同じ or エラー → onFailed()
   * 5. 鍵が変わった → 新しい鍵で operation をリトライ
   */
  const withKeyRetry = useCallback(
    async <T>(
      userId: string,
      operation: (signingKey: string) => Promise<T>,
      onFailed: () => void,
    ): Promise<T | null> => {
      const keys = await resolveKeys(userId);
      if (!keys) {
        onFailed();
        return null;
      }

      try {
        return await operation(keys.signing_public_key);
      } catch {
        // 失敗 → リフレッシュ
      }

      const result = await refreshKeys(userId);
      if (result.status === "unchanged") {
        onFailed();
        return null;
      }

      // 鍵が変わった → リトライ
      try {
        return await operation(result.keys.signing_public_key);
      } catch {
        onFailed();
        return null;
      }
    },
    [resolveKeys, refreshKeys],
  );

  /** display_name を検証して解決する。detached signature があれば優先して検証する。 */
  const resolveDisplayName = useCallback(
    async (
      userId: string,
      rawName: string,
      detachedSignature?: string,
    ): Promise<string> => {
      if (!rawName) return rawName;
      const keys = await resolveKeys(userId);
      if (!keys) return userId;

      if (detachedSignature) {
        const ok = await verifyDetachedSignature(
          keys.signing_public_key,
          detachedSignature,
          new TextEncoder().encode(rawName),
        );
        return ok ? rawName : userId;
      }

      if (!isSignedMessage(rawName)) return rawName;
      const plain = await verifyExtract(keys.signing_public_key, rawName);
      return plain ?? userId;
    },
    [resolveKeys, verifyDetachedSignature, verifyExtract],
  );

  return { resolveKeys, refreshKeys, withKeyRetry, resolveDisplayName };
}
