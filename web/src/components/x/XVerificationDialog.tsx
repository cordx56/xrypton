"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import { canonicalize } from "@/utils/canonicalize";
import { displayUserId } from "@/utils/schema";
import type { DialogComponent } from "@/contexts/DialogContext";

/**
 * X (Twitter) アカウント連携ダイアログ。
 *
 * 1. fingerprint テキストを生成し Twitter Share Button を表示
 * 2. ユーザがポストした後、ポストURLをペースト
 * 3. oEmbed API で url / author_url を取得
 * 4. proof JSON に PGP 署名してサーバにアップロード
 */
const XVerificationDialog: DialogComponent<{
  onSuccess?: () => void;
}> = ({ close, setOnClose, onSuccess }) => {
  const auth = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();

  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    setOnClose(() => close());
  }, []);

  const hostname =
    process.env.NEXT_PUBLIC_SERVER_HOSTNAME ??
    (typeof window !== "undefined" ? window.location.host : "localhost");

  // 主鍵のフィンガープリントを取得
  useEffect(() => {
    if (!auth.publicKeys || !auth.worker) return;
    auth.worker.eventWaiter("get_primary_fingerprint", (result) => {
      if (result.success) {
        setFingerprint(result.data.fingerprint);
      }
    });
    auth.worker.postMessage({
      call: "get_primary_fingerprint",
      publicKeys: auth.publicKeys,
    });
  }, [auth.publicKeys, auth.worker]);

  const profileUrl = useMemo(
    () =>
      auth.userId
        ? `https://${hostname}/profile/${encodeURIComponent(displayUserId(auth.userId))}`
        : "",
    [hostname, auth.userId],
  );

  // Long Key ID: フィンガープリント末尾16文字を4文字区切りで表示
  const formattedFingerprint = useMemo(
    () =>
      fingerprint ? fingerprint.slice(-16).replace(/(.{4})(?=.)/g, "$1 ") : "",
    [fingerprint],
  );

  const verificationText = useMemo(
    () =>
      `Xrypton at ${hostname} verification:\n\n${formattedFingerprint}\n\nYou can view my public key:`,
    [hostname, formattedFingerprint],
  );

  // Twitter Share Button をロード
  const twitterRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !formattedFingerprint) return;
      // 既存の内容をクリア
      node.innerHTML = "";

      const a = document.createElement("a");
      a.href = "https://twitter.com/intent/tweet";
      a.className = "twitter-share-button";
      a.dataset.text = verificationText;
      a.dataset.url = profileUrl;
      a.dataset.size = "large";
      a.textContent = "Post";
      node.appendChild(a);

      // Twitter widgets.js をロード
      const script = document.createElement("script");
      script.src = "https://platform.twitter.com/widgets.js";
      script.async = true;
      node.appendChild(script);
    },
    [formattedFingerprint, verificationText, profileUrl],
  );

  const handleVerify = async () => {
    if (!postUrl || verifying) return;

    // URL の基本バリデーション
    if (!postUrl.includes("x.com/") && !postUrl.includes("twitter.com/")) {
      showError(t("error.x_invalid_url"));
      return;
    }

    setVerifying(true);
    try {
      // oEmbed API で投稿情報を取得
      const oembedResp = await fetch(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(postUrl)}`,
      );
      if (!oembedResp.ok) {
        showError(t("error.x_invalid_url"));
        return;
      }
      const oembedData = await oembedResp.json();
      const authorUrl: string = oembedData.author_url;
      const url: string = oembedData.url;

      // proof JSON を正規化
      const proofJson = canonicalize({ author_url: authorUrl, url });

      // PGP 署名
      const signature = await auth.signText(proofJson);
      if (!signature) throw new Error("Signing failed");

      // サーバにアップロード
      const signed = await auth.getSignedMessage();
      if (!signed) throw new Error("Auth failed");

      await authApiClient(signed.signedMessage).x.linkAccount({
        author_url: authorUrl,
        post_url: url,
        proof_json: proofJson,
        signature,
      });

      // 成功時
      window.dispatchEvent(new Event("profile-updated"));
      onSuccess?.();
      close();
    } catch {
      showError(t("error.x_verification_failed"));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between border-b border-accent px-2 pb-2 mb-2">
        <div className="font-medium">{t("x.verification_title")}</div>
        <button
          type="button"
          onClick={close}
          className="text-muted hover:text-fg"
        >
          &times;
        </button>
      </div>

      <p className="text-sm text-muted px-2">{t("x.verification_desc")}</p>

      {/* 検証テキストプレビュー */}
      <div className="px-2">
        <textarea
          value={
            formattedFingerprint ? `${verificationText} ${profileUrl}` : "..."
          }
          disabled
          rows={5}
          className="w-full px-3 py-2 rounded-lg bg-panel border border-accent/30 text-fg resize-none opacity-80 cursor-not-allowed font-mono text-xs"
        />
      </div>

      {/* Twitter Share Button */}
      <div className="flex justify-center px-2" ref={twitterRef} />

      {/* ポストURL入力 */}
      <div className="px-2 space-y-2">
        <input
          type="url"
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
          placeholder={t("x.post_url_placeholder")}
          className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent text-sm"
        />

        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying || !postUrl || !fingerprint}
          className="w-full px-4 py-2 rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-50 text-sm"
        >
          {verifying ? t("x.verifying") : t("x.verify")}
        </button>
      </div>
    </div>
  );
};

export default XVerificationDialog;
