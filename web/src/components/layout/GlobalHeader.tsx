"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import Avatar from "@/components/common/Avatar";
import { getCachedProfile } from "@/utils/accountStore";
import type { AccountInfo } from "@/types/user";

const GlobalHeader = () => {
  const auth = useAuth();
  const [profile, setProfile] = useState<AccountInfo | undefined>(undefined);

  const refreshProfile = useCallback(async () => {
    if (!auth.userId) return;
    const cached = await getCachedProfile(auth.userId);
    setProfile(cached ?? { userId: auth.userId });
  }, [auth.userId]);

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
        <Link href="/profile" className="flex items-center">
          <Avatar
            name={profile?.displayName || auth.userId || "?"}
            iconUrl={profile?.iconUrl}
            size="sm"
          />
        </Link>
      </div>
    </header>
  );
};

export default GlobalHeader;
