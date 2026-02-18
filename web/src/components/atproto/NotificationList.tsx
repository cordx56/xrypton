"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  AppBskyNotificationListNotifications,
  AppBskyFeedDefs,
  AppBskyFeedPost,
} from "@atproto/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHeart,
  faRetweet,
  faUserPlus,
  faAt,
  faReply,
  faQuoteLeft,
} from "@fortawesome/free-solid-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import Spinner from "@/components/common/Spinner";
import PullIndicator from "@/components/common/PullIndicator";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";

type NotifItem = AppBskyNotificationListNotifications.Notification;

function notifIcon(reason: string) {
  switch (reason) {
    case "like":
      return { icon: faHeart, color: "text-red-400" };
    case "repost":
      return { icon: faRetweet, color: "text-green-400" };
    case "follow":
      return { icon: faUserPlus, color: "text-accent" };
    case "mention":
      return { icon: faAt, color: "text-yellow-400" };
    case "reply":
      return { icon: faReply, color: "text-blue-400" };
    case "quote":
      return { icon: faQuoteLeft, color: "text-purple-400" };
    default:
      return { icon: faAt, color: "text-muted" };
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "like":
      return "liked your post";
    case "repost":
      return "reposted your post";
    case "follow":
      return "followed you";
    case "mention":
      return "mentioned you";
    case "reply":
      return "replied";
    case "quote":
      return "quoted your post";
    default:
      return reason;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

/** at:// URIをページパスに変換 */
function postUriToPath(uri: string): string {
  return `/atproto/post/${uri.replace("://", ":/")}`; // catch-all segment
}

/** 対象ポストのプレビュー */
function SubjectPostPreview({ post }: { post: AppBskyFeedDefs.PostView }) {
  const record = post.record as AppBskyFeedPost.Record;
  if (!record?.text) return null;

  return (
    <Link
      href={postUriToPath(post.uri)}
      className="block mt-1.5 p-2.5 rounded-lg border border-accent/15 bg-accent/5 hover:bg-accent/10 transition-colors"
    >
      <p className="text-xs text-fg line-clamp-3 whitespace-pre-wrap">
        {record.text}
      </p>
    </Link>
  );
}

/** reply/mention 時は通知自体のレコードテキストを表示 */
function RecordTextPreview({ record }: { record: Record<string, unknown> }) {
  const text = (record as AppBskyFeedPost.Record)?.text;
  if (!text) return null;

  return (
    <p className="mt-1 text-xs text-fg line-clamp-3 whitespace-pre-wrap">
      {text}
    </p>
  );
}

const NotificationList = () => {
  const { agent } = useAtproto();
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [subjectPosts, setSubjectPosts] = useState<
    Map<string, AppBskyFeedDefs.PostView>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const initialLoaded = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /** 通知に含まれる対象ポストを一括取得して subjectPosts に追加 */
  const fetchSubjectPosts = useCallback(
    async (notifs: NotifItem[]) => {
      if (!agent) return;
      const subjectUris = [
        ...new Set(
          notifs
            .filter(
              (n) =>
                (n.reason === "like" ||
                  n.reason === "repost" ||
                  n.reason === "quote") &&
                n.reasonSubject,
            )
            .map((n) => n.reasonSubject!),
        ),
      ];
      if (subjectUris.length === 0) return;

      const posts = new Map<string, AppBskyFeedDefs.PostView>();
      for (let i = 0; i < subjectUris.length; i += 25) {
        const chunk = subjectUris.slice(i, i + 25);
        const postsRes = await agent.getPosts({ uris: chunk });
        for (const p of postsRes.data.posts) {
          posts.set(p.uri, p);
        }
      }
      setSubjectPosts((prev) => {
        const merged = new Map(prev);
        for (const [k, v] of posts) merged.set(k, v);
        return merged;
      });
    },
    [agent],
  );

  /** 先頭から通知を取得（プルリフレッシュ用） */
  const fetchNotifications = useCallback(async () => {
    if (!agent) return;
    try {
      const res = await agent.listNotifications({ limit: 50 });
      const notifs = res.data.notifications;
      setNotifications(notifs);
      setCursor(res.data.cursor);
      setHasMore(!!res.data.cursor);
      await fetchSubjectPosts(notifs);
    } catch {
      // エラー時は空リスト
    }
  }, [agent, fetchSubjectPosts]);

  /** 続きの通知を取得（無限スクロール用） */
  const loadMore = useCallback(async () => {
    if (!agent || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await agent.listNotifications({ limit: 50, cursor });
      const notifs = res.data.notifications;
      setNotifications((prev) => [...prev, ...notifs]);
      setCursor(res.data.cursor);
      setHasMore(!!res.data.cursor);
      await fetchSubjectPosts(notifs);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [agent, cursor, loadingMore, fetchSubjectPosts]);

  useEffect(() => {
    if (!agent || initialLoaded.current) return;
    initialLoaded.current = true;

    (async () => {
      await fetchNotifications();
      setLoading(false);
    })();
  }, [agent, fetchNotifications]);

  // 下方向スクロールで追加読み込み（IntersectionObserver）
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
        loadMore();
      }
    },
    [loadMore, hasMore, loadingMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(handleIntersect, {
      root: scrollRef.current,
      threshold: 0,
      rootMargin: "200px",
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect]);

  const { pullDistance, refreshing, threshold } = usePullToRefresh(
    scrollRef,
    fetchNotifications,
  );

  if (loading) return <Spinner />;

  if (notifications.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted text-sm">
        No notifications
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-y-auto h-full">
      <PullIndicator
        pullDistance={pullDistance}
        refreshing={refreshing}
        threshold={threshold}
      />
      {notifications.map((notif) => {
        const { icon, color } = notifIcon(notif.reason);
        const subjectPost = notif.reasonSubject
          ? subjectPosts.get(notif.reasonSubject)
          : undefined;
        const showRecordText =
          notif.reason === "reply" || notif.reason === "mention";

        return (
          <div
            key={`${notif.uri}-${notif.indexedAt}`}
            className={`px-4 py-3 border-b border-accent/10 ${
              !notif.isRead ? "bg-accent/5" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              {/* リアクションアイコン */}
              <FontAwesomeIcon
                icon={icon}
                className={`mt-1 text-sm shrink-0 ${color}`}
              />

              {/* アバター */}
              <Link
                href={`/atproto/profile/${notif.author.handle}`}
                className="shrink-0"
              >
                {notif.author.avatar ? (
                  <img
                    src={notif.author.avatar}
                    alt=""
                    className="w-8 h-8 rounded-full"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-accent/20" />
                )}
              </Link>

              {/* テキスト */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1 flex-wrap">
                  <Link
                    href={`/atproto/profile/${notif.author.handle}`}
                    className="text-sm font-medium hover:underline truncate"
                  >
                    {notif.author.displayName ?? notif.author.handle}
                  </Link>
                  <span className="text-xs text-muted">
                    {reasonLabel(notif.reason)} · {formatDate(notif.indexedAt)}
                  </span>
                </div>

                {/* reply/mention: 通知レコードのテキスト */}
                {showRecordText && <RecordTextPreview record={notif.record} />}

                {/* like/repost/quote: 対象ポスト */}
                {subjectPost && <SubjectPostPreview post={subjectPost} />}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && <Spinner />}
    </div>
  );
};

export default NotificationList;
