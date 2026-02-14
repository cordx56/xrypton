import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/common/Avatar";
import type { Message } from "@/types/chat";
import { useI18n } from "@/contexts/I18nContext";
import { linkify } from "@/utils/linkify";
import { formatTime } from "@/utils/date";
import { isImageType } from "@/utils/fileMessage";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile } from "@fortawesome/free-regular-svg-icons";
import { faDownload, faXmark } from "@fortawesome/free-solid-svg-icons";

type Props = {
  message: Message;
  isOwn: boolean;
  displayName: string;
  iconUrl: string | null;
  onClickUser?: () => void;
  onDownloadFile?: (message: Message) => void;
};

/** 画像拡大表示のライトボックス */
const ImageLightbox = ({
  src,
  alt,
  onClose,
  onDownload,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  onDownload: () => void;
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload();
          }}
          className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white"
          title="Download"
        >
          <FontAwesomeIcon icon={faDownload} className="text-lg" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white"
        >
          <FontAwesomeIcon icon={faXmark} className="text-lg" />
        </button>
      </div>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
};

/** ファイルメッセージの表示コンポーネント */
const FileContent = ({
  message,
  onDownloadFile,
}: {
  message: Message;
  onDownloadFile?: (message: Message) => void;
}) => {
  const meta = message.fileMetadata;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const handleClose = useCallback(() => setLightboxOpen(false), []);
  const handleDownload = useCallback(
    () => onDownloadFile?.(message),
    [onDownloadFile, message],
  );

  if (!meta) return null;

  // 画像ファイルの場合
  if (isImageType(meta.type)) {
    if (message.fileBlobUrl) {
      return (
        <>
          <img
            src={message.fileBlobUrl}
            alt={meta.name}
            className="max-w-96 max-h-96 rounded cursor-pointer"
            onClick={() => setLightboxOpen(true)}
          />
          {lightboxOpen && (
            <ImageLightbox
              src={message.fileBlobUrl}
              alt={meta.name}
              onClose={handleClose}
              onDownload={handleDownload}
            />
          )}
        </>
      );
    }
    // 画像読み込み中
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
        {meta.name}
      </div>
    );
  }

  // その他のファイル
  return (
    <button
      type="button"
      onClick={() => onDownloadFile?.(message)}
      className="flex items-center gap-2 px-3 py-2 rounded bg-accent/10 hover:bg-accent/20 text-sm"
    >
      <FontAwesomeIcon icon={faFile} className="text-lg" />
      <span className="truncate max-w-64">{meta.name}</span>
    </button>
  );
};

const MessageBubble = ({
  message,
  isOwn,
  displayName,
  iconUrl,
  onClickUser,
  onDownloadFile,
}: Props) => {
  const { t } = useI18n();
  const time = formatTime(message.created_at);

  return (
    <div
      className={`flex items-start gap-2 mb-3 rounded px-2 py-1 -mx-2 ${message.decryptFailed ? "bg-[var(--color-theme-dark-red)]/10" : ""}`}
    >
      <button
        type="button"
        onClick={onClickUser}
        className="cursor-pointer shrink-0"
      >
        <Avatar name={displayName} iconUrl={iconUrl} size="sm" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 mb-0.5">
          <button
            type="button"
            onClick={onClickUser}
            className="font-medium text-base truncate cursor-pointer hover:underline"
          >
            {displayName}
          </button>
          <span className="text-sm text-muted/60 shrink-0">{time}</span>
        </div>
        {message.decryptFailed ? (
          <span className="text-sm text-[var(--color-theme-dark-red)]">
            {t("chat.decrypt_failed")}
          </span>
        ) : message.fileMetadata ? (
          <FileContent message={message} onDownloadFile={onDownloadFile} />
        ) : (
          <div className="text-base whitespace-pre-wrap break-words">
            {message.encrypted ? (
              <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
            ) : (
              linkify(message.content)
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble;
