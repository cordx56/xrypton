"use client";

import { useAuth } from "@/contexts/AuthContext";
import { AtprotoProvider } from "@/contexts/AtprotoContext";
import GlobalHeader from "@/components/layout/GlobalHeader";
import BottomTabs from "@/components/layout/BottomTabs";

/**
 * 公開プロフィールページ用レイアウト。
 * ログイン済みなら (main) と同等のヘッダー・タブを表示し、
 * 未ログインならコンテンツのみを表示する。
 */
export default function PublicProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useAuth();

  const isLoggedIn =
    auth.isInitialized &&
    !!auth.privateKeys &&
    !!auth.userId &&
    auth.isRegistered &&
    !!auth.subPassphrase;

  if (!auth.isInitialized) return null;

  if (!isLoggedIn) {
    return (
      <div className="h-dvh flex flex-col">
        <GlobalHeader />
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    );
  }

  return (
    <AtprotoProvider>
      <div className="h-dvh flex flex-col">
        <GlobalHeader />
        <div className="flex-1 overflow-y-auto">{children}</div>
        <BottomTabs />
      </div>
    </AtprotoProvider>
  );
}
