"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  createElement,
} from "react";
import Link from "next/link";
import {
  AppBskyActorDefs,
  AppBskyFeedDefs,
  RichText,
  Agent,
} from "@atproto/api";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserPlus, faUserMinus } from "@fortawesome/free-solid-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useDialogs } from "@/contexts/DialogContext";
import PostCard from "@/components/atproto/PostCard";
import Dialog from "@/components/common/Dialog";
import Spinner from "@/components/common/Spinner";
import type { AtprotoSignature, VerificationLevel } from "@/types/atproto";

/** フォロー/フォロワー一覧 */
function FollowList({
  agent,
  actor,
  mode,
}: {
  agent: Agent;
  actor: string;
  mode: "follows" | "followers";
}) {
  const [users, setUsers] = useState<AppBskyActorDefs.ProfileView[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(
    async (c?: string) => {
      setLoading(true);
      try {
        if (mode === "follows") {
          const res = await agent.getFollows({ actor, limit: 50, cursor: c });
          setUsers((prev) =>
            c ? [...prev, ...res.data.follows] : res.data.follows,
          );
          setCursor(res.data.cursor);
          setHasMore(!!res.data.cursor);
        } else {
          const res = await agent.getFollowers({ actor, limit: 50, cursor: c });
          setUsers((prev) =>
            c ? [...prev, ...res.data.followers] : res.data.followers,
          );
          setCursor(res.data.cursor);
          setHasMore(!!res.data.cursor);
        }
      } catch {
        // サイレント
      } finally {
        setLoading(false);
      }
    },
    [agent, actor, mode],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading && users.length === 0) return <Spinner />;
  if (users.length === 0) {
    return <p className="text-sm text-muted py-2">No users</p>;
  }

  return (
    <div className="space-y-1 max-h-96 overflow-y-auto">
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
      {hasMore && (
        <button
          type="button"
          onClick={() => load(cursor)}
          disabled={loading}
          className="w-full py-2 text-sm text-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}

/** プロフィール description 内のリンク・メンション・タグを自動検出して描画 */
function DescriptionText({ text }: { text: string }) {
  const rt = useMemo(() => {
    const r = new RichText({ text });
    r.detectFacetsWithoutResolution();
    return r;
  }, [text]);

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

type Props = {
  profile: AppBskyActorDefs.ProfileViewDetailed;
  feed: AppBskyFeedDefs.FeedViewPost[];
  signatureMap: Map<string, AtprotoSignature>;
  verificationMap: Map<string, VerificationLevel>;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onSignatureClick?: (signature: AtprotoSignature) => void;
};

const AtprotoProfile = ({
  profile,
  feed,
  signatureMap,
  verificationMap,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onSignatureClick,
}: Props) => {
  const { agent } = useAtproto();
  const { pushDialog } = useDialogs();
  const [following, setFollowing] = useState(!!profile.viewer?.following);
  const [followUri, setFollowUri] = useState(profile.viewer?.following);

  const handleFollow = useCallback(async () => {
    if (!agent) return;
    try {
      if (following && followUri) {
        await agent.deleteFollow(followUri);
        setFollowing(false);
        setFollowUri(undefined);
      } else {
        const res = await agent.follow(profile.did);
        setFollowing(true);
        setFollowUri(res.uri);
      }
    } catch {
      // サイレント
    }
  }, [agent, following, followUri, profile.did]);

  const showFollowList = useCallback(
    (mode: "follows" | "followers") => {
      if (!agent) return;
      const title = mode === "follows" ? "Following" : "Followers";
      pushDialog((p) =>
        createElement(
          Dialog,
          { ...p, title },
          createElement(FollowList, { agent, actor: profile.did, mode }),
        ),
      );
    },
    [agent, pushDialog, profile.did],
  );

  return (
    <div>
      {/* Banner */}
      {profile.banner ? (
        <img
          src={profile.banner}
          alt=""
          className="w-full h-32 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-32 bg-accent/20" />
      )}

      {/* Profile header */}
      <div className="px-4 pb-4 -mt-8">
        <div className="mb-3">
          {profile.avatar ? (
            <img
              src={profile.avatar}
              alt=""
              className="w-16 h-16 rounded-full border-2 border-bg"
              loading="lazy"
            />
          ) : (
            <div className="w-16 h-16 rounded-full border-2 border-bg bg-accent/20" />
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">
              {profile.displayName ?? profile.handle}
            </h2>
            <p className="text-sm text-muted">@{profile.handle}</p>
          </div>
          <button
            type="button"
            onClick={handleFollow}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              following
                ? "bg-accent/20 text-fg hover:bg-red-500/20 hover:text-red-400"
                : "bg-accent text-white"
            }`}
          >
            <FontAwesomeIcon
              icon={following ? faUserMinus : faUserPlus}
              className="mr-1"
            />
            {following ? "Unfollow" : "Follow"}
          </button>
        </div>

        {profile.description && (
          <p className="text-sm mt-2 whitespace-pre-wrap">
            <DescriptionText text={profile.description} />
          </p>
        )}

        <div className="flex gap-4 mt-2 text-sm">
          <button
            type="button"
            onClick={() => showFollowList("follows")}
            className="hover:underline"
          >
            <strong>{profile.followsCount ?? 0}</strong>{" "}
            <span className="text-muted">following</span>
          </button>
          <button
            type="button"
            onClick={() => showFollowList("followers")}
            className="hover:underline"
          >
            <strong>{profile.followersCount ?? 0}</strong>{" "}
            <span className="text-muted">followers</span>
          </button>
          <span>
            <strong>{profile.postsCount ?? 0}</strong>{" "}
            <span className="text-muted">posts</span>
          </span>
        </div>
      </div>

      {/* User feed */}
      <div className="border-t border-accent/20">
        {feed.map((item, idx) => (
          <PostCard
            key={`${item.post.uri}-${idx}`}
            post={item.post}
            reason={
              AppBskyFeedDefs.isReasonRepost(item.reason)
                ? item.reason
                : undefined
            }
            verificationLevel={verificationMap.get(item.post.uri) ?? "none"}
            signature={signatureMap.get(item.post.uri)}
            onSignatureClick={onSignatureClick}
          />
        ))}
        {isLoadingMore && <Spinner />}
        {hasMore && !isLoadingMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full py-3 text-sm text-accent hover:bg-accent/5 transition-colors"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
};

export default AtprotoProfile;
