"use client";

import { useState, useEffect } from "react";
import { apiClient, getApiBaseUrl } from "@/api/client";
import { usePublicKeyResolver } from "@/hooks/usePublicKeyResolver";

export type ResolvedProfile = {
  userId: string;
  displayName: string;
  iconUrl: string | null;
  signingPublicKey?: string;
};

/**
 * ユーザ ID リストからプロフィールを取得し、署名済み display_name を平文に解決する。
 * ユーザ一覧表示で共通利用する。
 */
export function useResolvedProfiles(userIds: string[]) {
  const { resolveDisplayName } = usePublicKeyResolver();
  const [profiles, setProfiles] = useState<ResolvedProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userIds.length === 0) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      const results = await Promise.all(
        userIds.map(async (uid) => {
          try {
            const [profile, keys] = await Promise.all([
              apiClient().user.getProfile(uid),
              apiClient().user.getKeys(uid),
            ]);
            const iconUrl = profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
              : null;
            const displayName = await resolveDisplayName(
              uid,
              profile.display_name || uid,
            );
            return {
              userId: uid,
              displayName,
              iconUrl,
              signingPublicKey: keys.signing_public_key ?? undefined,
            };
          } catch {
            return { userId: uid, displayName: uid, iconUrl: null };
          }
        }),
      );
      if (!cancelled) {
        setProfiles(results);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userIds.join(","), resolveDisplayName]);

  return { profiles, loading };
}
