"use client";

import { useState, useCallback, useEffect, createElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AppBskyActorDefs,
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  RichText,
  Agent,
} from "@atproto/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHeart as faHeartSolid,
  faRetweet,
  faComment,
} from "@fortawesome/free-solid-svg-icons";
import { faHeart as faHeartRegular } from "@fortawesome/free-regular-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useDialogs } from "@/contexts/DialogContext";
import ImageLightbox from "@/components/common/ImageLightbox";
import Dialog from "@/components/common/Dialog";
import Spinner from "@/components/common/Spinner";
import SignatureBadge from "@/components/atproto/SignatureBadge";
import { useLongPress } from "@/hooks/useLongPress";
import type { VerificationLevel, AtprotoSignature } from "@/types/atproto";

type Props = {
  post: AppBskyFeedDefs.PostView;
  verificationLevel?: VerificationLevel;
  signature?: AtprotoSignature;
  onSignatureClick?: (signature: AtprotoSignature) => void;
  onReply?: (post: AppBskyFeedDefs.PostView) => void;
  /** repost情報: 誰がリポストしたか */
  reason?: AppBskyFeedDefs.ReasonRepost;
  /** 返信先の情報（タイムラインで「〜へのリプライ」を表示） */
  replyParent?: { handle: string; uri: string };
};

/** at:// URIをページパスに変換 */
function postUriToPath(uri: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/yyy → /atproto/post/at:/did:plc:xxx/app.bsky.feed.post/yyy
  return `/atproto/post/${uri.replace("://", ":/")}`; // catch-all segmentのため
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return d.toLocaleDateString();
}

