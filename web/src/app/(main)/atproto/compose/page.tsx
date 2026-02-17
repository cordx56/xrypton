"use client";

import { useAtproto } from "@/contexts/AtprotoContext";
import { useI18n } from "@/contexts/I18nContext";
import AtprotoHeader from "@/components/atproto/AtprotoHeader";
import ComposePost from "@/components/atproto/ComposePost";
import AtprotoLogin from "@/components/atproto/AtprotoLogin";
import Spinner from "@/components/common/Spinner";

export default function ComposePage() {
  const { isConnected, isLoading } = useAtproto();
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="h-full flex flex-col">
        <AtprotoHeader title={t("atproto.compose")} />
        <div className="flex-1 flex items-center justify-center">
          <AtprotoLogin />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <AtprotoHeader title={t("atproto.compose")} showBack />
      <div className="flex-1 overflow-y-auto">
        <ComposePost />
      </div>
    </div>
  );
}
