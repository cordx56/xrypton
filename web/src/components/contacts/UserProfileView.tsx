"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import {
  ApiError,
  WotGraphResponse,
  apiClient,
  authApiClient,
  getApiBaseUrl,
} from "@/api/client";
import { displayUserId } from "@/utils/schema";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons";
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
import Avatar, {
  type VerifyState as AvatarVerifyState,
} from "@/components/common/Avatar";
import Spinner from "@/components/common/Spinner";
import Dialog from "@/components/common/Dialog";
import Code from "@/components/Code";
import QrDisplay from "@/components/QrDisplay";
import AccountList from "@/components/layout/AccountList";
import { setCachedProfile } from "@/utils/accountStore";
import { linkify } from "@/utils/linkify";
import { verifyPubkeyPostOnPds } from "@/utils/atprotoVerify";
import { verifyXPost } from "@/utils/xVerify";
import type { ExternalAccount } from "@/types/atproto";
import { bytesToBase64, toBase64Url } from "@/utils/base64";
import { canonicalize } from "@/utils/canonicalize";
import {
  useSignatureVerifier,
  isSignedMessage,
} from "@/hooks/useSignatureVerifier";
import { usePublicKeyResolver } from "@/hooks/usePublicKeyResolver";
import { useResolvedProfiles } from "@/hooks/useResolvedProfiles";
import WotGraphDialog from "@/components/contacts/WotGraphDialog";

type Props = {
  userId: string;
};

type VerificationState = "pending" | "verified" | "unverified";
type ExternalVerificationState = "pending" | "verified" | "unverified";
type WotQrPayload = {
  v: number;
  type: "xrypton-wot";
  fingerprint: string;
  key_server: string;
  nonce: {
    random: string;
    time: string;
  };
};

