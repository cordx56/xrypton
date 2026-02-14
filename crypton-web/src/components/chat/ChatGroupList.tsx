import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { useI18n } from "@/contexts/I18nContext";
import { authApiClient, apiClient } from "@/api/client";
import { formatDateTime } from "@/utils/date";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMessage } from "@fortawesome/free-regular-svg-icons";
import {
  faPlus,
  faBoxArchive,
  faBoxOpen,
  faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";
import type { ChatGroup } from "@/types/chat";

type Props = {
  onSelect: (group: ChatGroup) => void;
  onNew: () => void;
  onArchive: (group: ChatGroup) => void;
  onUnarchive: (group: ChatGroup) => void;
  archivedGroups: ChatGroup[];
  onShowArchived: () => void;
};

const ChatGroupList = ({
  onSelect,
  onNew,
  onArchive,
  onUnarchive,
  archivedGroups,
  onShowArchived,
}: Props) => {
  const router = useRouter();
  const auth = useAuth();
  const { groups } = useChat();
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>(
    {},
  );

  // 空名グループのメンバー表示名を解決
  useEffect(() => {
    const emptyNameGroups = groups.filter((g) => !g.name);
    if (emptyNameGroups.length === 0) return;

    (async () => {
      const names: Record<string, string> = {};
      for (const g of emptyNameGroups) {
        try {
          const signed = await auth.getSignedMessage();
          if (!signed) continue;
          const client = authApiClient(signed.signedMessage);
          const data = await client.chat.get(g.id);
          const members: { user_id: string }[] = data.members ?? [];
          const profiles = await Promise.all(
            members.map(async (m) => {
              try {
                const profile = await apiClient().user.getProfile(m.user_id);
                return {
                  userId: m.user_id,
                  displayName: profile.display_name || m.user_id,
                };
              } catch {
                return { userId: m.user_id, displayName: m.user_id };
              }
            }),
          );
          const others = profiles.filter((p) => p.userId !== auth.userId);
          names[g.id] =
            others.length > 0
              ? others.map((p) => p.displayName).join(", ")
              : (profiles.find((p) => p.userId === auth.userId)?.displayName ??
                g.id);
        } catch {
          // メンバー名解決に失敗したグループはスキップ
        }
      }
      setResolvedNames((prev) => ({ ...prev, ...names }));
    })();
  }, [groups]);

  const handleToggleArchived = () => {
    if (!showArchived) {
      onShowArchived();
    }
    setShowArchived((prev) => !prev);
  };

  const displayGroups = showArchived ? archivedGroups : groups;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-accent/30">
        <h2 className="text-lg font-semibold">
          <FontAwesomeIcon icon={faMessage} className="mr-2" />
          {t("tab.chat")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleArchived}
            className={`text-sm px-2 py-1 rounded hover:bg-accent/30 ${showArchived ? "bg-accent/20" : ""}`}
            title={t("chat.show_archived")}
          >
            <FontAwesomeIcon icon={faBoxOpen} />
          </button>
          {!showArchived && (
            <button
              type="button"
              onClick={onNew}
              className="text-sm px-3 py-1 rounded bg-accent/20 hover:bg-accent/30"
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {displayGroups.length === 0 ? (
          <p className="text-center text-muted p-8">
            {showArchived
              ? t("chat.no_archived_channels")
              : t("chat.no_channels")}
          </p>
        ) : (
          <ul>
            {displayGroups.map((g) => (
              <li
                key={g.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(g)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(g);
                  }
                }}
                className="w-full text-left px-4 py-3 border-b border-accent/10 hover:bg-accent/10 transition-colors flex items-center gap-2 cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {g.name || resolvedNames[g.id] || g.id}
                  </div>
                  <div className="text-xs text-muted">
                    {formatDateTime(g.created_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/chat/${g.id}/info`);
                  }}
                  className="text-muted hover:text-fg px-2 py-1 rounded hover:bg-accent/20 flex-shrink-0"
                  title={t("chat.channel_info")}
                >
                  <FontAwesomeIcon icon={faCircleInfo} className="text-sm" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (showArchived) {
                      onUnarchive(g);
                    } else {
                      onArchive(g);
                    }
                  }}
                  className="text-muted hover:text-fg px-2 py-1 rounded hover:bg-accent/20 flex-shrink-0"
                  title={showArchived ? t("chat.unarchive") : t("chat.archive")}
                >
                  <FontAwesomeIcon
                    icon={showArchived ? faBoxOpen : faBoxArchive}
                    className="text-sm"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ChatGroupList;
