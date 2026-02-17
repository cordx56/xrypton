"use client";

import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import Dialog from "@/components/common/Dialog";
import { createElement } from "react";

const PGP_MESSAGE_PREFIX = "-----BEGIN PGP MESSAGE-----";

/** armored PGP メッセージかどうかを判定する */
export function isSignedMessage(value: string): boolean {
  return value.startsWith(PGP_MESSAGE_PREFIX);
}

/** 署名検証・平文抽出・警告表示を行うフック */
export function useSignatureVerifier() {
  const auth = useAuth();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();

  const showWarning = useCallback(() => {
    pushDialog((p) =>
      createElement(
        Dialog,
        { ...p, title: t("security.signature_failed_title") },
        createElement(
          "div",
          { className: "space-y-3" },
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
              onClick: p.close,
              className: "px-4 py-2 bg-accent/30 rounded hover:bg-accent/50",
            },
            t("common.ok"),
          ),
        ),
      ),
    );
  }, [pushDialog, t]);

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

  return { verifyExtract, isSignedMessage, showWarning };
}
