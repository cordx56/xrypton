"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAtproto } from "@/contexts/AtprotoContext";
import Spinner from "@/components/common/Spinner";

// BrowserOAuthClient.init() がURL paramsを自動処理するため、
// ページ自体はローディング表示のみ
export default function AtprotoCallbackPage() {
  const router = useRouter();
  const { isLoading, isConnected } = useAtproto();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isConnected ? "/atproto" : "/atproto/settings");
  }, [isLoading, isConnected, router]);

  return (
    <div className="flex items-center justify-center h-full">
      <Spinner />
    </div>
  );
}
