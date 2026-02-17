"use client";

import { useAtproto } from "@/contexts/AtprotoContext";
import { useI18n } from "@/contexts/I18nContext";
import AtprotoHeader from "@/components/atproto/AtprotoHeader";
import NotificationList from "@/components/atproto/NotificationList";
import Spinner from "@/components/common/Spinner";

export default function NotificationsPage() {
  const { isLoading: authLoading } = useAtproto();
  const { t } = useI18n();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <AtprotoHeader title={t("atproto.notifications")} />
      <div className="flex-1 overflow-hidden">
        <NotificationList />
      </div>
    </div>
  );
}