/** RichText セグメントを描画 */
function RichTextRenderer({
  text,
  facets,
}: {
  text: string;
  facets?: unknown[];
}) {
  const rt = new RichText({
    text,
    facets: facets as AppBskyFeedPost.Record["facets"],
  });

  const segments: React.ReactNode[] = [];
  let i = 0;
  for (const seg of rt.segments()) {
    if (seg.isLink()) {
      segments.push(
        <a
          key={i}
          href={seg.link?.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {seg.text}
        </a>,
      );
    } else if (seg.isMention()) {
      segments.push(
        <Link
          key={i}
          href={`/atproto/profile/${seg.mention?.did}`}
          className="text-accent hover:underline"
        >
          {seg.text}
        </Link>,
      );
    } else if (seg.isTag()) {
      segments.push(
        <span key={i} className="text-accent">
          {seg.text}
        </span>,
      );
    } else {
      segments.push(<span key={i}>{seg.text}</span>);
    }
    i++;
  }
  return <>{segments}</>;
}

/** 画像埋め込みの描画 */
function ImageEmbed({ images }: { images: AppBskyEmbedImages.ViewImage[] }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const count = images.length;
  const gridClass = count === 1 ? "grid-cols-1" : "grid-cols-2";

  return (
    <>
      <div
        className={`grid ${gridClass} gap-1 mt-2 rounded-lg overflow-hidden`}
      >
        {images.map((img, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setLightboxIdx(idx)}
            className="cursor-pointer"
          >
            <img
              src={img.thumb}
              alt={img.alt || ""}
              className="w-full h-auto object-cover max-h-64"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      {lightboxIdx !== null && (
        <ImageLightbox
          src={images[lightboxIdx].fullsize}
          alt={images[lightboxIdx].alt || ""}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
}

/** 引用ポストの埋め込み表示 */
function QuoteEmbed({ record }: { record: AppBskyEmbedRecord.ViewRecord }) {
  const postRecord = record.value as AppBskyFeedPost.Record;
  return (
    <Link
      href={postUriToPath(record.uri)}
      className="block mt-2 p-3 rounded-lg border border-accent/20 hover:bg-accent/5 transition-colors"
    >
      <div className="flex items-center gap-1 text-xs text-muted mb-1">
        <span className="font-medium">
          {(record.author as { displayName?: string }).displayName ??
            record.author.handle}
        </span>
        <span>@{record.author.handle}</span>
      </div>
      {postRecord?.text && (
        <p className="text-sm line-clamp-3">{postRecord.text}</p>
      )}
    </Link>
  );
}

/** リポスト/いいねしたユーザ一覧ダイアログの中身 */
function UserList({
  agent,
  uri,
  mode,
}: {
  agent: Agent;
  uri: string;
  mode: "likes" | "reposts";
}) {
  const [users, setUsers] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (mode === "likes") {
          const res = await agent.getLikes({ uri, limit: 50 });
          setUsers(res.data.likes.map((l) => l.actor));
        } else {
          const res = await agent.getRepostedBy({ uri, limit: 50 });
          setUsers(res.data.repostedBy);
        }
      } catch {
        // サイレント
      } finally {
        setLoading(false);
      }
    })();
  }, [agent, uri, mode]);

  if (loading) return <Spinner />;
  if (users.length === 0) {
    return <p className="text-sm text-muted py-2">No users</p>;
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {users.map((user) => (
        <Link
          key={user.did}
          href={`/atproto/profile/${user.handle}`}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/10 transition-colors"
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="w-8 h-8 rounded-full"
              loading="lazy"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-accent/20" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {user.displayName ?? user.handle}
            </p>
            <p className="text-xs text-muted truncate">@{user.handle}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

const PostCard = ({
  post,
  verificationLevel = "none",
  signature,
  onSignatureClick,
  onReply,
  reason,
  replyParent,
}: Props) => {
  const router = useRouter();
  const { agent } = useAtproto();
  const { pushDialog } = useDialogs();
  const record = post.record as AppBskyFeedPost.Record;

  const [liked, setLiked] = useState(!!post.viewer?.like);
  const [likeCount, setLikeCount] = useState(post.likeCount ?? 0);
  const [likeUri, setLikeUri] = useState(post.viewer?.like);
  const [reposted, setReposted] = useState(!!post.viewer?.repost);
  const [repostCount, setRepostCount] = useState(post.repostCount ?? 0);
  const [repostUri, setRepostUri] = useState(post.viewer?.repost);

  const handleLike = useCallback(async () => {
    if (!agent) return;
    try {
      if (liked && likeUri) {
        await agent.deleteLike(likeUri);
        setLiked(false);
        setLikeUri(undefined);
        setLikeCount((c) => Math.max(0, c - 1));
      } else {
        const res = await agent.like(post.uri, post.cid);
        setLiked(true);
        setLikeUri(res.uri);
        setLikeCount((c) => c + 1);
      }
    } catch {
      // エラーはサイレントに無視
    }
  }, [agent, liked, likeUri, post.uri, post.cid]);

  const handleRepost = useCallback(async () => {
    if (!agent) return;
    try {
      if (reposted && repostUri) {
        await agent.deleteRepost(repostUri);
        setReposted(false);
        setRepostUri(undefined);
        setRepostCount((c) => Math.max(0, c - 1));
      } else {
        const res = await agent.repost(post.uri, post.cid);
        setReposted(true);
        setRepostUri(res.uri);
        setRepostCount((c) => c + 1);
      }
    } catch {
      // エラーはサイレントに無視
    }
  }, [agent, reposted, repostUri, post.uri, post.cid]);

  const showUserList = useCallback(
    (mode: "likes" | "reposts") => {
      if (!agent) return;
      const title = mode === "likes" ? "Liked by" : "Reposted by";
      pushDialog((p) =>
        createElement(
          Dialog,
          { ...p, title },
          createElement(UserList, { agent, uri: post.uri, mode }),
        ),
      );
    },
    [agent, pushDialog, post.uri],
  );

  const repostLp = useLongPress(
    useCallback(() => showUserList("reposts"), [showUserList]),
  );
  const likeLp = useLongPress(
    useCallback(() => showUserList("likes"), [showUserList]),
  );

  /** カード本体クリックでスレッドに遷移（リンク・ボタン内クリックは除外） */
  const handleCardClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("a, button")) return;
      router.push(postUriToPath(post.uri));
    },
    [router, post.uri],
  );

  // Embed rendering
  let embedContent: React.ReactNode = null;
  const embed = post.embed;
  if (embed) {
    if (AppBskyEmbedImages.isView(embed)) {
      embedContent = <ImageEmbed images={embed.images} />;
    } else if (AppBskyEmbedRecord.isView(embed)) {
      if (AppBskyEmbedRecord.isViewRecord(embed.record)) {
        embedContent = <QuoteEmbed record={embed.record} />;
      }
    } else if (AppBskyEmbedRecordWithMedia.isView(embed)) {
      const mediaEmbed = embed.media;
      if (AppBskyEmbedImages.isView(mediaEmbed)) {
        embedContent = <ImageEmbed images={mediaEmbed.images} />;
      }
    }
  }

  return (
    <div
      className="px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors cursor-pointer"
      onClick={handleCardClick}
    >
      {/* Repost indicator */}
      {reason && (
        <div className="flex items-center gap-1 text-xs text-muted mb-1 ml-10">
          <FontAwesomeIcon icon={faRetweet} className="text-[10px]" />
          <span>
            {(reason.by as { displayName?: string }).displayName ??
              reason.by.handle}{" "}
            reposted
          </span>
        </div>
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <Link
          href={`/atproto/profile/${post.author.handle}`}
          className="shrink-0"
        >
          {post.author.avatar ? (
            <img
              src={post.author.avatar}
              alt=""
              className="w-10 h-10 rounded-full"
              loading="lazy"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-accent/20" />
          )}
        </Link>

        <div className="flex-1 min-w-0">
          {/* 返信先表示 */}
          {replyParent && (
            <div className="text-xs text-muted mb-0.5">
              <Link
                href={postUriToPath(replyParent.uri)}
                className="hover:underline"
              >
                reply to @{replyParent.handle}
              </Link>
            </div>
          )}

          {/* Author info + timestamp */}
          <div className="flex items-center gap-1 text-sm">
            <Link
              href={`/atproto/profile/${post.author.handle}`}
              className="font-semibold truncate hover:underline"
            >
              {post.author.displayName ?? post.author.handle}
            </Link>
            <span className="text-muted truncate">@{post.author.handle}</span>
            <span className="text-muted shrink-0">
              ·{" "}
              <Link href={postUriToPath(post.uri)} className="hover:underline">
                {formatDate(record.createdAt)}
              </Link>
            </span>
            {verificationLevel !== "none" && (
              <>
                <span className="text-muted shrink-0">·</span>
                <SignatureBadge
                  level={verificationLevel}
                  onClick={
                    signature && onSignatureClick
                      ? () => onSignatureClick(signature)
                      : undefined
                  }
                />
              </>
            )}
          </div>

          {/* Post text */}
          {record.text && (
            <div className="text-sm mt-1 whitespace-pre-wrap break-words">
              <RichTextRenderer
                text={record.text}
                facets={record.facets as unknown[]}
              />
            </div>
          )}

          {/* Embed */}
          {embedContent}

          {/* Action bar */}
          <div className="flex items-center gap-6 mt-2 text-muted">
            <button
              type="button"
              onClick={() => onReply?.(post)}
              className="flex items-center gap-1 text-xs hover:text-accent transition-colors"
            >
              <FontAwesomeIcon icon={faComment} />
              <span>{post.replyCount ?? 0}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (repostLp.longPressedRef.current) return;
                handleRepost();
              }}
              onTouchStart={repostLp.onTouchStart}
              onTouchEnd={repostLp.onTouchEnd}
              onTouchCancel={repostLp.onTouchCancel}
              onContextMenu={repostLp.onContextMenu}
              className={`flex items-center gap-1 text-xs transition-colors ${reposted ? "text-green-400" : "hover:text-green-400"}`}
            >
              <FontAwesomeIcon icon={faRetweet} />
              <span>{repostCount}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (likeLp.longPressedRef.current) return;
                handleLike();
              }}
              onTouchStart={likeLp.onTouchStart}
              onTouchEnd={likeLp.onTouchEnd}
              onTouchCancel={likeLp.onTouchCancel}
              onContextMenu={likeLp.onContextMenu}
              className={`flex items-center gap-1 text-xs transition-colors ${liked ? "text-red-400" : "hover:text-red-400"}`}
            >
              <FontAwesomeIcon icon={liked ? faHeartSolid : faHeartRegular} />
              <span>{likeCount}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostCard;
