"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createElement,
  useMemo,
} from "react";
import { useParams } from "next/navigation";
import { AppBskyActorDefs, AppBskyFeedDefs } from "@atproto/api";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useDialogs } from "@/contexts/DialogContext";
import AtprotoHeader from "@/components/atproto/AtprotoHeader";
import AtprotoProfile from "@/components/atproto/AtprotoProfile";
import Timeline from "@/components/atproto/Timeline";
import Dialog from "@/components/common/Dialog";
import SignatureVerifier from "@/components/atproto/SignatureVerifier";
import Spinner from "@/components/common/Spinner";
import { useAtprotoSignatures } from "@/hooks/useAtprotoSignature";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import type { AtprotoSignature } from "@/types/atproto";

/** プロフィールページのデータキャッシュ */
const profileCache = new Map<
  string,
  {
    profile: AppBskyActorDefs.ProfileViewDetailed;
    feed: AppBskyFeedDefs.FeedViewPost[];
    cursor: string | undefined;
    hasMore: boolean;
  }
>();

export default function ProfilePage() {
  const params = useParams<{ handle: string }>();
  const { agent, isLoading: authLoading } = useAtproto();
  const { pushDialog } = useDialogs();
  const scrollRef = useRef<HTMLDivElement>(null);

  const cached = params.handle ? profileCache.get(params.handle) : undefined;
  const [profile, setProfile] =
    useState<AppBskyActorDefs.ProfileViewDetailed | null>(
      () => cached?.profile ?? null,
    );
  const [feed, setFeed] = useState<AppBskyFeedDefs.FeedViewPost[]>(
    () => cached?.feed ?? [],
  );
  const [cursor, setCursor] = useState<string | undefined>(
    () => cached?.cursor,
  );
  const [loading, setLoading] = useState(!cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? true);

  const targets = useMemo(
    () =>
      feed.map((item) => ({
        uri: item.post.uri,
        cid: item.post.cid,
        record: item.post.record,
      })),
    [feed],
  );
  const { signatureMap, verificationMap } = useAtprotoSignatures(targets);

  useScrollRestore(`profile:${params.handle}`, scrollRef, !!profile);

  // キャッシュがなければ初回フェッチ
  useEffect(() => {
    if (!agent || !params.handle) return;
    if (profileCache.has(params.handle)) return;

    (async () => {
      setLoading(true);
      try {
        const [profileRes, feedRes] = await Promise.all([
          agent.getProfile({ actor: params.handle }),
          agent.getAuthorFeed({ actor: params.handle, limit: 50 }),
        ]);
        setProfile(profileRes.data);
        setFeed(feedRes.data.feed);
        setCursor(feedRes.data.cursor);
        setHasMore(!!feedRes.data.cursor);
      } catch {
        // エラー時はプロフィールなしで表示
      } finally {
        setLoading(false);
      }
    })();
  }, [agent, params.handle]);

  // 状態変更をキャッシュに反映
  useEffect(() => {
    if (!params.handle || !profile) return;
    profileCache.set(params.handle, { profile, feed, cursor, hasMore });
  }, [params.handle, profile, feed, cursor, hasMore]);

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

  const handleLoadMore = useCallback(async () => {
    if (!agent || !params.handle || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await agent.getAuthorFeed({
        actor: params.handle,
        limit: 50,
        cursor,
      });
      setFeed((prev) => [...prev, ...res.data.feed]);
      setCursor(res.data.cursor);
      setHasMore(!!res.data.cursor);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [agent, params.handle, cursor, loadingMore]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted">Profile not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <AtprotoHeader title={`@${profile.handle}`} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <AtprotoProfile profile={profile} />
        <div className="border-t border-accent/20">
          <Timeline
            posts={feed}
            signatureMap={signatureMap}
            verificationMap={verificationMap}
            onLoadMore={handleLoadMore}
            hasMore={hasMore}
            isLoading={loadingMore}
            onSignatureClick={handleSignatureClick}
            scrollRoot={scrollRef}
          />
        </div>
      </div>
    </div>
  );
}
