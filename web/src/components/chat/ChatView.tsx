import { useState, useRef, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/contexts/ChatContext";
import { useI18n } from "@/contexts/I18nContext";
import { formatDate } from "@/utils/date";
import { displayUserId } from "@/utils/schema";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleLeft } from "@fortawesome/free-solid-svg-icons";
import MessageBubble from "./MessageBubble";
import DateSeparator from "./DateSeparator";
import ChatInput from "./ChatInput";
import Spinner from "@/components/common/Spinner";
import type { Message } from "@/types/chat";

type MemberProfile = {
  display_name: string;
  icon_url: string | null;
  status: string;
};

type Props = {
  threadName: string;
  currentUserId?: string;
  memberProfiles: Record<string, MemberProfile>;
  loading: boolean;
  onSend: (text: string) => void | Promise<void>;
  onSendFile?: (file: File) => Promise<void>;
  onDownloadFile?: (message: Message) => void;
  onLoadMore: () => void;
  onBack: () => void;
};

const ChatView = ({
  threadName,
  currentUserId,
  memberProfiles,
  loading,
  onSend,
  onSendFile,
  onDownloadFile,
  onLoadMore,
  onBack,
}: Props) => {
  const { messages, totalMessages } = useChat();
  const { t } = useI18n();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const prevMessageCountRef = useRef(0);
  const isLoadingMore = useRef(false);
  const isAtBottomRef = useRef(true);
  const [isDragging, setIsDragging] = useState(false);

  // 追加ロード前にスクロール高さを記録
  const handleLoadMoreWrapped = () => {
    const el = scrollRef.current;
    if (el) {
      prevScrollHeightRef.current = el.scrollHeight;
      isLoadingMore.current = true;
    }
    onLoadMore();
  };

  // メッセージ変化後のスクロール制御
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (isLoadingMore.current) {
      // 追加ロード: スクロール位置を維持
      const diff = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop += diff;
      isLoadingMore.current = false;
    } else if (messages.length !== prevMessageCountRef.current) {
      // 新メッセージ or 初回ロード: 最下部へ
      el.scrollTop = el.scrollHeight;
      isAtBottomRef.current = true;
    } else if (isAtBottomRef.current) {
      // 内容変更（復号など）で高さが変わっても最下部を維持
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  // ドラッグカウンタでネストされたenter/leaveを追跡
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && onSendFile) {
      await onSendFile(file);
    }
  };

  // 日付でグルーピングしてメッセージを表示
  let lastDate = "";

  return (
    <div
      className={`flex flex-col h-full w-full ${isDragging ? "ring-2 ring-accent ring-inset" : ""}`}
      onDragEnter={onSendFile ? handleDragEnter : undefined}
      onDragLeave={onSendFile ? handleDragLeave : undefined}
      onDragOver={onSendFile ? handleDragOver : undefined}
      onDrop={onSendFile ? handleDrop : undefined}
    >
      <div className="flex items-center gap-2 p-4 border-b border-accent/30">
        <button
          type="button"
          onClick={onBack}
          className="px-2 py-1 hover:bg-accent/20 rounded lg:hidden"
        >
          <FontAwesomeIcon icon={faAngleLeft} className="text-xl" />
        </button>
        <h2 className="font-semibold flex-1 truncate">{threadName}</h2>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          isAtBottomRef.current =
            el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
          if (
            el.scrollTop < 100 &&
            messages.length < totalMessages &&
            !loading
          ) {
            handleLoadMoreWrapped();
          }
        }}
      >
        {loading && <Spinner />}
        {messages.length === 0 && !loading && (
          <p className="text-center text-muted p-8">{t("chat.no_messages")}</p>
        )}
        {messages.map((msg) => {
          const date = formatDate(msg.created_at);
          let separator = null;
          if (date !== lastDate) {
            lastDate = date;
            separator = <DateSeparator key={`date-${date}`} date={date} />;
          }
          const senderId = msg.sender_id;
          const profile = senderId ? memberProfiles[senderId] : undefined;
          return (
            <div key={msg.id}>
              {separator}
              <MessageBubble
                message={msg}
                isOwn={senderId != null && senderId === currentUserId}
                displayName={
                  profile?.display_name ??
                  (senderId ? displayUserId(senderId) : t("chat.deleted_user"))
                }
                iconUrl={profile?.icon_url ?? null}
                status={profile?.status ?? ""}
                onClickUser={
                  senderId
                    ? () => router.push(`/profile/${senderId}`)
                    : undefined
                }
                onDownloadFile={onDownloadFile}
              />
            </div>
          );
        })}
      </div>

      <ChatInput onSend={onSend} onSendFile={onSendFile} />
    </div>
  );
};

export default ChatView;
