export type ChatGroup = {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type ChatMember = {
  chat_id: string;
  user_id: string;
  joined_at: string;
};

export type Thread = {
  id: string;
  chat_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
};

export type FileMetadata = {
  name: string;
  type: string;
  size: number;
};

export type Message = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  content: string;
  file_id?: string | null;
  created_at: string;
  /** 未復号のメッセージに付与される */
  encrypted?: boolean;
  /** 復号に失敗したメッセージに付与される */
  decryptFailed?: boolean;
  /** 復号済みファイルメタデータ */
  fileMetadata?: FileMetadata;
  /** 画像のインライン表示用blob URL */
  fileBlobUrl?: string;
};
