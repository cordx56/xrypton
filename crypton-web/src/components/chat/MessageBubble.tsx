import Avatar from "@/components/common/Avatar";
import type { Message } from "@/types/chat";

type Props = {
  message: Message;
  isOwn: boolean;
  displayName: string;
  iconUrl: string | null;
};

const MessageBubble = ({ message, isOwn, displayName, iconUrl }: Props) => {
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex gap-2 mb-3">
      <Avatar name={displayName} iconUrl={iconUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="font-medium text-sm truncate">{displayName}</span>
          <span className="text-xs text-muted truncate shrink-0">
            {message.sender_id}
          </span>
          <span className="text-xs text-muted/60 shrink-0">{time}</span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
