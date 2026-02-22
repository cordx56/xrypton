import { useState } from "react";
import { useChat } from "@/contexts/ChatContext";
import { useRealtime } from "@/contexts/RealtimeContext";
import { useI18n } from "@/contexts/I18nContext";
import { formatDateTime } from "@/utils/date";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAngleLeft,
  faArrowsRotate,
  faPlus,
  faBoxArchive,
  faBoxOpen,
  faClock,
  faRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import Spinner from "@/components/common/Spinner";
import type { Thread } from "@/types/chat";

type Props = {
  groupName: string;
  onSelect: (thread: Thread) => void;
  onNew: () => void;
  onBack: () => void;
  onArchive: (thread: Thread) => void;
  onUnarchive: (thread: Thread) => void;
  archivedThreads: Thread[];
  onJoinRealtime?: (sessionId: string) => void;
  onLeaveRealtime?: (sessionId: string) => void;
};

const ThreadList = ({
  groupName,
  onSelect,
  onNew,
  onBack,
  onArchive,
  onUnarchive,
  archivedThreads,
  onJoinRealtime,
  onLeaveRealtime,
}: Props) => {
  const { threads, unreadThreadIds, loadingThreads } = useChat();
  const { pendingSessions, activeSession } = useRealtime();
  const { t } = useI18n();
  const [showArchived, setShowArchived] = useState(false);

  const displayThreads = showArchived ? archivedThreads : threads;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-accent/30">
        <button
          type="button"
          onClick={onBack}
          className="px-2 py-1 hover:bg-accent/20 rounded lg:hidden"
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
        {/* リアルタイムセッション（アーカイブ表示でない場合のみ） */}
        {!showArchived && pendingSessions.length > 0 && (
          <ul>
            {pendingSessions.map((session) => (
              <li
                key={session.sessionId}
                role="button"
                tabIndex={0}
                onClick={() => onJoinRealtime?.(session.sessionId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onJoinRealtime?.(session.sessionId);
                  }
                }}
                className="w-full text-left px-4 py-3 border-b border-accent/10 hover:bg-accent/10 transition-colors flex items-center gap-2 cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate flex items-center gap-1 font-medium">
                    <FontAwesomeIcon
                      icon={faClock}
                      className="text-xs text-accent flex-shrink-0"
                    />
                    {session.name}
                  </div>
                  <div className="text-xs text-muted">
                    {t("realtime.session")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLeaveRealtime?.(session.sessionId);
                  }}
                  className="text-muted hover:text-fg px-2 py-1 rounded hover:bg-accent/20 flex-shrink-0"
                  title={t("realtime.leave")}
                >
                  <FontAwesomeIcon
                    icon={faRightFromBracket}
                    className="text-sm"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* アクティブなリアルタイムセッション */}
        {!showArchived && activeSession && (
          <ul>
            <li
              role="button"
              tabIndex={0}
              onClick={() => onJoinRealtime?.(activeSession.sessionId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onJoinRealtime?.(activeSession.sessionId);
                }
              }}
              className="w-full text-left px-4 py-3 border-b border-accent/10 bg-accent/5 hover:bg-accent/10 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="truncate flex items-center gap-1 font-bold">
                  <FontAwesomeIcon
                    icon={faClock}
                    className="text-xs text-accent flex-shrink-0"
                  />
                  {activeSession.name}
                </div>
                <div className="text-xs text-accent">
                  {t("realtime.active")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onLeaveRealtime?.(activeSession.sessionId)}
                className="text-muted hover:text-fg px-2 py-1 rounded hover:bg-accent/20 flex-shrink-0"
                title={t("realtime.leave")}
              >
                <FontAwesomeIcon
                  icon={faRightFromBracket}
                  className="text-sm"
                />
              </button>
            </li>
          </ul>
        )}
        {/* 通常スレッド一覧 */}
        {!showArchived &&
        loadingThreads &&
        displayThreads.length === 0 &&
        pendingSessions.length === 0 &&
        !activeSession ? (
          <Spinner />
        ) : displayThreads.length === 0 &&
          pendingSessions.length === 0 &&
          !activeSession ? (
          <p className="text-center text-muted p-8">
            {showArchived
              ? t("chat.no_archived_threads")
              : t("chat.no_threads")}
          </p>
        ) : (
          <ul>
            {displayThreads.map((thread) => (
              <li
                key={thread.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(thread)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(thread);
                  }
                }}
                className={`w-full text-left px-4 py-3 border-b border-accent/10 hover:bg-accent/10 transition-colors flex items-center gap-2 cursor-pointer ${unreadThreadIds.has(thread.id) ? "bg-accent/10" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div
                    className={`truncate flex items-center gap-1 ${unreadThreadIds.has(thread.id) ? "font-bold" : "font-medium"}`}
                  >
                    {thread.name || thread.id}
                  </div>
                  <div className="text-xs text-muted flex items-center gap-1">
                    <FontAwesomeIcon icon={faArrowsRotate} />
                    {formatDateTime(thread.updated_at ?? thread.created_at)}
                  </div>
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

export default ThreadList;
