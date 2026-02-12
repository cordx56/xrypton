import { useState, KeyboardEvent } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane } from "@fortawesome/free-regular-svg-icons";

type Props = {
  onSend: (text: string) => void;
  disabled?: boolean;
};

const ChatInput = ({ onSend, disabled }: Props) => {
  const [text, setText] = useState("");
  const { t } = useI18n();

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t border-accent/30 bg-bg">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("chat.placeholder")}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-accent/30 px-3 py-2 text-sm bg-transparent focus:outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="px-4 py-2 rounded-lg bg-accent/30 hover:bg-accent/50 text-sm font-medium disabled:opacity-50"
      >
        <FontAwesomeIcon icon={faPaperPlane} />
      </button>
    </div>
  );
};

export default ChatInput;