function getOwnKeyServerBaseUrl(): string {
  if (typeof window === "undefined") return getApiBaseUrl();
  const url = new URL(getApiBaseUrl(), window.location.origin);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

// プロフィールAPIレスポンスのセッション中キャッシュ
type ProfileResponse = {
  display_name?: string;
  display_name_signature?: string;
  status?: string;
  status_signature?: string;
  bio?: string;
  bio_signature?: string;
  icon_url?: string | null;
  icon_signature?: string;
  external_accounts?: ExternalAccount[];
};
const profileCache = new Map<string, ProfileResponse>();

// プロフィール更新時にキャッシュをクリア（コンポーネント未マウントでも動作）
if (typeof window !== "undefined") {
  window.addEventListener("profile-updated", () => {
    profileCache.clear();
  });
}

const UserProfileView = ({ userId }: Props) => {
  const auth = useAuth();
  const router = useRouter();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const { verifyDetachedSignature, extractAndVerify, showWarning } =
    useSignatureVerifier();
  const { withKeyRetry, resolveKeys } = usePublicKeyResolver();
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconSignature, setIconSignature] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAccounts, setShowAccounts] = useState(false);
  const [externalAccounts, setExternalAccounts] = useState<ExternalAccount[]>(
    [],
  );
  /** 外部アカウントごとの検証結果（キー → 検証状態） */
  const [externalVerified, setExternalVerified] = useState<
    Map<string, ExternalVerificationState>
  >(new Map());
  const [isContact, setIsContact] = useState(false);
  const [contactUserIds, setContactUserIds] = useState<string[]>([]);
  const [addingContact, setAddingContact] = useState(false);
  const [textVerificationState, setTextVerificationState] =
    useState<VerificationState>("pending");
  const [iconVerifyState, setIconVerifyState] =
    useState<AvatarVerifyState>("loading");
  const [signingPublicKey, setSigningPublicKey] = useState<string | undefined>(
    undefined,
  );
  const [targetFingerprint, setTargetFingerprint] = useState<string | null>(
    null,
  );
  const [trustGraph, setTrustGraph] = useState<WotGraphResponse | null>(null);
  const [trustGraphTruncated, setTrustGraphTruncated] = useState(false);
  const isFetchingRef = useRef(false);

  const isLoggedIn = !!auth.userId && auth.isRegistered;
  const isOwnProfile = auth.userId === userId;
  const hasWorker = !!auth.worker;

  // 同一オリジンの戻り先がなければ戻るボタンを非表示にする
  const [canGoBack] = useState(() => {
    if (typeof window === "undefined") return false;
    // Navigation API で同一オリジンの履歴を確認（SPA 遷移に対応）
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = (window as any).navigation;
      if (nav?.currentEntry) {
        return nav.currentEntry.index > 0;
      }
    } catch {
      // Navigation API 非対応
    }
    // フォールバック: referrer が同一オリジンか確認
    try {
      return (
        !!document.referrer &&
        new URL(document.referrer).origin === window.location.origin
      );
    } catch {
      return false;
    }
  });

  // テキストフィールドとアイコンの検証状態を統合
  // アイコンがない場合はアイコン検証を無視する
  const iconFailed = !!iconUrl && iconVerifyState === "warning";
  const iconLoading = !!iconUrl && iconVerifyState === "loading";
  const verificationState: VerificationState =
    textVerificationState === "pending"
      ? "pending"
      : textVerificationState === "unverified" || iconFailed
        ? "unverified"
        : iconLoading
          ? "pending"
          : "verified";

  // detached signature を検証して検証状態を判定する。
  const verifyField = useCallback(
    async (
      publicKey: string,
      value: string,
      signature: string,
    ): Promise<{ text: string; verified: boolean }> => {
      if (!value) return { text: "", verified: true };
      if (!signature) {
        if (isSignedMessage(value)) {
          const legacy = await extractAndVerify(publicKey, value);
          if (legacy) return legacy;
        }
        // 未署名データ（レガシー）
        return { text: value, verified: false };
      }
      const verified = await verifyDetachedSignature(
        publicKey,
        signature,
        new TextEncoder().encode(value),
      );
      return { text: value, verified };
    },
    [extractAndVerify, verifyDetachedSignature],
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
      dnSig: string,
      rawSt: string,
      stSig: string,
      rawBi: string,
      biSig: string,
    ): Promise<FieldResults> => {
      const [dnResult, stResult, biResult] = await Promise.all([
        verifyField(signingKey, rawDn, dnSig),
        verifyField(signingKey, rawSt, stSig),
        verifyField(signingKey, rawBi, biSig),
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
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLoading(true);
    try {
      // プロフィールページを開いたタイミングでは常に最新を取得する
      const profile: ProfileResponse = await apiClient().user.getProfile(
        userId,
        { fresh: true },
      );
      profileCache.set(userId, profile);
      const rawDn = profile.display_name ?? "";
      const dnSig = profile.display_name_signature ?? "";
      const rawSt = profile.status ?? "";
      const stSig = profile.status_signature ?? "";
      const rawBi = profile.bio ?? "";
      const biSig = profile.bio_signature ?? "";
      const rawIconSig = profile.icon_signature ?? "";
      setExternalAccounts(profile.external_accounts ?? []);

      // detached signature または旧形式（signed message）があるか判定
      const hasSignedMaterial =
        !!(dnSig || stSig || biSig) ||
        isSignedMessage(rawDn) ||
        isSignedMessage(rawSt) ||
        isSignedMessage(rawBi);

      // 検証失敗時の警告ダイアログを閉じるまでローディングを維持するための Promise
      let warningPromise: Promise<void> | null = null;
      // アイコン検証で使うためローカルに追跡する
      let localSigningKey: string | undefined;
      let localDisplayName = "";

      if (!hasSignedMaterial) {
        // 未署名データ（レガシー）
        setDisplayName(rawDn);
        setStatus(rawSt);
        setBio(rawBi);
        setTextVerificationState(
          rawDn || rawSt || rawBi ? "unverified" : "pending",
        );
        localDisplayName = rawDn;
      } else if (isOwnProfile) {
        // 自分のプロフィール: auth.publicKeys で検証
        const signingKey = auth.publicKeys ?? null;
        setSigningPublicKey(signingKey ?? undefined);
        localSigningKey = signingKey ?? undefined;
        if (signingKey) {
          const [dnResult, stResult, biResult] = await Promise.all([
            verifyField(signingKey, rawDn, dnSig),
            verifyField(signingKey, rawSt, stSig),
            verifyField(signingKey, rawBi, biSig),
          ]);
          setDisplayName(dnResult.text);
          setStatus(stResult.text);
          setBio(biResult.text);
          localDisplayName = dnResult.text;
          const allVerified =
            dnResult.verified && stResult.verified && biResult.verified;
          setTextVerificationState(allVerified ? "verified" : "unverified");
          if (!allVerified) warningPromise = showWarning(userId, dnResult.text);
        } else {
          setDisplayName(rawDn);
          setStatus(rawSt);
          setBio(rawBi);
          localDisplayName = rawDn;
          setTextVerificationState("unverified");
          warningPromise = showWarning(userId);
        }
      } else if (isLoggedIn) {
        // ログイン済みの他ユーザ: withKeyRetry で IDB キャッシュ + リトライ
        // リトライ失敗時にも抽出データを使うため、最後の結果を保持する
        let lastResults: FieldResults | null = null;
        let needsWarning = false;
        const result = await withKeyRetry(
          userId,
          async (signingKey) => {
            setSigningPublicKey(signingKey);
            localSigningKey = signingKey;
            try {
              return await verifyAllFields(
                signingKey,
                rawDn,
                dnSig,
                rawSt,
                stSig,
                rawBi,
                biSig,
              );
            } catch (e) {
              if (e && typeof e === "object" && "results" in e) {
                lastResults = (e as any).results;
              }
              throw e;
            }
          },
          () => {
            needsWarning = true;
          },
        );
        const fields = result ?? lastResults;
        if (fields) {
          setDisplayName(fields.dnResult.text);
          setStatus(fields.stResult.text);
          setBio(fields.biResult.text);
          localDisplayName = fields.dnResult.text;
          const allVerified =
            fields.dnResult.verified &&
            fields.stResult.verified &&
            fields.biResult.verified;
          setTextVerificationState(allVerified ? "verified" : "unverified");
        } else {
          // 鍵取得自体の失敗
          setDisplayName(rawDn);
          setStatus(rawSt);
          setBio(rawBi);
          localDisplayName = rawDn;
          setTextVerificationState("unverified");
        }
        if (needsWarning) warningPromise = showWarning(userId);
      } else {
        // 未ログイン: 認証不要APIで公開鍵を取得し、署名内容を抽出
        try {
          const keysRaw = await apiClient().user.getKeys(userId, {
            fresh: true,
          });
          const signingKey = keysRaw?.signing_public_key;
          if (signingKey) {
            setSigningPublicKey(signingKey);
            localSigningKey = signingKey;
            const [dnResult, stResult, biResult] = await Promise.all([
              verifyField(signingKey, rawDn, dnSig),
              verifyField(signingKey, rawSt, stSig),
              verifyField(signingKey, rawBi, biSig),
            ]);
            setDisplayName(dnResult.text);
            setStatus(stResult.text);
            setBio(biResult.text);
            localDisplayName = dnResult.text;
            const allVerified =
              dnResult.verified && stResult.verified && biResult.verified;
            setTextVerificationState(allVerified ? "verified" : "unverified");
            if (!allVerified)
              warningPromise = showWarning(userId, dnResult.text);
          } else {
            setDisplayName(rawDn);
            setStatus(rawSt);
            setBio(rawBi);
            localDisplayName = rawDn;
            setTextVerificationState("unverified");
            warningPromise = showWarning(userId);
          }
        } catch {
          setDisplayName(rawDn);
          setStatus(rawSt);
          setBio(rawBi);
          localDisplayName = rawDn;
          setTextVerificationState("unverified");
          warningPromise = showWarning(userId);
        }
      }

      const resolvedIconUrl = profile.icon_url
        ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
        : null;
      setIconUrl(resolvedIconUrl);
      setIconSignature(rawIconSig || null);

      // アイコン detached signature 検証
      const worker = auth.worker;
      if (resolvedIconUrl && localSigningKey && worker && rawIconSig) {
        try {
          const resp = await fetch(resolvedIconUrl);
          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            const rawBytes = new Uint8Array(arrayBuf);
            const dataBase64 = bytesToBase64(rawBytes);

            const iconResult = await new Promise<{ success: boolean }>(
              (resolve) => {
                worker.eventWaiter("verify_detached_signature", (r) => {
                  resolve({ success: r.success });
                });
                worker.postMessage({
                  call: "verify_detached_signature",
                  publicKey: localSigningKey!,
                  signature: rawIconSig,
                  data: dataBase64,
                });
              },
            );

            if (!iconResult.success) {
              setIconVerifyState("warning");
              if (!warningPromise)
                warningPromise = showWarning(
                  userId,
                  localDisplayName || undefined,
                );
            } else {
              setIconVerifyState("verified");
            }
          } else {
            setIconVerifyState("warning");
            if (!warningPromise)
              warningPromise = showWarning(
                userId,
                localDisplayName || undefined,
              );
          }
        } catch {
          setIconVerifyState("warning");
          if (!warningPromise)
            warningPromise = showWarning(userId, localDisplayName || undefined);
        }
      } else if (resolvedIconUrl) {
        // 鍵またはWorkerなし: アイコン検証不可
        setIconVerifyState("warning");
        if (!warningPromise)
          warningPromise = showWarning(userId, localDisplayName || undefined);
      }

      // 自分のプロフィールの場合、アカウントセレクタ表示用にキャッシュ（平文を保存）
      if (isOwnProfile) {
        let resolvedDn = rawDn;
        if (auth.publicKeys) {
          const dnParsed = await verifyField(auth.publicKeys, rawDn, dnSig);
          resolvedDn = dnParsed.text;
        }
        await setCachedProfile(userId, {
          userId,
          displayName: resolvedDn || undefined,
          displayNameSignature: dnSig || null,
          iconUrl: resolvedIconUrl,
          iconSignature: rawIconSig || null,
        });
      }

      // 検証失敗の警告ダイアログが出ている場合、閉じるまでローディングを維持
      if (warningPromise) await warningPromise;
    } catch {
      showError(t("error.unknown"));
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [
    userId,
    isOwnProfile,
    isLoggedIn,
    showError,
    t,
    auth.publicKeys,
    verifyField,
    verifyAllFields,
    showWarning,
    withKeyRetry,
  ]);

  useEffect(() => {
    // auth 初期化と Worker の準備完了を待つ（PGP検証に必要）
    if (!auth.isInitialized || !hasWorker) return;
    // 自分のプロフィールで公開鍵の導出がまだなら待つ
    if (isOwnProfile && auth.privateKeys && !auth.publicKeys) return;
    fetchProfile();
  }, [
    fetchProfile,
    userId,
    auth.isInitialized,
    hasWorker,
    isOwnProfile,
    auth.privateKeys,
    auth.publicKeys,
  ]);

  // プロフィール編集画面からの更新通知を受け取って再取得
  useEffect(() => {
    if (!isOwnProfile) return;
    const handleUpdate = () => {
      profileCache.delete(userId);
      fetchProfile();
    };
    window.addEventListener("profile-updated", handleUpdate);
    return () => window.removeEventListener("profile-updated", handleUpdate);
  }, [isOwnProfile, fetchProfile, userId]);

  // 外部アカウントの公開鍵投稿を検証（ATProto + X）
  useEffect(() => {
    if (externalAccounts.length === 0) return;
    let cancelled = false;
    (async () => {
      const toKey = (account: ExternalAccount) =>
        account.type === "atproto" ? account.did : `x:${account.handle}`;

      const pending = new Map<string, ExternalVerificationState>(
        externalAccounts.map((account) => [toKey(account), "pending"]),
      );
      if (!cancelled) setExternalVerified(pending);

      if (!auth.worker) return;
      const results = new Map<string, ExternalVerificationState>();
      for (const account of externalAccounts) {
        if (account.type === "atproto") {
          if (account.pubkey_post_uri) {
            const valid = await verifyPubkeyPostOnPds(
              account.pubkey_post_uri,
              account.pds_url,
              userId,
              auth.worker!,
            );
            results.set(account.did, valid ? "verified" : "unverified");
          } else {
            results.set(account.did, "unverified");
          }
        } else if (account.type === "x") {
          const valid = await verifyXPost(
            account.post_url,
            userId,
            account.author_url,
            auth.worker!,
          );
          results.set(`x:${account.handle}`, valid ? "verified" : "unverified");
        }
      }
      if (!cancelled) setExternalVerified(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [externalAccounts, userId, auth.worker]);

  // 他ユーザの場合、連絡先に追加済みか確認（ログイン時のみ）
  useEffect(() => {
    if (isOwnProfile || !isLoggedIn) return;
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const contacts: { contact_user_id: string }[] = await authApiClient(
        signed.signedMessage,
      ).contacts.list();
      setContactUserIds(contacts.map((c) => c.contact_user_id));
      setIsContact(contacts.some((c) => c.contact_user_id === userId));
    })();
  }, [userId, isOwnProfile, isLoggedIn]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const signed = isLoggedIn ? await auth.getSignedMessage() : null;
        const keys = signed
          ? await authApiClient(signed.signedMessage).user.getKeys(userId, {
              fresh: true,
            })
          : await apiClient().user.getKeys(userId, { fresh: true });
        if (!cancelled) {
          setTargetFingerprint(keys?.primary_key_fingerprint ?? null);
        }
      } catch {
        if (!cancelled) setTargetFingerprint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, isLoggedIn, userId]);

  useEffect(() => {
    if (!isLoggedIn || isOwnProfile || !targetFingerprint) {
      setTrustGraph(null);
      setTrustGraphTruncated(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const graph = await authApiClient(
          signed.signedMessage,
        ).wot.getSignaturesByFingerprint(targetFingerprint, {
          direction: "inbound",
          max_depth: 4,
        });
        if (!cancelled) {
          setTrustGraph(graph);
          setTrustGraphTruncated(graph.meta.truncated);
        }
      } catch {
        if (!cancelled) {
          setTrustGraph(null);
          setTrustGraphTruncated(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, isLoggedIn, isOwnProfile, targetFingerprint]);

  const trustedByUserId = useMemo(
    () => new Set(contactUserIds),
    [contactUserIds],
  );
  const trustedPathUserIds = useMemo(() => {
    if (!trustGraph || !targetFingerprint || trustedByUserId.size === 0)
      return [];

    const userByFingerprint = new Map<string, string>();
    const revokedFingerprints = new Set<string>();
    for (const node of trustGraph.nodes) {
      if (node.revoked) {
        revokedFingerprints.add(node.fingerprint);
        continue;
      }
      if (node.user_id) {
        userByFingerprint.set(node.fingerprint, node.user_id);
      }
    }
    if (revokedFingerprints.has(targetFingerprint)) return [];

    const adjacency = new Map<string, string[]>();
    for (const edge of trustGraph.edges) {
      if (
        edge.revoked ||
        revokedFingerprints.has(edge.from_fingerprint) ||
        revokedFingerprints.has(edge.to_fingerprint)
      ) {
        continue;
      }
      const list = adjacency.get(edge.from_fingerprint) ?? [];
      list.push(edge.to_fingerprint);
      adjacency.set(edge.from_fingerprint, list);
    }

    const target = targetFingerprint;
    const matched = new Set<string>();

    for (const [fp, uid] of userByFingerprint.entries()) {
      if (!trustedByUserId.has(uid)) continue;
      const seen = new Set<string>();
      const queue = [fp];
      let found = false;
      while (queue.length > 0 && !found) {
        const cur = queue.shift()!;
        if (cur === target) {
          found = true;
          break;
        }
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const next of adjacency.get(cur) ?? []) {
          if (!seen.has(next)) queue.push(next);
        }
      }
      if (found) {
        matched.add(uid);
      }
    }

    return Array.from(matched);
  }, [targetFingerprint, trustGraph, trustedByUserId]);

  const { profiles: trustedProfiles } = useResolvedProfiles(trustedPathUserIds);
  const trustedProfilesByUserId = useMemo(
    () =>
      Object.fromEntries(trustedProfiles.map((p) => [p.userId, p])) as Record<
        string,
        (typeof trustedProfiles)[number]
      >,
    [trustedProfiles],
  );

  const handleAddContact = async () => {
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    setAddingContact(true);
    try {
      await authApiClient(signed.signedMessage).contacts.add(userId);
      setIsContact(true);
      setContactUserIds((prev) =>
        prev.includes(userId) ? prev : [...prev, userId],
      );
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
      const raw = await apiClient().user.getKeys(userId, { fresh: true });
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

  const showWotQr = async () => {
    if (
      !auth.worker ||
      !auth.publicKeys ||
      !auth.privateKeys ||
      !auth.subPassphrase
    ) {
      showError(t("error.unauthorized"));
      return;
    }
    const fingerprint = await new Promise<string | null>((resolve) => {
      auth.worker!.eventWaiter("get_primary_fingerprint", (result) => {
        if (result.success) resolve(result.data.fingerprint);
        else resolve(null);
      });
      auth.worker!.postMessage({
        call: "get_primary_fingerprint",
        publicKeys: auth.publicKeys!,
      });
    });
    if (!fingerprint) {
      showError(t("error.unknown"));
      return;
    }

    const payload: WotQrPayload = {
      v: 1,
      type: "xrypton-wot",
      fingerprint,
      key_server: getOwnKeyServerBaseUrl(),
      nonce: {
        random: crypto.randomUUID(),
        time: new Date().toISOString(),
      },
    };
    const canonical = canonicalize(payload);
    const payloadBytes = new TextEncoder().encode(canonical);
    const detached = await new Promise<string | null>((resolve) => {
      auth.worker!.eventWaiter("sign_detached", (result) => {
        if (result.success) resolve(result.data.signature);
        else resolve(null);
      });
      auth.worker!.postMessage({
        call: "sign_detached",
        keys: auth.privateKeys!,
        passphrase: auth.subPassphrase!,
        payload: bytesToBase64(payloadBytes),
      });
    });
    if (!detached) {
      showError(t("error.unknown"));
      return;
    }
    const qrText = `${toBase64Url(new TextEncoder().encode(detached))}.${toBase64Url(
      payloadBytes,
    )}`;
    const suffix = `${fingerprint.slice(-8, -4)} ${fingerprint.slice(-4)}`;
    pushDialog((p) => (
      <Dialog {...p} title="Web of Trust QR">
        <div className="space-y-3">
          <QrDisplay data={qrText} />
          <p className="text-xs text-center text-muted">FP suffix: {suffix}</p>
          <Code code={qrText} />
        </div>
      </Dialog>
    ));
  };

  const openTrustGraphDialog = () => {
    if (!trustGraph || !targetFingerprint) return;
    const activeFingerprints = new Set(
      trustGraph.nodes.filter((n) => !n.revoked).map((n) => n.fingerprint),
    );
    const activeNodes = trustGraph.nodes.filter((n) => !n.revoked);
    const activeEdges = trustGraph.edges.filter(
      (e) =>
        !e.revoked &&
        activeFingerprints.has(e.from_fingerprint) &&
        activeFingerprints.has(e.to_fingerprint),
    );
    const userIdByFingerprint = Object.fromEntries(
      activeNodes.map((n) => [n.fingerprint, n.user_id]),
    ) as Record<string, string | null>;

    const profileMap = Object.fromEntries(
      trustedProfiles.map((p) => [
        p.userId,
        {
          displayName: p.displayName,
          iconUrl: p.iconUrl,
          iconSignature: p.iconSignature ?? "",
          signingPublicKey: p.signingPublicKey,
        },
      ]),
    ) as Record<
      string,
      {
        displayName: string;
        iconUrl: string | null;
        iconSignature: string;
        signingPublicKey?: string;
      }
    >;

    const rootFingerprint =
      activeNodes.find((n) => n.user_id === auth.userId)?.fingerprint ??
      targetFingerprint;

    pushDialog((p) => (
      <Dialog {...p} title={t("wot.trust_graph")}>
        <WotGraphDialog
          rootFingerprint={rootFingerprint}
          targetFingerprint={targetFingerprint}
          nodes={activeNodes.map((n) => ({
            fingerprint: n.fingerprint,
            userId: n.user_id,
          }))}
          edges={activeEdges.map((e) => ({
            from: e.from_fingerprint,
            to: e.to_fingerprint,
          }))}
          profiles={profileMap}
          userIdByFingerprint={userIdByFingerprint}
          onOpenProfile={(nextUserId) => {
            p.close();
            router.push(`/profile/${encodeURIComponent(nextUserId)}`);
          }}
        />
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

  const trustedPreview = trustedPathUserIds.slice(0, 3);
  const trustedOverflow = Math.max(
    0,
    trustedPathUserIds.length - trustedPreview.length,
  );

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      {/* 他者プロフィールの場合のみヘッダーを表示 */}
      {!isOwnProfile && (
        <div className="flex items-center gap-2">
          {canGoBack && (
            <button
              type="button"
              onClick={() => router.back()}
              className="p-2 hover:bg-accent/10 rounded"
            >
              <FontAwesomeIcon icon={faArrowLeft} />
            </button>
          )}
          <h2 className="text-lg font-semibold flex-1">{t("tab.profile")}</h2>
          {isLoggedIn && (
            <div className="flex items-center gap-1">
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
        </div>
      )}

      <div className="flex flex-col items-center">
        <Avatar
          name={displayName || userId}
          iconUrl={iconUrl}
          iconSignature={iconSignature}
          publicKey={signingPublicKey}
          size="xl"
          onVerifyStateChange={setIconVerifyState}
        />
        <h2 className="mt-3 text-lg font-semibold">
          {displayName || displayUserId(userId)}
        </h2>
        <p className="text-sm text-muted/50 select-all">
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

        {!isOwnProfile && trustedPathUserIds.length > 0 && (
          <div className="mt-3 flex flex-col items-center gap-2">
            <p className="text-xs text-muted">{t("wot.trusted_by_contacts")}</p>
            <button
              type="button"
              onClick={openTrustGraphDialog}
              className="flex items-center gap-2 hover:opacity-90"
            >
              {trustedPreview.map((trustedUserId) => {
                const profile = trustedProfilesByUserId[trustedUserId];
                return (
                  <Avatar
                    key={trustedUserId}
                    name={profile?.displayName ?? trustedUserId}
                    iconUrl={profile?.iconUrl}
                    iconSignature={profile?.iconSignature}
                    publicKey={profile?.signingPublicKey}
                    size="sm"
                  />
                );
              })}
              {trustedOverflow > 0 && (
                <span className="text-xs text-muted border rounded-full px-2 py-1">
                  +{trustedOverflow}
                </span>
              )}
            </button>
            {trustGraphTruncated && (
              <p className="text-[10px] text-muted">
                {t("wot.results_truncated")}
              </p>
            )}
          </div>
        )}
      </div>

      {externalAccounts.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {externalAccounts.map((account) => {
            if (account.type === "atproto") {
              const label = account.handle ?? account.did;
              const href = account.handle
                ? `https://bsky.app/profile/${account.handle}`
                : `https://bsky.app/profile/${account.did}`;
              const state = externalVerified.get(account.did) ?? "pending";
              return (
                <a
                  key={account.did}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 text-sm hover:underline ${
                    state === "unverified"
                      ? "text-red-500"
                      : state === "verified"
                        ? "text-green-500"
                        : "text-muted"
                  }`}
                  title={account.did}
                >
                  <FontAwesomeIcon icon={faAt} />
                  {label}
                </a>
              );
            }
            if (account.type === "x") {
              const state =
                externalVerified.get(`x:${account.handle}`) ?? "pending";
              return (
                <a
                  key={`x:${account.handle}`}
                  href={account.author_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 text-sm hover:underline ${
                    state === "unverified"
                      ? "text-red-500"
                      : state === "verified"
                        ? "text-green-500"
                        : "text-muted"
                  }`}
                  title={`@${account.handle}`}
                >
                  <FontAwesomeIcon icon={faXTwitter} />@{account.handle}
                </a>
              );
            }
            return null;
          })}
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
            <button
              type="button"
              onClick={showWotQr}
              disabled={!hasWorker || !auth.publicKeys}
              className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm disabled:opacity-50"
            >
              {t("wot.show_qr")}
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
