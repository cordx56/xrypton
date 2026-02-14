"use client";

import { use } from "react";
import UserProfileView from "@/components/contacts/UserProfileView";

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);
  return <UserProfileView userId={decodeURIComponent(userId)} />;
}
