"use client";

import {
  useState,
  useEffect,
  useCallback,
  createElement,
  useMemo,
} from "react";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import { AppBskyFeedDefs } from "@atproto/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import AtprotoHeader from "@/components/atproto/AtprotoHeader";
import ThreadView from "@/components/atproto/ThreadView";
import ComposeReply from "@/components/atproto/ComposeReply";
import Dialog from "@/components/common/Dialog";
import SignatureVerifier from "@/components/atproto/SignatureVerifier";
import Spinner from "@/components/common/Spinner";
import { useAtprotoSignatures } from "@/hooks/useAtprotoSignature";
import type { AtprotoSignature } from "@/types/atproto";

/** catch-all segmentからat:// URIを復元 */
function restoreUri(segments: string[]): string {
  const joined = segments.map(decodeURIComponent).join("/");
  return joined.replace("at:/", "at://");
}

/** スレッド内の投稿ターゲットを再帰収集 */
function collectTargets(
  thread: AppBskyFeedDefs.ThreadViewPost,
): { uri: string; cid: string; record: unknown }[] {
  const targets = new Map<
    string,
    { uri: string; cid: string; record: unknown }
  >();

  const walk = (node: AppBskyFeedDefs.ThreadViewPost) => {
    targets.set(node.post.uri, {
      uri: node.post.uri,
      cid: node.post.cid,
      record: node.post.record,
    });
    if (node.parent && AppBskyFeedDefs.isThreadViewPost(node.parent)) {
      walk(node.parent);
    }
    for (const reply of node.replies ?? []) {
      if (AppBskyFeedDefs.isThreadViewPost(reply)) {
        walk(reply);
      }
    }
  };

  walk(thread);
  return [...targets.values()];
}

/** 返信作成オーバーレイ */
function ReplyOverlay({
  replyTo,
  onClose,
  onPosted,
}: {
  replyTo: AppBskyFeedDefs.PostView;
  onClose: () => void;
  onPosted: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mt-16 mx-4 bg-bg rounded-xl shadow-xl border border-accent/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-end px-4 py-3 border-b border-accent/30">
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted hover:text-fg transition-colors"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <ComposeReply replyTo={replyTo} onClose={onClose} onPosted={onPosted} />
      </div>
    </div>,
    document.body,
  );
}

export default function PostDetailPage() {
  const params = useParams<{ uri: string[] }>();
  const { agent, isLoading: authLoading } = useAtproto();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();

  const [thread, setThread] = useState<AppBskyFeedDefs.ThreadViewPost | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);

  const targets = useMemo(
    () => (thread ? collectTargets(thread) : []),
    [thread],
  );
  const { signatureMap, verificationMap } = useAtprotoSignatures(targets);

  const handleSignatureClick = useCallback(
    (signature: AtprotoSignature) => {
      const level = verificationMap.get(signature.atproto_uri) ?? "none";
      pushDialog((p) =>
        createElement(
          Dialog,
          { ...p, title: "" },
          createElement(SignatureVerifier, {
            signature,
            level,
            onClose: p.close,
          }),
        ),
      );
    },
    [pushDialog, verificationMap],
  );

  const loadThread = useCallback(async () => {
    if (!agent || !params.uri) return;
    const uri = restoreUri(params.uri);
    setLoading(true);
    try {
      const res = await agent.getPostThread({ uri, depth: 10 });
      if (AppBskyFeedDefs.isThreadViewPost(res.data.thread)) {
        setThread(res.data.thread);
      } else {
        setError(t("error.not_found"));
      }
    } catch {
      setError(t("error.unknown"));
    } finally {
      setLoading(false);
    }
  }, [agent, params.uri, t]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  const handleReply = useCallback((post: AppBskyFeedDefs.PostView) => {
    setReplyTo(post);
  }, []);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <AtprotoHeader title="Post" showBack />
      <div className="flex-1 overflow-y-auto">
        {thread && (
          <ThreadView
            thread={thread}
            signatureMap={signatureMap}
            verificationMap={verificationMap}
            onSignatureClick={handleSignatureClick}
            onReply={handleReply}
          />
        )}
      </div>

      {/* 返信作成オーバーレイ */}
      {replyTo && (
        <ReplyOverlay
          replyTo={replyTo}
          onClose={() => setReplyTo(null)}
          onPosted={loadThread}
        />
      )}
    </div>
  );
}
