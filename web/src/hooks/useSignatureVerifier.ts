"use client";

import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { displayUserId } from "@/utils/schema";
import Dialog from "@/components/common/Dialog";
import { createElement } from "react";
import { bytesToBase64 } from "@/utils/base64";

const PGP_MESSAGE_PREFIX = "-----BEGIN PGP MESSAGE-----";

// セッション中にユーザ毎に警告ダイアログを一度だけ表示するためのセット
const warnedUsers = new Set<string>();

/** armored PGP メッセージかどうかを判定する */
export function isSignedMessage(value: string): boolean {
  return value.startsWith(PGP_MESSAGE_PREFIX);
}

/** 署名検証・平文抽出・警告表示を行うフック */
export function useSignatureVerifier() {
  const auth = useAuth();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();

  const showWarning = useCallback(
    (userId: string, displayName?: string): Promise<void> => {
      if (warnedUsers.has(userId)) return Promise.resolve();
      warnedUsers.add(userId);

      const label = displayName
        ? `${displayName} (${displayUserId(userId)})`
        : displayUserId(userId);

      return new Promise<void>((resolve) => {
        pushDialog((p) => {
          const handleClose = () => {
            p.close();
            resolve();
          };
          return createElement(
            Dialog,
            {
              ...p,
              close: handleClose,
              title: t("security.signature_failed_title"),
            },
            createElement(
              "div",
              { className: "space-y-3" },
              createElement("p", { className: "text-sm font-medium" }, label),
              createElement(
                "p",
                { className: "text-sm" },
                t("security.signature_failed_message"),
              ),
              createElement(
                "p",
                { className: "text-sm text-muted" },
                t("security.signature_failed_detail"),
              ),
              createElement(
                "button",
                {
                  type: "button",
                  onClick: handleClose,
                  className:
                    "px-4 py-2 bg-accent/30 rounded hover:bg-accent/50",
                },
                t("common.ok"),
              ),
            ),
          );
        });
      });
    },
    [pushDialog, t],
  );

  /**
   * 署名を検証して平文を返す。
   * 検証失敗時は null を返す（警告表示は呼び出し側が制御する）。
   */
  const verifyExtract = useCallback(
    async (publicKey: string, armored: string): Promise<string | null> => {
      if (!auth.worker) return null;

      return new Promise((resolve) => {
        auth.worker!.eventWaiter("verify_extract_string", (result) => {
          if (result.success) {
            resolve(result.data.plaintext);
          } else {
            resolve(null);
          }
        });
        auth.worker!.postMessage({
          call: "verify_extract_string",
          publicKey,
          armored,
        });
      });
    },
    [auth.worker],
  );

  /** detached signature を検証する。 */
  const verifyDetachedSignature = useCallback(
    async (
      publicKey: string,
      signature: string,
      data: Uint8Array,
    ): Promise<boolean> => {
      if (!auth.worker || !signature) return false;

      return new Promise((resolve) => {
        auth.worker!.eventWaiter("verify_detached_signature", (result) => {
          resolve(result.success);
        });
        auth.worker!.postMessage({
          call: "verify_detached_signature",
          publicKey,
          signature,
          data: bytesToBase64(data),
        });
      });
    },
    [auth.worker],
  );

  /**
   * 署名を検証しつつ平文を抽出する。
   * 検証失敗でも平文が取得できれば返す。パース自体の失敗時のみ null。
   */
  const extractAndVerify = useCallback(
    async (
      publicKey: string,
      armored: string,
    ): Promise<{ text: string; verified: boolean } | null> => {
      if (!auth.worker) return null;

      return new Promise((resolve) => {
        auth.worker!.eventWaiter("extract_and_verify_string", (result) => {
          if (result.success) {
            resolve({
              text: result.data.plaintext,
              verified: result.data.verified,
            });
          } else {
            resolve(null);
          }
        });
        auth.worker!.postMessage({
          call: "extract_and_verify_string",
          publicKey,
          armored,
        });
      });
    },
    [auth.worker],
  );

  return {
    verifyExtract,
    verifyDetachedSignature,
    extractAndVerify,
    isSignedMessage,
    showWarning,
  };
}
