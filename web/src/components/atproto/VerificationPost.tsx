"use client";

import { useState, useMemo, useEffect } from "react";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import { buildSignatureTarget } from "@/utils/canonicalize";
import { encodeToBase64 } from "@/utils/base64";

/** OAuth認証直後に公開鍵を投稿させ、ATProtoアカウントとXryptonの紐付けを証明する画面 */
const VerificationPost = () => {
  const { agent, completeVerification } = useAtproto();
  const {
    signText,
    getSignedMessage,
    userId,
    privateKeys,
    subPassphrase,
    worker,
  } = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [posting, setPosting] = useState(false);
  const [signedUserId, setSignedUserId] = useState<string | null>(null);

  const hostname =
    process.env.NEXT_PUBLIC_SERVER_HOSTNAME ??
    (typeof window !== "undefined" ? window.location.host : "localhost");

  // userId の PGP署名をバイナリbase64で計算
  useEffect(() => {
    if (!privateKeys || !subPassphrase || !userId || !worker) return;
    worker.eventWaiter("sign_bytes", (result) => {
      if (result.success) {
        setSignedUserId(result.data.data);
      }
    });
    worker.postMessage({
      call: "sign_bytes",
      keys: privateKeys,
      passphrase: subPassphrase,
      payload: encodeToBase64(userId),
    });
  }, [privateKeys, subPassphrase, userId, worker]);

  const postText = useMemo(
    () => `Xrypton at ${hostname} verification:\n\n${signedUserId ?? ""}`,
    [hostname, signedUserId],
  );

  const handlePost = async () => {
    if (!agent || !signedUserId || posting) return;
    setPosting(true);
    try {
      // ATProtoに投稿
      const response = await agent.post({
        text: postText,
        langs: ["en"],
      } as Parameters<typeof agent.post>[0]);

      // PGP署名 + バックエンドに保存（is_pubkey_post: true）
      const { uri, cid } = response;
      const rkey = uri.split("/").pop()!;
      const { data } = await agent.com.atproto.repo.getRecord({
        repo: agent.did!,
        collection: "app.bsky.feed.post",
        rkey,
      });
      const target = buildSignatureTarget(uri, cid, data.value);
      const signature = await signText(target);
      if (!signature) throw new Error("Signing failed");
      const signed = await getSignedMessage();
      if (!signed) throw new Error("Auth failed");
      await authApiClient(signed.signedMessage).atproto.saveSignature({
        atproto_did: agent.did!,
        atproto_uri: uri,
        atproto_cid: cid,
        collection: "app.bsky.feed.post",
        record_json: target,
        signature,
        is_pubkey_post: true,
      });

      completeVerification();
    } catch (e) {
      showError(
        e instanceof Error ? e.message : t("error.atproto_post_failed"),
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-lg w-full space-y-4">
        <h2 className="text-lg font-semibold text-center">
          {t("atproto.verification_title")}
        </h2>
        <p className="text-sm text-muted text-center">
          {t("atproto.verification_desc")}
        </p>

        <textarea
          value={postText}
          disabled
          rows={8}
          className="w-full px-4 py-3 rounded-lg bg-panel border border-accent/30 text-fg resize-none opacity-80 cursor-not-allowed font-mono text-xs"
        />

        <button
          onClick={handlePost}
          disabled={posting || !signedUserId}
          className="w-full px-6 py-3 rounded-full bg-accent text-white font-medium disabled:opacity-50 transition-opacity"
        >
          {posting ? (
            <div className="w-4 h-4 mx-auto border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            t("atproto.post")
          )}
        </button>
      </div>
    </div>
  );
};

export default VerificationPost;
