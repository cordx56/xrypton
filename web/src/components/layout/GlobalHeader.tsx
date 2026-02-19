"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import Avatar from "@/components/common/Avatar";
import { getCachedProfile, setCachedProfile } from "@/utils/accountStore";
import { apiClient, getApiBaseUrl } from "@/api/client";
import type { AccountInfo } from "@/types/user";
import { bytesToBase64 } from "@/utils/base64";

const GlobalHeader = () => {
  const auth = useAuth();
  const [profile, setProfile] = useState<AccountInfo | undefined>(undefined);

  const refreshProfile = useCallback(async () => {
    if (!auth.userId) return;
    const cached = await getCachedProfile(auth.userId);
    if (cached) {
      setProfile(cached);
      return;
    }
    // キャッシュがない場合（新端末ログイン時など）はAPIから取得
    try {
      const client = apiClient();
      const [p, keys] = await Promise.all([
        client.user.getProfile(auth.userId),
        client.user.getKeys(auth.userId),
      ]);
      // detached signature で display_name を検証
      let dn: string | undefined = p.display_name || undefined;
      if (dn && p.display_name_signature && auth.worker) {
        const verified = await new Promise<boolean>((resolve) => {
          auth.worker!.eventWaiter("verify_detached_signature", (r) => {
            resolve(r.success);
          });
          auth.worker!.postMessage({
            call: "verify_detached_signature",
            publicKey: keys.signing_public_key,
            signature: p.display_name_signature,
            data: bytesToBase64(new TextEncoder().encode(dn)),
          });
        });
        if (!verified) dn = undefined;
      }
      const info: AccountInfo = {
        userId: auth.userId,
        displayName: dn,
        displayNameSignature: p.display_name_signature || null,
        iconUrl: p.icon_url ? `${getApiBaseUrl()}${p.icon_url}` : null,
        iconSignature: p.icon_signature || null,
        signingPublicKey: keys.signing_public_key,
      };
      await setCachedProfile(auth.userId, info);
      setProfile(info);
    } catch {
      setProfile({ userId: auth.userId });
    }
  }, [auth.userId, auth.worker]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  // プロフィール更新イベントを受け取ってアイコンを再読み込み
  useEffect(() => {
    window.addEventListener("profile-updated", refreshProfile);
    return () => window.removeEventListener("profile-updated", refreshProfile);
  }, [refreshProfile]);

  return (
    <header className="border-b border-accent/30 bg-bg shrink-0">
      <div className="flex items-center justify-between px-4 py-2 max-w-[1400px] mx-auto w-full">
        <Link href="/?landing" className="font-bold text-sm tracking-wide">
          Xrypton
        </Link>
        {auth.userId && (
          <Link href="/profile" className="flex items-center">
            <Avatar
              name={profile?.displayName || auth.userId || "?"}
              iconUrl={profile?.iconUrl}
              iconSignature={profile?.iconSignature}
              publicKey={auth.publicKeys ?? undefined}
              size="sm"
            />
          </Link>
        )}
      </div>
    </header>
  );
};

export default GlobalHeader;
