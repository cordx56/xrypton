"use client";

import { useRef, useCallback, useEffect, type RefObject } from "react";
import { AppBskyFeedDefs } from "@atproto/api";
import PostCard from "@/components/atproto/PostCard";
import Spinner from "@/components/common/Spinner";
import type { AtprotoSignature, VerificationLevel } from "@/types/atproto";

type Props = {
  posts: AppBskyFeedDefs.FeedViewPost[];
  signatureMap: Map<string, AtprotoSignature>;
  verificationMap: Map<string, VerificationLevel>;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  onSignatureClick?: (signature: AtprotoSignature) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  /** IntersectionObserver の root 要素（親のスクロールコンテナ） */
  scrollRoot?: RefObject<HTMLElement | null>;
};

/** ポスト一覧 + IntersectionObserver による無限スクロール。
 *  自前のスクロールコンテナは持たず、親が用意したコンテナ内に描画する。 */
const Timeline = ({
  posts,
  signatureMap,
  verificationMap,
  onLoadMore,
  hasMore,
  isLoading,
  onSignatureClick,
  onReply,
  scrollRoot,
}: Props) => {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 下方向スクロールで追加読み込み（IntersectionObserver）
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !isLoading) {
        onLoadMore();
      }
    },
    [onLoadMore, hasMore, isLoading],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleIntersect, {
      root: scrollRoot?.current ?? null,
      threshold: 0,
      rootMargin: "200px",
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect, scrollRoot]);

  return (
    <>
      {posts.map((item, idx) => {
        const uri = item.post.uri;
        const replyParent =
          item.reply && AppBskyFeedDefs.isPostView(item.reply.parent)
            ? {
                handle: item.reply.parent.author.handle,
                uri: item.reply.parent.uri,
              }
            : undefined;
        return (
          <PostCard
            key={`${uri}-${idx}`}
            post={item.post}
            verificationLevel={verificationMap.get(uri) ?? "none"}
            signature={signatureMap.get(uri)}
            onSignatureClick={onSignatureClick}
            onReply={onReply}
            reason={
              AppBskyFeedDefs.isReasonRepost(item.reason)
                ? item.reason
                : undefined
            }
            replyParent={replyParent}
          />
        );
      })}
      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" />
      {isLoading && <Spinner />}
    </>
  );
};

export default Timeline;
