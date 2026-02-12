"use client";

import { useParams } from "next/navigation";
import ChatLayout from "@/components/chat/ChatLayout";

export default function ChatRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ chatId?: string; threadId?: string }>();
  return (
    <>
      <ChatLayout chatId={params.chatId} threadId={params.threadId} />
      {children}
    </>
  );
}
