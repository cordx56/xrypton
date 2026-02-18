"use client";

import { useState, useMemo, useEffect } from "react";
import { RichText } from "@atproto/api";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import { buildSignatureTarget } from "@/utils/canonicalize";
import { displayUserId } from "@/utils/schema";

/** OAuth認証直後に公開鍵を投稿させ、ATProtoアカウントとXryptonの紐付けを証明する画面 */
const VerificationPost = () => {
  const { agent, completeVerification } = useAtproto();
  const { signText, getSignedMessage, userId, publicKeys, worker } = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [posting, setPosting] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const hostname =
    process.env.NEXT_PUBLIC_SERVER_HOSTNAME ??
    (typeof window !== "undefined" ? window.location.host : "localhost");

  // 主鍵のフィンガープリントを取得
  useEffect(() => {
    if (!publicKeys || !worker) return;
    worker.eventWaiter("get_primary_fingerprint", (result) => {
      if (result.success) {
        setFingerprint(result.data.fingerprint);
      }
    });
    worker.postMessage({
      call: "get_primary_fingerprint",
      publicKeys,
    });
  }, [publicKeys, worker]);

  const profileUrl = useMemo(
    () =>
      userId
        ? `https://${hostname}/profile/${encodeURIComponent(displayUserId(userId))}`
        : "",
    [hostname, userId],
  );

  // Long Key ID: フィンガープリント末尾16文字を4文字区切りで表示
  const formattedFingerprint = useMemo(
    () =>
      fingerprint ? fingerprint.slice(-16).replace(/(.{4})(?=.)/g, "$1 ") : "",
    [fingerprint],
  );

  const postText = useMemo(
    () =>
      `Xrypton at ${hostname} verification:\n\n${formattedFingerprint}\n\nYou can view my public key: ${profileUrl}`,
    [hostname, formattedFingerprint, profileUrl],
  );

  const handlePost = async () => {
    if (!agent || !fingerprint || posting) return;
    setPosting(true);
    try {
      // リンクを自動検出してfacets付きで投稿
      const rt = new RichText({ text: postText });
      await rt.detectFacets(agent);

      const response = await agent.post({
        text: rt.text,
        facets: rt.facets,
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
          disabled={posting || !fingerprint}
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
