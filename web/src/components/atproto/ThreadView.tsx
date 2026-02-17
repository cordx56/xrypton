"use client";

import { AppBskyFeedDefs } from "@atproto/api";
import PostCard from "@/components/atproto/PostCard";
import type { AtprotoSignature, VerificationLevel } from "@/types/atproto";

type Props = {
  thread: AppBskyFeedDefs.ThreadViewPost;
  signatureMap: Map<string, AtprotoSignature>;
  verificationMap: Map<string, VerificationLevel>;
  onSignatureClick?: (signature: AtprotoSignature) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
};

/** 親投稿チェーンを再帰的にフラット化（ルートが先頭） */
function getParentChain(
  thread: AppBskyFeedDefs.ThreadViewPost,
): AppBskyFeedDefs.ThreadViewPost[] {
  const parents: AppBskyFeedDefs.ThreadViewPost[] = [];
  let current = thread.parent;
  while (current && AppBskyFeedDefs.isThreadViewPost(current)) {
    parents.unshift(current);
    current = current.parent;
  }
  return parents;
}

/** 返信ツリーを再帰描画 */
function ReplyTree({
  replies,
  depth,
  signatureMap,
  verificationMap,
  onSignatureClick,
  onReply,
}: {
  replies: AppBskyFeedDefs.ThreadViewPost[];
  depth: number;
  signatureMap: Map<string, AtprotoSignature>;
  verificationMap: Map<string, VerificationLevel>;
  onSignatureClick?: (signature: AtprotoSignature) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
}) {
  // ネストが深すぎる場合はインデントを制限
  const ml = depth <= 4 ? "ml-4" : "ml-2";

  return (
    <>
      {replies.map((reply) => {
        const childReplies = (reply.replies ?? []).filter(
          AppBskyFeedDefs.isThreadViewPost,
        );
        return (
          <div key={reply.post.uri} className={ml}>
            <PostCard
              post={reply.post}
              verificationLevel={verificationMap.get(reply.post.uri) ?? "none"}
              signature={signatureMap.get(reply.post.uri)}
              onSignatureClick={onSignatureClick}
              onReply={onReply}
            />
            {childReplies.length > 0 && (
              <ReplyTree
                replies={childReplies}
                depth={depth + 1}
                signatureMap={signatureMap}
                verificationMap={verificationMap}
                onSignatureClick={onSignatureClick}
                onReply={onReply}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

const ThreadView = ({
  thread,
  signatureMap,
  verificationMap,
  onSignatureClick,
  onReply,
}: Props) => {
  const parents = getParentChain(thread);
  const replies = (thread.replies ?? []).filter(
    AppBskyFeedDefs.isThreadViewPost,
  );

  return (
    <div>
      {/* 親投稿チェーン */}
      {parents.map((parent) => (
        <div key={parent.post.uri} className="opacity-70">
          <PostCard
            post={parent.post}
            verificationLevel={verificationMap.get(parent.post.uri) ?? "none"}
            signature={signatureMap.get(parent.post.uri)}
            onSignatureClick={onSignatureClick}
            onReply={onReply}
          />
        </div>
      ))}

      {/* 対象投稿 */}
      <div className="border-l-2 border-accent">
        <PostCard
          post={thread.post}
          verificationLevel={verificationMap.get(thread.post.uri) ?? "none"}
          signature={signatureMap.get(thread.post.uri)}
          onSignatureClick={onSignatureClick}
          onReply={onReply}
        />
      </div>

      {/* 返信ツリー（再帰） */}
      <ReplyTree
        replies={replies}
        depth={1}
        signatureMap={signatureMap}
        verificationMap={verificationMap}
        onSignatureClick={onSignatureClick}
        onReply={onReply}
      />
    </div>
  );
};

export default ThreadView;
