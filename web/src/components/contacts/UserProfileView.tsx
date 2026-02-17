"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import {
  ApiError,
  apiClient,
  authApiClient,
  getApiBaseUrl,
} from "@/api/client";
import { displayUserId } from "@/utils/schema";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faAt,
  faCheck,
  faPen,
  faPlus,
  faKey,
  faRepeat,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Spinner from "@/components/common/Spinner";
import Dialog from "@/components/common/Dialog";
import Code from "@/components/Code";
import QrDisplay from "@/components/QrDisplay";
import AccountList from "@/components/layout/AccountList";
import { setCachedProfile } from "@/utils/accountStore";
import { linkify } from "@/utils/linkify";
import {
  useSignatureVerifier,
  isSignedMessage,
} from "@/hooks/useSignatureVerifier";
import { usePublicKeyResolver } from "@/hooks/usePublicKeyResolver";

type Props = {
  userId: string;
};

type ExternalAccount = {
  type: "atproto";
  validated: boolean;
  did: string;
  handle: string | null;
};

type VerificationState = "pending" | "verified" | "unverified";

const UserProfileView = ({ userId }: Props) => {
  const auth = useAuth();
  const router = useRouter();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const { verifyExtract, showWarning } = useSignatureVerifier();
  const { withKeyRetry } = usePublicKeyResolver();
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAccounts, setShowAccounts] = useState(false);
  const [externalAccounts, setExternalAccounts] = useState<ExternalAccount[]>(
    [],
  );
  const [isContact, setIsContact] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [verificationState, setVerificationState] =
    useState<VerificationState>("pending");

  const isOwnProfile = auth.userId === userId;

  // 署名済みフィールドから平文を抽出し検証状態を判定する
  const verifyField = useCallback(
    async (
      publicKey: string,
      value: string,
    ): Promise<{ text: string; verified: boolean }> => {
      if (!value) return { text: "", verified: true };
      if (!isSignedMessage(value)) {
        // 未署名データ（レガシー）
        return { text: value, verified: false };
      }
      const plaintext = await verifyExtract(publicKey, value);
      if (plaintext !== null) {
        return { text: plaintext, verified: true };
      }
      // 検証失敗 — armored データをそのまま表示はしない
      return { text: value, verified: false };
    },
    [verifyExtract],
  );

  // 全フィールドを検証し、1つでも失敗なら throw
  const verifyAllFields = useCallback(
    async (
      signingKey: string,
      rawDn: string,
      rawSt: string,
      rawBi: string,
    ): Promise<{
      dnResult: { text: string; verified: boolean };
      stResult: { text: string; verified: boolean };
      biResult: { text: string; verified: boolean };
    }> => {
      const [dnResult, stResult, biResult] = await Promise.all([
        verifyField(signingKey, rawDn),
        verifyField(signingKey, rawSt),
        verifyField(signingKey, rawBi),
      ]);
      const allVerified =
        dnResult.verified && stResult.verified && biResult.verified;
      if (!allVerified) {
        throw new Error("verification failed");
      }
      return { dnResult, stResult, biResult };
    },
    [verifyField],
  );

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await apiClient().user.getProfile(userId);
      const rawDn = profile.display_name ?? "";
      const rawSt = profile.status ?? "";
      const rawBi = profile.bio ?? "";
      setExternalAccounts(profile.external_accounts ?? []);

      // 署名済みフィールドがあるか判定
      const hasSigned =
        isSignedMessage(rawDn) ||
        isSignedMessage(rawSt) ||
        isSignedMessage(rawBi);

      if (!hasSigned) {
        // 未署名データ（レガシー）
        setDisplayName(rawDn);
        setStatus(rawSt);
        setBio(rawBi);
        setVerificationState("pending");
      } else if (isOwnProfile) {
        // 自分のプロフィール: auth.publicKeys で検証
        const signingKey = auth.publicKeys ?? null;
        if (signingKey) {
          const [dnResult, stResult, biResult] = await Promise.all([
            verifyField(signingKey, rawDn),
            verifyField(signingKey, rawSt),
            verifyField(signingKey, rawBi),
          ]);
          setDisplayName(dnResult.text);
          setStatus(stResult.text);
          setBio(biResult.text);
          const allVerified =
            dnResult.verified && stResult.verified && biResult.verified;
          setVerificationState(allVerified ? "verified" : "unverified");
          if (!allVerified) showWarning();
        } else {
          setDisplayName(rawDn);
          setStatus(rawSt);
          setBio(rawBi);
          setVerificationState("unverified");
          showWarning();
        }
      } else {
        // 他ユーザ: withKeyRetry で IDB キャッシュ + リトライ
        const result = await withKeyRetry(
          userId,
          (signingKey) => verifyAllFields(signingKey, rawDn, rawSt, rawBi),
          () => {
            showWarning();
          },
        );
        if (result) {
          setDisplayName(result.dnResult.text);
          setStatus(result.stResult.text);
          setBio(result.biResult.text);
          setVerificationState("verified");
        } else {
          // リトライ失敗 or 鍵取得失敗
          setDisplayName(rawDn);
          setStatus(rawSt);
          setBio(rawBi);
          setVerificationState("unverified");
        }
      }

      const resolvedIconUrl = profile.icon_url
        ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
        : null;
      setIconUrl(resolvedIconUrl);
      // 自分のプロフィールの場合、アカウントセレクタ表示用にキャッシュ（平文を保存）
      if (isOwnProfile) {
        let resolvedDn = rawDn;
        if (hasSigned && auth.publicKeys) {
          const dnParsed = await verifyField(auth.publicKeys, rawDn);
          resolvedDn = dnParsed.text;
        }
        await setCachedProfile(userId, {
          userId,
          displayName: resolvedDn || undefined,
          iconUrl: resolvedIconUrl,
        });
      }
    } catch {
      showError(t("error.unknown"));
    } finally {
      setLoading(false);
    }
  }, [
    userId,
    isOwnProfile,
    showError,
    t,
    auth.publicKeys,
    verifyField,
    verifyAllFields,
    showWarning,
    withKeyRetry,
  ]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // プロフィール編集画面からの更新通知を受け取って再取得
  useEffect(() => {
    if (!isOwnProfile) return;
    window.addEventListener("profile-updated", fetchProfile);
    return () => window.removeEventListener("profile-updated", fetchProfile);
  }, [isOwnProfile, fetchProfile]);

  // 他ユーザの場合、連絡先に追加済みか確認
  useEffect(() => {
    if (isOwnProfile) return;
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const contacts: { contact_user_id: string }[] = await authApiClient(
        signed.signedMessage,
      ).contacts.list();
      setIsContact(contacts.some((c) => c.contact_user_id === userId));
    })();
  }, [userId, isOwnProfile]);

  const handleAddContact = async () => {
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    setAddingContact(true);
    try {
      await authApiClient(signed.signedMessage).contacts.add(userId);
      setIsContact(true);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) setIsContact(true);
        else showError(t("error.unknown"));
      } else {
        showError(t("error.network"));
      }
    } finally {
      setAddingContact(false);
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
            onClick={() => router.back()}
            className="p-2 hover:bg-accent/10 rounded"
          >
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <h2 className="text-lg font-semibold flex-1">{t("tab.profile")}</h2>
          {isContact ? (
            <span className="p-2 text-accent">
              <FontAwesomeIcon icon={faCheck} />
            </span>
          ) : (
            <button
              type="button"
              onClick={handleAddContact}
              disabled={addingContact}
              className="p-2 hover:bg-accent/10 rounded disabled:opacity-50"
              title={t("contacts.add")}
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
          )}
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
        <h2 className="mt-3 text-lg font-semibold">
          {displayName || displayUserId(userId)}
        </h2>
        <p className="text-xs text-muted/50 select-all">
          {displayUserId(userId)}
        </p>
        {status && <p className="text-sm text-muted mt-1">{status}</p>}

        {/* 署名検証バッジ */}
        {verificationState !== "pending" && (
          <span
            className={`mt-2 inline-flex items-center gap-1 text-xs ${
              verificationState === "verified"
                ? "text-green-500"
                : "text-red-500"
            }`}
            title={
              verificationState === "verified"
                ? t("profile.verified")
                : t("profile.unverified")
            }
          >
            <FontAwesomeIcon icon={faShieldHalved} />
            {verificationState === "verified"
              ? t("profile.verified")
              : t("profile.unverified")}
          </span>
        )}
      </div>

      {externalAccounts.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {externalAccounts.map((account) => (
            <span
              key={account.did}
              className={`inline-flex items-center gap-1.5 text-sm ${
                account.validated ? "text-muted" : "text-red-500"
              }`}
              title={account.did}
            >
              <FontAwesomeIcon icon={faAt} />
              {account.handle ?? account.did}
            </span>
          ))}
        </div>
      )}

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
