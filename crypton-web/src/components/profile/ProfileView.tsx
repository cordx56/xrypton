"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { ApiError, apiClient, authApiClient, getApiBaseUrl } from "@/api/client";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAddressCard } from "@fortawesome/free-regular-svg-icons";
import Avatar from "@/components/common/Avatar";
import Dialog from "@/components/common/Dialog";
import Code from "@/components/Code";
import QrDisplay from "@/components/QrDisplay";

const ProfileView = () => {
  const auth = useAuth();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // プロフィール読み込み
  useEffect(() => {
    if (!auth.userId) return;
    (async () => {
      try {
        const profile = await apiClient().user.getProfile(auth.userId!);
        setDisplayName(profile.display_name ?? "");
        setStatus(profile.status ?? "");
        setBio(profile.bio ?? "");
        if (profile.icon_url) {
          setIconUrl(`${getApiBaseUrl()}${profile.icon_url}`);
        }
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

    // プレビュー表示
    const previewUrl = URL.createObjectURL(file);
    setIconUrl(previewUrl);

    // アップロード
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    try {
      const client = authApiClient(signed.signedMessage);
      await client.user.uploadIcon(auth.userId, file);
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) {
        showError(t("error.icon_too_large"));
      } else {
        showError(t("error.profile_save_failed"));
      }
    }
  };

  const showPublicKeys = () => {
    if (!auth.publicKeys) return;
    pushDialog((p) => (
      <Dialog {...p} title={t("profile.public_keys")}>
        <QrDisplay data={auth.publicKeys!} />
        <Code code={auth.publicKeys!} />
      </Dialog>
    ));
  };

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h2 className="text-lg font-semibold">
        <FontAwesomeIcon icon={faAddressCard} className="mr-2" />
        {t("tab.profile")}
      </h2>
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
        <h2 className="mt-3 text-lg font-semibold">
          {displayName || "No Name"}
        </h2>
        {auth.userId && (
          <p className="text-xs text-muted/50 select-all">{auth.userId}</p>
        )}
        {status && <p className="text-sm text-muted">{status}</p>}
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

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-50"
        >
          {saving ? "..." : t("profile.save")}
        </button>

        <button
          type="button"
          onClick={showPublicKeys}
          disabled={!auth.publicKeys}
          className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 disabled:opacity-50"
        >
          {t("profile.public_keys")}
        </button>
      </div>
    </div>
  );
};

export default ProfileView;
