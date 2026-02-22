"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import type { ChatGroup, Thread, Message } from "@/types/chat";

type ChatContextType = {
  groups: ChatGroup[];
  setGroups: (groups: ChatGroup[]) => void;
  threads: Thread[];
  setThreads: (threads: Thread[]) => void;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  /** メッセージ総数（ページネーション用） */
  totalMessages: number;
  setTotalMessages: (n: number) => void;
  /** 未読チャンネルID */
  unreadGroupIds: Set<string>;
  /** 未読スレッドID */
  unreadThreadIds: Set<string>;
  /** チャンネル・スレッドを未読にする */
  markUnread: (groupId: string, threadId?: string) => void;
  /** チャンネルの未読を解除する */
  markGroupRead: (groupId: string) => void;
  /** スレッドの未読を解除する */
  markThreadRead: (threadId: string) => void;
  /** チャンネル一覧読み込み中 */
  loadingGroups: boolean;
  setLoadingGroups: (v: boolean) => void;
  /** スレッド一覧読み込み中 */
  loadingThreads: boolean;
  setLoadingThreads: (v: boolean) => void;
};

const ChatContext = createContext<ChatContextType>({
  groups: [],
  setGroups: () => {},
  threads: [],
  setThreads: () => {},
  messages: [],
  setMessages: () => {},
  totalMessages: 0,
  setTotalMessages: () => {},
  unreadGroupIds: new Set(),
  unreadThreadIds: new Set(),
  markUnread: () => {},
  markGroupRead: () => {},
  markThreadRead: () => {},
  loadingGroups: false,
  setLoadingGroups: () => {},
  loadingThreads: false,
  setLoadingThreads: () => {},
});

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [unreadGroupIds, setUnreadGroupIds] = useState<Set<string>>(new Set());
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(false);

  const markUnread = useCallback((groupId: string, threadId?: string) => {
    setUnreadGroupIds((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
    if (threadId) {
      setUnreadThreadIds((prev) => {
        if (prev.has(threadId)) return prev;
        const next = new Set(prev);
        next.add(threadId);
        return next;
      });
    }
  }, []);

  const markGroupRead = useCallback((groupId: string) => {
    setUnreadGroupIds((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }, []);

  const markThreadRead = useCallback((threadId: string) => {
    setUnreadThreadIds((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        groups,
        setGroups,
        threads,
        setThreads,
        messages,
        setMessages,
        totalMessages,
        setTotalMessages,
        unreadGroupIds,
        unreadThreadIds,
        markUnread,
        markGroupRead,
        markThreadRead,
        loadingGroups,
        setLoadingGroups,
        loadingThreads,
        setLoadingThreads,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);
