import { useState } from "react";
import { useChat } from "@/contexts/ChatContext";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMessage } from "@fortawesome/free-regular-svg-icons";
import { faPlus, faBoxArchive, faBoxOpen } from "@fortawesome/free-solid-svg-icons";
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
  const { groups } = useChat();
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);

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
            {showArchived ? t("chat.no_archived_groups") : t("chat.no_groups")}
          </p>
        ) : (
          displayGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g)}
              className="w-full text-left px-4 py-3 border-b border-accent/10 hover:bg-accent/10 transition-colors flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{g.name || g.id}</div>
                <div className="text-xs text-muted">{g.created_at}</div>
              </div>
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
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatGroupList;
