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
import { bytesToBase64 } from "@/utils/base64";
import { useDialogs } from "@/contexts/DialogContext";
import XVerificationDialog from "@/components/x/XVerificationDialog";
import {
  useSignatureVerifier,
  isSignedMessage,
} from "@/hooks/useSignatureVerifier";

/** プロフィール編集画面 */
const ProfileEditView = () => {
  const auth = useAuth();
  const router = useRouter();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const { pushDialog } = useDialogs();
  const { verifyExtract } = useSignatureVerifier();

  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | undefined>(undefined);
  const [iconSignature, setIconSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const signDetachedBase64 = async (payloadBase64: string): Promise<string> => {
    if (!auth.worker || !auth.privateKeys || !auth.subPassphrase) {
      throw new Error("signing context not available");
    }
    const worker = auth.worker;
    const privateKeys = auth.privateKeys;
    const subPassphrase = auth.subPassphrase;
    return new Promise<string>((resolve, reject) => {
      worker.eventWaiter("sign_detached", (result) => {
        if (result.success) {
          resolve(result.data.signature);
        } else {
          reject(new Error(result.message));
        }
      });
      worker.postMessage({
        call: "sign_detached",
        keys: privateKeys,
        passphrase: subPassphrase,
        payload: payloadBase64,
      });
    });
  };

  const signDetachedText = async (value: string): Promise<string> => {
    if (!value) return "";
    const payloadBase64 = bytesToBase64(new TextEncoder().encode(value));
    return signDetachedBase64(payloadBase64);
  };

  useEffect(() => {
    const userId = auth.userId;
    if (!userId) return;
    (async () => {
      try {
        const profile = await apiClient().user.getProfile(userId);
        const resolveLegacyField = async (value: string): Promise<string> => {
          if (!value || !isSignedMessage(value) || !auth.publicKeys)
            return value;
          const plaintext = await verifyExtract(auth.publicKeys, value);
          return plaintext ?? value;
        };
        const [dn, st, bi] = await Promise.all([
          resolveLegacyField(profile.display_name ?? ""),
          resolveLegacyField(profile.status ?? ""),
          resolveLegacyField(profile.bio ?? ""),
        ]);
        setDisplayName(dn);
        setStatus(st);
        setBio(bi);
        setIconSignature(profile.icon_signature || null);
        const resolvedIconUrl = profile.icon_url
          ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
          : undefined;
        setIconUrl(resolvedIconUrl);
      } catch {
        showError(t("error.unknown"));
      }
    })();
  }, [auth.publicKeys, auth.userId, showError, t, verifyExtract]);

  const handleSave = async () => {
    if (!auth.userId) return;
    const signed = await auth.getSignedMessage();
    if (!signed) return;

    setSaving(true);
    try {
      const [displayNameSignature, statusSignature, bioSignature] =
        await Promise.all([
          signDetachedText(displayName),
          signDetachedText(status),
          signDetachedText(bio),
        ]);

      const client = authApiClient(signed.signedMessage);
      await client.user.updateProfile(auth.userId, {
        display_name: displayName,
        display_name_signature: displayNameSignature,
        status,
        status_signature: statusSignature,
        bio,
        bio_signature: bioSignature,
      });
      await setCachedProfile(auth.userId, {
        userId: auth.userId,
        displayName: displayName || undefined,
        displayNameSignature: displayNameSignature || null,
        iconUrl: iconUrl ?? null,
        iconSignature: iconSignature ?? null,
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
    if (!file || !auth.userId || !auth.worker) return;

    const previewUrl = URL.createObjectURL(file);
    setIconUrl(previewUrl);
    setIconSignature(null);

    const signed = await auth.getSignedMessage();
    if (!signed) return;
    try {
      const arrayBuf = await file.arrayBuffer();
      const imageBase64 = bytesToBase64(new Uint8Array(arrayBuf));
      const signature = await signDetachedBase64(imageBase64);
      const client = authApiClient(signed.signedMessage);
      await client.user.uploadIcon(auth.userId, file, signature);
      // キャッシュバスター付きのサーバURLで保存し、ヘッダーに通知
      const serverIconUrl = `${getApiBaseUrl()}/v1/user/${encodeURIComponent(auth.userId)}/icon?t=${Date.now()}`;
      setIconUrl(serverIconUrl);
      setIconSignature(signature);
      await setCachedProfile(auth.userId, {
        userId: auth.userId,
        displayName: displayName || undefined,
        iconSignature: signature,
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
          <Avatar
            name={displayName || "?"}
            iconUrl={iconUrl ?? null}
            iconSignature={iconSignature}
            publicKey={auth.publicKeys}
            size="xl"
          />
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

        {/* 外部アカウント連携 */}
        <div>
          <label className="block text-sm text-muted mb-2">
            {t("profile.external_accounts")}
          </label>
          <button
            type="button"
            onClick={() => pushDialog((p) => <XVerificationDialog {...p} />)}
            className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm"
          >
            {t("x.link_account")}
          </button>
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
