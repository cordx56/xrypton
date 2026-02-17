"use client";

import { useAuth } from "@/contexts/AuthContext";
import UserProfileView from "@/components/contacts/UserProfileView";

export default function ProfilePage() {
  const auth = useAuth();
  if (!auth.userId) return null;
  return <UserProfileView userId={auth.userId} />;
}
