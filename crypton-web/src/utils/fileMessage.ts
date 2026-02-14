import type { FileMetadata } from "@/types/chat";

export const FILE_MESSAGE_PREFIX = "FILE:";

/** メッセージ内容がファイルメッセージかどうかを判定する */
export const isFileMessage = (content: string): boolean =>
  content.startsWith(FILE_MESSAGE_PREFIX);

/** ファイルメッセージからメタデータをパースする */
export const parseFileMetadata = (content: string): FileMetadata | null => {
  if (!isFileMessage(content)) return null;
  try {
    return JSON.parse(content.slice(FILE_MESSAGE_PREFIX.length));
  } catch {
    return null;
  }
};

/** メタデータからファイルメッセージ文字列を構築する */
export const buildFileMessageContent = (meta: FileMetadata): string =>
  `${FILE_MESSAGE_PREFIX}${JSON.stringify(meta)}`;

/** MIMEタイプが画像かどうかを判定する */
export const isImageType = (mimeType: string): boolean =>
  mimeType.startsWith("image/");
