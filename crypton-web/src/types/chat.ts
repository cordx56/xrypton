export type ChatGroup = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
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
  created_by: string;
  created_at: string;
  archived_at?: string | null;
};

export type Message = {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};
