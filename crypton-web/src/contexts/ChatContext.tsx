"use client";

import {
  createContext,
  useContext,
  useState,
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
});

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);

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
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => useContext(ChatContext);
