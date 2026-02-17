"use client";

import { useState, useRef, useEffect } from "react";
import { AppBskyFeedDefs, AppBskyFeedPost } from "@atproto/api";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import { buildSignatureTarget } from "@/utils/canonicalize";

const MAX_CHARS = 300;

type Props = {
  /** 返信先の投稿 */
  replyTo: AppBskyFeedDefs.PostView;
  onClose: () => void;
  /** 返信成功後のコールバック */
  onPosted?: () => void;
};

const ComposeReply = ({ replyTo, onClose, onPosted }: Props) => {
  const { agent } = useAtproto();
  const { signText, getSignedMessage } = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();

  const [text, setText] = useState("");
  const [withSignature, setWithSignature] = useState(true);
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const charCount = [...text].length;
  const isOverLimit = charCount > MAX_CHARS;
  const replyRecord = replyTo.record as AppBskyFeedPost.Record;

  const handlePost = async () => {
    if (!agent || !text.trim() || isOverLimit || posting) return;
    setPosting(true);

    try {
      // 返信先のルート投稿を決定
      const parentRef = {
        uri: replyTo.uri,
        cid: replyTo.cid,
      };
      const rootRef = replyRecord.reply?.root
        ? {
            uri: replyRecord.reply.root.uri,
            cid: replyRecord.reply.root.cid,
          }
        : parentRef;

      const response = await agent.post({
        text: text.trim(),
        langs: ["ja"],
        reply: {
          root: rootRef,
          parent: parentRef,
        },
      } as Parameters<typeof agent.post>[0]);

      // PGP署名
      if (withSignature) {
        try {
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
          });
        } catch {
          showError(t("error.atproto_sign_failed"));
        }
      }

      onPosted?.();
      onClose();
    } catch (e) {
      showError(
        e instanceof Error ? e.message : t("error.atproto_post_failed"),
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      {/* 返信先プレビュー */}
      <div className="text-xs text-muted border-l-2 border-accent/30 pl-3 py-1 line-clamp-2">
        <span className="font-medium text-fg">@{replyTo.author.handle}</span>{" "}
        {replyRecord?.text}
      </div>

      {/* テキスト入力 */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handlePost();
          }
        }}
        placeholder={t("atproto.compose")}
        rows={4}
        className="w-full px-4 py-3 rounded-lg bg-panel border border-accent/30 text-fg placeholder-muted resize-none focus:outline-none focus:border-accent"
      />

      {/* フッター */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${isOverLimit ? "text-red-400" : "text-muted"}`}
          >
            {charCount}/{MAX_CHARS}
          </span>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={withSignature}
              onChange={(e) => setWithSignature(e.target.checked)}
              className="rounded"
            />
            <span>{t("atproto.sign_post")}</span>
          </label>
        </div>
        <button
          onClick={handlePost}
          disabled={!text.trim() || isOverLimit || posting}
          className="px-6 py-2 rounded-full bg-accent text-white font-medium disabled:opacity-50 transition-opacity min-w-[80px]"
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

export default ComposeReply;
