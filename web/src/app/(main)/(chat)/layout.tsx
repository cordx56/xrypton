"use client";

import { useParams } from "next/navigation";
import { RealtimeProvider } from "@/contexts/RealtimeContext";
import ChatLayout from "@/components/chat/ChatLayout";

export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ chatId?: string; threadId?: string }>();
  return (
    <RealtimeProvider>
      <ChatLayout chatId={params.chatId} threadId={params.threadId} />
      {children}
    </RealtimeProvider>
  );
}
