import { useEffect, useRef } from "react";
import { useChat } from "@/contexts/ChatContext";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleLeft } from "@fortawesome/free-solid-svg-icons";
import MessageBubble from "./MessageBubble";
import DateSeparator from "./DateSeparator";
import ChatInput from "./ChatInput";
import Spinner from "@/components/common/Spinner";

type MemberProfile = { display_name: string; icon_url: string | null };

type Props = {
  threadName: string;
  currentUserId?: string;
  memberProfiles: Record<string, MemberProfile>;
  loading: boolean;
  onSend: (text: string) => void;
  onLoadMore: () => void;
  onBack: () => void;
};

const ChatView = ({
  threadName,
  currentUserId,
  memberProfiles,
  loading,
  onSend,
  onLoadMore,
  onBack,
}: Props) => {
  const { messages, totalMessages } = useChat();
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新メッセージ追加時に下へスクロール
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // 日付でグルーピングしてメッセージを表示
  let lastDate = "";

  return (
    <div className="flex flex-col h-full max-w-[1400px] mx-auto w-full">
      <div className="flex items-center gap-2 p-4 border-b border-accent/30">
        <button
          type="button"
          onClick={onBack}
          className="px-2 py-1 hover:bg-accent/20 rounded md:hidden"
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
          if (
            el.scrollTop < 100 &&
            messages.length < totalMessages &&
            !loading
          ) {
            onLoadMore();
          }
        }}
      >
        {loading && <Spinner />}
        {messages.length === 0 && !loading && (
          <p className="text-center text-muted p-8">{t("chat.no_messages")}</p>
        )}
        {messages.map((msg) => {
          const date = new Date(msg.created_at).toLocaleDateString();
          let separator = null;
          if (date !== lastDate) {
            lastDate = date;
            separator = <DateSeparator key={`date-${date}`} date={date} />;
          }
          const profile = memberProfiles[msg.sender_id];
          return (
            <div key={msg.id}>
              {separator}
              <MessageBubble
                message={msg}
                isOwn={msg.sender_id === currentUserId}
                displayName={profile?.display_name ?? msg.sender_id}
                iconUrl={profile?.icon_url ?? null}
              />
            </div>
          );
        })}
      </div>

      <ChatInput onSend={onSend} />
    </div>
  );
};

export default ChatView;
