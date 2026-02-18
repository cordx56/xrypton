import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperPlane } from "@fortawesome/free-regular-svg-icons";
import { faPlus } from "@fortawesome/free-solid-svg-icons";

type Props = {
  onSend: (text: string) => void | Promise<void>;
  onSendFile?: (file: File) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
};

const MAX_ROWS = 5;

const ChatInput = ({ onSend, onSendFile, disabled, placeholder }: Props) => {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const maxHeight = lineHeight * MAX_ROWS;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText("");
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) ta.style.height = "auto";
    });
    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onSendFile) return;
    // inputをリセットして同じファイルの再選択を許可
    e.target.value = "";
    setSending(true);
    try {
      await onSendFile(file);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t border-accent/30 bg-bg">
      {onSendFile && (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || sending}
            className="px-3 py-2 rounded-lg hover:bg-accent/20 text-base disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
        </>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          adjustHeight();
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t("chat.placeholder")}
        disabled={disabled || sending}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-accent/30 px-3 py-2 text-base leading-6 bg-transparent focus:outline-none focus:border-accent overflow-y-auto"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || sending || !text.trim()}
        className="px-4 py-2 rounded-lg bg-accent/30 hover:bg-accent/50 text-base font-medium disabled:opacity-50"
      >
        {sending ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <FontAwesomeIcon icon={faPaperPlane} />
        )}
      </button>
    </div>
  );
};

export default ChatInput;
