"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { apiClient, getApiBaseUrl } from "@/api/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faPen,
  faKey,
  faRepeat,
} from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Spinner from "@/components/common/Spinner";
import Dialog from "@/components/common/Dialog";
import Code from "@/components/Code";
import QrDisplay from "@/components/QrDisplay";
import AccountList from "@/components/layout/AccountList";
import { setCachedProfile } from "@/utils/accountStore";
import { linkify } from "@/utils/linkify";

type Props = {
  userId: string;
};

const UserProfileView = ({ userId }: Props) => {
  const auth = useAuth();
  const router = useRouter();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAccounts, setShowAccounts] = useState(false);

  const isOwnProfile = auth.userId === userId;

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await apiClient().user.getProfile(userId);
      setDisplayName(profile.display_name ?? "");
      setStatus(profile.status ?? "");
      setBio(profile.bio ?? "");
      // キャッシュバスター付きでアイコンURLを生成
      const resolvedIconUrl = profile.icon_url
        ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
        : null;
      setIconUrl(resolvedIconUrl);
      // 自分のプロフィールの場合、アカウントセレクタ表示用にキャッシュ
      if (isOwnProfile) {
        await setCachedProfile(userId, {
          userId,
          displayName: profile.display_name || undefined,
          iconUrl: resolvedIconUrl,
        });
      }
    } catch {
      showError(t("error.unknown"));
    } finally {
      setLoading(false);
    }
  }, [userId, isOwnProfile, showError, t]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // プロフィール編集画面からの更新通知を受け取って再取得
  useEffect(() => {
    if (!isOwnProfile) return;
    window.addEventListener("profile-updated", fetchProfile);
    return () => window.removeEventListener("profile-updated", fetchProfile);
  }, [isOwnProfile, fetchProfile]);

  const showPublicKeys = () => {
    if (!auth.publicKeys) return;
    pushDialog((p) => (
      <Dialog {...p} title={t("profile.public_keys")}>
        <QrDisplay data={auth.publicKeys!} />
        <Code code={auth.publicKeys!} />
      </Dialog>
    ));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      {/* 他者プロフィールの場合のみ戻るボタンを表示 */}
      {!isOwnProfile && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/contact")}
            className="p-2 hover:bg-accent/10 rounded"
          >
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <h2 className="text-lg font-semibold">{t("tab.profile")}</h2>
        </div>
      )}

      <div className="flex flex-col items-center">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt="avatar"
            className="w-20 h-20 rounded-full object-cover"
          />
        ) : (
          <Avatar name={displayName || userId} size="lg" />
        )}
        <h2 className="mt-3 text-lg font-semibold">{displayName || userId}</h2>
        <p className="text-xs text-muted/50 select-all">{userId}</p>
        {status && <p className="text-sm text-muted mt-1">{status}</p>}
      </div>

      {bio && (
        <div>
          <label className="block text-sm text-muted mb-1">
            {t("profile.bio")}
          </label>
          <p className="text-sm whitespace-pre-wrap">{linkify(bio)}</p>
        </div>
      )}

      {/* 自分のプロフィールの場合のみアクションボタンを表示 */}
      {isOwnProfile && (
        <>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => router.push("/profile/edit")}
              className="w-full py-2 rounded bg-accent/20 hover:bg-accent/30 text-sm flex items-center justify-center gap-2"
            >
              <FontAwesomeIcon icon={faPen} />
              {t("profile.edit")}
            </button>

            <button
              type="button"
              onClick={showPublicKeys}
              disabled={!auth.publicKeys}
              className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <FontAwesomeIcon icon={faKey} />
              {t("profile.public_keys")}
            </button>

            {auth.accountIds.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAccounts((prev) => !prev)}
                className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm flex items-center justify-center gap-2"
              >
                <FontAwesomeIcon icon={faRepeat} />
                {t("account.switch")}
              </button>
            )}
          </div>

          {showAccounts && (
            <AccountList
              accountIds={auth.accountIds}
              activeId={auth.userId}
              showAdd
            />
          )}
        </>
      )}
    </div>
  );
};

export default UserProfileView;
