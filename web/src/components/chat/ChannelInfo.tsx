"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import { displayUserId } from "@/utils/schema";
import { useResolvedProfiles } from "@/hooks/useResolvedProfiles";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Spinner from "@/components/common/Spinner";

type Props = {
  chatId: string;
};

const ChannelInfo = ({ chatId }: Props) => {
  const router = useRouter();
  const auth = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [channelName, setChannelName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [fetching, setFetching] = useState(true);
  const { profiles: members, loading: resolvingProfiles } =
    useResolvedProfiles(memberIds);

  // グループ詳細からメンバー ID を取得
  useEffect(() => {
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const client = authApiClient(signed.signedMessage);
        const data = await client.chat.get(chatId);
        setChannelName(data.group?.name || chatId);
        const ids = (data.members ?? []).map(
          (m: { user_id: string }) => m.user_id,
        );
        setMemberIds(ids);
      } catch {
        showError(t("error.unknown"));
      } finally {
        setFetching(false);
      }
    })();
  }, [chatId]);

  const loading = fetching || resolvingProfiles;

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
                href={`/profile/${m.userId}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors"
              >
                <Avatar
                  name={m.displayName}
                  iconUrl={m.iconUrl}
                  iconSignature={m.iconSignature}
                  publicKey={m.signingPublicKey}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{m.displayName}</div>
                  <div className="text-xs text-muted truncate">
                    {displayUserId(m.userId)}
                  </div>
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
