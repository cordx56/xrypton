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
  const { extractAndVerify, showWarning } = useSignatureVerifier();
  const { withKeyRetry, resolveKeys } = usePublicKeyResolver();
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
  const [signingPublicKey, setSigningPublicKey] = useState<string | undefined>(
    undefined,
  );

  const isLoggedIn = !!auth.userId && auth.isRegistered;
  const isOwnProfile = auth.userId === userId;

  // 署名済みフィールドから平文を抽出し検証状態を判定する。
  // 検証失敗でも平文が取れれば返す。
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
      const result = await extractAndVerify(publicKey, value);
      if (result) {
        return result;
      }
      // パース自体の失敗
      return { text: value, verified: false };
    },
    [extractAndVerify],
  );

  type FieldResults = {
    dnResult: { text: string; verified: boolean };
    stResult: { text: string; verified: boolean };
    biResult: { text: string; verified: boolean };
  };

  // 全フィールドを検証する。全て検証成功なら結果を返し、
  // 1つでも失敗なら結果を添えて throw する（withKeyRetry のリトライ用）。
  const verifyAllFields = useCallback(
    async (
      signingKey: string,
      rawDn: string,
      rawSt: string,
      rawBi: string,
    ): Promise<FieldResults> => {
      const [dnResult, stResult, biResult] = await Promise.all([
        verifyField(signingKey, rawDn),
        verifyField(signingKey, rawSt),
        verifyField(signingKey, rawBi),
      ]);
      const results = { dnResult, stResult, biResult };
      const allVerified =
        dnResult.verified && stResult.verified && biResult.verified;
      if (!allVerified) {
        const err = new Error("verification failed");
        (err as any).results = results;
        throw err;
      }
      return results;
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
        setSigningPublicKey(signingKey ?? undefined);
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
          if (!allVerified) showWarning(userId, dnResult.text);
        } else {
          setDisplayName(rawDn);
          setStatus(rawSt);
          setBio(rawBi);
          setVerificationState("unverified");
          showWarning(userId);
        }
      } else {
        // 他ユーザ: withKeyRetry で IDB キャッシュ + リトライ
        // リトライ失敗時にも抽出データを使うため、最後の結果を保持する
        let lastResults: FieldResults | null = null;
        const result = await withKeyRetry(
          userId,
          async (signingKey) => {
            setSigningPublicKey(signingKey);
            try {
              return await verifyAllFields(signingKey, rawDn, rawSt, rawBi);
            } catch (e) {
              if (e && typeof e === "object" && "results" in e) {
                lastResults = (e as any).results;
              }
              throw e;
            }
          },
          () => {
            showWarning(userId);
          },
        );
        const fields = result ?? lastResults;
        if (fields) {
          setDisplayName(fields.dnResult.text);
          setStatus(fields.stResult.text);
          setBio(fields.biResult.text);
          const allVerified =
            fields.dnResult.verified &&
            fields.stResult.verified &&
            fields.biResult.verified;
          setVerificationState(allVerified ? "verified" : "unverified");
        } else {
          // 鍵取得自体の失敗
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

  // 他ユーザの場合、連絡先に追加済みか確認（ログイン時のみ）
  useEffect(() => {
    if (isOwnProfile || !isLoggedIn) return;
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const contacts: { contact_user_id: string }[] = await authApiClient(
        signed.signedMessage,
      ).contacts.list();
      setIsContact(contacts.some((c) => c.contact_user_id === userId));
    })();
  }, [userId, isOwnProfile, isLoggedIn]);

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

  const showOtherUserPublicKeys = async () => {
    try {
      // ログイン状態に関わらず認証不要APIで取得
      const raw = await apiClient().user.getKeys(userId);
      const signingKey = raw?.signing_public_key;
      if (!signingKey) {
        showError(t("error.unknown"));
        return;
      }
      pushDialog((p) => (
        <Dialog {...p} title={t("profile.public_keys")}>
          <QrDisplay data={signingKey} />
          <Code code={signingKey} />
        </Dialog>
      ));
    } catch {
      showError(t("error.unknown"));
    }
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
          {isLoggedIn &&
            (isContact ? (
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
            ))}
        </div>
      )}

      <div className="flex flex-col items-center">
        <Avatar
          name={displayName || userId}
          iconUrl={iconUrl}
          publicKey={signingPublicKey}
          size="xl"
        />
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

      {/* 他ユーザの公開鍵表示 */}
      {!isOwnProfile && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={showOtherUserPublicKeys}
            className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm flex items-center justify-center gap-2"
          >
            <FontAwesomeIcon icon={faKey} />
            {t("profile.public_keys")}
          </button>
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
