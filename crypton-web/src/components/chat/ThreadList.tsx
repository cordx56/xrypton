import { useState } from "react";
import { useChat } from "@/contexts/ChatContext";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAngleLeft,
  faPlus,
  faBoxArchive,
  faBoxOpen,
} from "@fortawesome/free-solid-svg-icons";
import type { Thread } from "@/types/chat";

type Props = {
  groupName: string;
  onSelect: (thread: Thread) => void;
  onNew: () => void;
  onBack: () => void;
  onArchive: (thread: Thread) => void;
  onUnarchive: (thread: Thread) => void;
  archivedThreads: Thread[];
};

const ThreadList = ({
  groupName,
  onSelect,
  onNew,
  onBack,
  onArchive,
  onUnarchive,
  archivedThreads,
}: Props) => {
  const { threads } = useChat();
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);

  const displayThreads = showArchived ? archivedThreads : threads;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-accent/30">
        <button
          type="button"
          onClick={onBack}
          className="px-2 py-1 hover:bg-accent/20 rounded md:hidden"
        >
          <FontAwesomeIcon icon={faAngleLeft} className="text-xl" />
        </button>
        <h2 className="font-semibold flex-1 truncate">{groupName}</h2>
        <button
          type="button"
          onClick={() => setShowArchived((prev) => !prev)}
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
      <div className="flex-1 overflow-y-auto">
        {displayThreads.length === 0 ? (
          <p className="text-center text-muted p-8">
            {showArchived
              ? t("chat.no_archived_threads")
              : t("chat.no_threads")}
          </p>
        ) : (
          displayThreads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => onSelect(thread)}
              className="w-full text-left px-4 py-3 border-b border-accent/10 hover:bg-accent/10 transition-colors flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {thread.name || thread.id}
                </div>
                <div className="text-xs text-muted">{thread.created_at}</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (showArchived) {
                    onUnarchive(thread);
                  } else {
                    onArchive(thread);
                  }
                }}
                className="text-muted hover:text-fg px-2 py-1 rounded hover:bg-accent/20 flex-shrink-0"
                title={
                  showArchived ? t("chat.unarchive") : t("chat.archive")
                }
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

export default ThreadList;
