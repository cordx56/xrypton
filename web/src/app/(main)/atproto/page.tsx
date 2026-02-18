"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createElement,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { AppBskyFeedDefs } from "@atproto/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHouse,
  faMagnifyingGlass,
  faBell,
  faPenToSquare,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useDialogs } from "@/contexts/DialogContext";
import AtprotoLogin from "@/components/atproto/AtprotoLogin";
import Timeline from "@/components/atproto/Timeline";
import SearchPanel from "@/components/atproto/SearchPanel";
import NotificationList from "@/components/atproto/NotificationList";
import ComposePost from "@/components/atproto/ComposePost";
import ComposeReply from "@/components/atproto/ComposeReply";
import VerificationPost from "@/components/atproto/VerificationPost";
import Dialog from "@/components/common/Dialog";
import SignatureVerifier from "@/components/atproto/SignatureVerifier";
import Spinner from "@/components/common/Spinner";
import { useAtprotoSignatures } from "@/hooks/useAtprotoSignature";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullIndicator from "@/components/common/PullIndicator";
import { useI18n } from "@/contexts/I18nContext";
import type { AtprotoSignature } from "@/types/atproto";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

type Tab = "home" | "search" | "notifications";

const tabs: { id: Tab; icon: IconDefinition }[] = [
  { id: "home", icon: faHouse },
  { id: "notifications", icon: faBell },
  { id: "search", icon: faMagnifyingGlass },
];

/** ページ遷移をまたいでタイムラインの状態を保持するキャッシュ */
let timelineCache: {
  posts: AppBskyFeedDefs.FeedViewPost[];
  cursor: string | undefined;
  hasMore: boolean;
} | null = null;

/** タイムライン列（ホーム） */
function HomeColumn() {
  const { agent } = useAtproto();
  const { pushDialog } = useDialogs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [posts, setPosts] = useState<AppBskyFeedDefs.FeedViewPost[]>(
    () => timelineCache?.posts ?? [],
  );
  const [cursor, setCursor] = useState<string | undefined>(
    () => timelineCache?.cursor,
  );
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(() => timelineCache?.hasMore ?? true);
  const initialLoaded = useRef(false);
  const [replyTo, setReplyTo] = useState<AppBskyFeedDefs.PostView | null>(null);

  useScrollRestore("home-timeline", scrollRef, posts.length > 0);

  const targets = useMemo(
    () =>
      posts.map((item) => ({
        uri: item.post.uri,
        cid: item.post.cid,
        record: item.post.record,
      })),
    [posts],
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

  const loadTimeline = useCallback(
    async (cursorParam?: string) => {
      if (!agent || loading) return;
      setLoading(true);
      try {
        const res = await agent.getTimeline({
          limit: 50,
          cursor: cursorParam,
        });
        const newPosts = res.data.feed;
        setPosts((prev) => (cursorParam ? [...prev, ...newPosts] : newPosts));
        setCursor(res.data.cursor);
        setHasMore(!!res.data.cursor);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [agent, loading],
  );

  // キャッシュがなければ初回ロード
  useEffect(() => {
    if (agent && !initialLoaded.current) {
      initialLoaded.current = true;
      if (!timelineCache?.posts.length) {
        loadTimeline();
      }
    }
  }, [agent, loadTimeline]);

  // 状態変更をキャッシュに反映
  useEffect(() => {
    if (posts.length > 0) {
      timelineCache = { posts, cursor, hasMore };
    }
  }, [posts, cursor, hasMore]);

  const handleRefresh = useCallback(async () => {
    timelineCache = null;
    await loadTimeline();
  }, [loadTimeline]);

  const { pullDistance, refreshing, threshold } = usePullToRefresh(
    scrollRef,
    handleRefresh,
  );

  const handleLoadMore = useCallback(() => {
    if (cursor && !loading) loadTimeline(cursor);
  }, [cursor, loading, loadTimeline]);

  const handleReply = useCallback((post: AppBskyFeedDefs.PostView) => {
    setReplyTo(post);
  }, []);

  return (
    <>
      <div ref={scrollRef} className="h-full overflow-y-auto">
        <PullIndicator
          pullDistance={pullDistance}
          refreshing={refreshing}
          threshold={threshold}
        />
        <Timeline
          posts={posts}
          signatureMap={signatureMap}
          verificationMap={verificationMap}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
          isLoading={loading}
          onSignatureClick={handleSignatureClick}
          onReply={handleReply}
          scrollRoot={scrollRef}
        />
      </div>
      {replyTo && (
        <ReplyOverlay
          replyTo={replyTo}
          onClose={() => setReplyTo(null)}
          onPosted={() => loadTimeline()}
        />
      )}
    </>
  );
}

/** カラムのラッパー（PC用ヘッダアイコン付き） */
function Column({
  icon,
  children,
}: {
  icon: IconDefinition;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="px-4 py-3 border-b border-accent/30">
        <FontAwesomeIcon icon={icon} className="text-lg text-muted" />
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
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

/** 投稿作成オーバーレイ */
function ComposeOverlay({ onClose }: { onClose: () => void }) {
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-accent/30">
          <span className="font-medium text-fg" />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted hover:text-fg transition-colors"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <ComposePost onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

export default function AtprotoPage() {
  const {
    isConnected,
    isLoading: authLoading,
    needsVerificationPost,
  } = useAtproto();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [showCompose, setShowCompose] = useState(false);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="h-full flex items-center justify-center">
        <AtprotoLogin />
      </div>
    );
  }

  if (needsVerificationPost) {
    return <VerificationPost />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* --- モバイル --- */}
      <div className="flex flex-col h-full md:hidden">
        {/* タブバー */}
        <div className="flex items-center border-b border-accent/30">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 px-3 flex items-center justify-center transition-colors -mb-px ${
                activeTab === tab.id
                  ? "text-accent border-b-2 border-accent"
                  : "text-muted hover:text-fg"
              }`}
            >
              <FontAwesomeIcon icon={tab.icon} className="text-lg" />
            </button>
          ))}
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-hidden">
          {activeTab === "home" && <HomeColumn />}
          {activeTab === "notifications" && <NotificationList />}
          {activeTab === "search" && <SearchPanel />}
        </div>
      </div>

      {/* --- PC: 3カラム横並び --- */}
      <div className="hidden md:flex h-full overflow-x-auto">
        <div className="flex-1 min-w-lg border-r border-accent/20">
          <Column icon={faHouse}>
            <HomeColumn />
          </Column>
        </div>
        <div className="flex-1 min-w-lg border-r border-accent/20">
          <Column icon={faBell}>
            <NotificationList />
          </Column>
        </div>
        <div className="flex-1 min-w-lg">
          <Column icon={faMagnifyingGlass}>
            <SearchPanel />
          </Column>
        </div>
      </div>

      {/* 投稿FAB */}
      <button
        type="button"
        onClick={() => setShowCompose(true)}
        title={t("atproto.compose")}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 w-12 h-12 flex items-center justify-center rounded-2xl bg-accent text-white shadow-lg hover:brightness-110 active:scale-95 transition-all"
      >
        <FontAwesomeIcon icon={faPenToSquare} className="text-2xl" />
      </button>

      {/* 投稿オーバーレイ */}
      {showCompose && <ComposeOverlay onClose={() => setShowCompose(false)} />}
    </div>
  );
}
