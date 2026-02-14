"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient, apiClient, getApiBaseUrl } from "@/api/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Spinner from "@/components/common/Spinner";

type MemberInfo = {
  userId: string;
  displayName: string;
  iconUrl: string | null;
};

type Props = {
  chatId: string;
};

const ChannelInfo = ({ chatId }: Props) => {
  const router = useRouter();
  const auth = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [channelName, setChannelName] = useState("");
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const client = authApiClient(signed.signedMessage);
        const data = await client.chat.get(chatId);
        setChannelName(data.group?.name || chatId);

        const resolved = await Promise.all(
          (data.members ?? []).map(async (m: { user_id: string }) => {
            try {
              const profile = await apiClient().user.getProfile(m.user_id);
              const iconUrl = profile.icon_url
                ? `${getApiBaseUrl()}${profile.icon_url}`
                : null;
              return {
                userId: m.user_id,
                displayName: profile.display_name || m.user_id,
                iconUrl,
              };
            } catch {
              return {
                userId: m.user_id,
                displayName: m.user_id,
                iconUrl: null,
              };
            }
          }),
        );
        setMembers(resolved);

        // 空名の場合、メンバー表示名で代替
        if (!data.group?.name) {
          const others = resolved.filter((m) => m.userId !== auth.userId);
          const displayName =
            others.length > 0
              ? others.map((m) => m.displayName).join(", ")
              : (resolved.find((m) => m.userId === auth.userId)?.displayName ??
                chatId);
          setChannelName(displayName);
        }
      } catch {
        showError(t("error.unknown"));
      } finally {
        setLoading(false);
      }
    })();
  }, [chatId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-accent/30">
        <button
          type="button"
          onClick={() => router.push(`/chat/${chatId}`)}
          className="p-2 hover:bg-accent/10 rounded"
        >
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <h2 className="text-lg font-semibold truncate">
          {t("chat.channel_info")}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <label className="block text-sm text-muted mb-1">
            {t("chat.channel_name")}
          </label>
          <p className="font-medium">{channelName}</p>
        </div>

        <div>
          <label className="block text-sm text-muted mb-2">
            {t("chat.members")} ({members.length})
          </label>
          <div>
            {members.map((m) => (
              <Link
                key={m.userId}
                href={`/contact/${m.userId}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors"
              >
                <Avatar name={m.displayName} iconUrl={m.iconUrl} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{m.displayName}</div>
                  <div className="text-xs text-muted truncate">{m.userId}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChannelInfo;
