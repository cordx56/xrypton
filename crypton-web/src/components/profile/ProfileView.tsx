"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import {
  ApiError,
  apiClient,
  authApiClient,
  getApiBaseUrl,
} from "@/api/client";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import Avatar from "@/components/common/Avatar";
import { setCachedProfile } from "@/utils/accountStore";

/** プロフィール編集画面 */
const ProfileEditView = () => {
  const auth = useAuth();
  const router = useRouter();
  const { t } = useI18n();
  const { showError } = useErrorToast();

  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!auth.userId) return;
    (async () => {
      try {
        const profile = await apiClient().user.getProfile(auth.userId!);
        setDisplayName(profile.display_name ?? "");
        setStatus(profile.status ?? "");
        setBio(profile.bio ?? "");
        const resolvedIconUrl = profile.icon_url
          ? `${getApiBaseUrl()}${profile.icon_url}`
          : undefined;
        if (resolvedIconUrl) setIconUrl(resolvedIconUrl);
      } catch {
        showError(t("error.unknown"));
      }
    })();
  }, [auth.userId]);

  const handleSave = async () => {
    if (!auth.userId) return;
    const signed = await auth.getSignedMessage();
    if (!signed) return;

    setSaving(true);
    try {
      const client = authApiClient(signed.signedMessage);
      await client.user.updateProfile(auth.userId, {
        display_name: displayName,
        status,
        bio,
      });
      await setCachedProfile(auth.userId, {
        userId: auth.userId,
        displayName: displayName || undefined,
        iconUrl: iconUrl ?? null,
      });
      window.dispatchEvent(new Event("profile-updated"));
      router.push("/profile");
    } catch {
      showError(t("error.profile_save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleIconClick = () => {
    fileInputRef.current?.click();
  };

  const handleIconChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.userId) return;

    const previewUrl = URL.createObjectURL(file);
    setIconUrl(previewUrl);

    const signed = await auth.getSignedMessage();
    if (!signed) return;
    try {
      const client = authApiClient(signed.signedMessage);
      await client.user.uploadIcon(auth.userId, file);
      // キャッシュバスター付きのサーバURLで保存し、ヘッダーに通知
      const serverIconUrl = `${getApiBaseUrl()}/v1/user/${encodeURIComponent(auth.userId)}/icon?t=${Date.now()}`;
      setIconUrl(serverIconUrl);
      await setCachedProfile(auth.userId, {
        userId: auth.userId,
        displayName: displayName || undefined,
        iconUrl: serverIconUrl,
      });
      window.dispatchEvent(new Event("profile-updated"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) {
        showError(t("error.icon_too_large"));
      } else {
        showError(t("error.profile_save_failed"));
      }
    }
  };

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h2 className="text-lg font-semibold">{t("profile.edit")}</h2>

      <div className="flex flex-col items-center mb-6">
        <button
          type="button"
          onClick={handleIconClick}
          className="cursor-pointer"
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt="avatar"
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <Avatar name={displayName || "?"} size="lg" />
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleIconChange}
          className="hidden"
        />
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-muted mb-1">
            {t("profile.display_name")}
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">
            {t("profile.status")}
          </label>
          <input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">
            {t("profile.bio")}
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent resize-none"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-50"
          >
            {saving ? "..." : t("profile.save")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/profile")}
            className="flex-1 py-2 rounded border border-accent/30 hover:bg-accent/10"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProfileEditView;
