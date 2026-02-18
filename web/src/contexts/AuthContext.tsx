"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useWorkerWaiter } from "@/hooks/useWorker";
import { useServiceWorker } from "@/hooks/useServiceWorker";
import type { WorkerEventWaiter } from "@/hooks/useWorker";
import { z } from "zod";
import { WorkerCallMessage } from "@/utils/schema";
import { getKey, setKey } from "@/utils/keyStore";
import { fromBase64Url, toBase64Url } from "@/utils/base64";
import { apiClient, authApiClient, ApiError } from "@/api/client";
import {
  migrateToMultiAccount,
  getActiveAccountId,
  setActiveAccountId,
  getAccountIds,
  getAccountValue,
  setAccountValue,
  deleteAccountValue,
  addAccountId,
  syncSettingsToLocalStorage,
  renameAccount,
} from "@/utils/accountStore";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n } from "@/contexts/I18nContext";
import type { ThemeColor, ThemeMode } from "@/types/theme";
import type { Locale } from "@/i18n";

type AuthContextType = {
  privateKeys: string | undefined;
  setPrivateKeys: (keys: string | undefined) => void;
  publicKeys: string | undefined;
  subPassphrase: string | undefined;
  setSubPassphrase: (pass: string | undefined) => void;
  /** React stateのみにサブパスフレーズをセットし、IDBには保存しない */
  setSubPassphraseSession: (pass: string) => void;
  userId: string | undefined;
  setUserId: (id: string | undefined) => void;
  /** サーバに公開鍵が登録済みかどうか */
  isRegistered: boolean;
  /** サーバに公開鍵を登録する */
  register: () => Promise<void>;
  /** サーバの公開鍵を更新する */
  updateKeys: (publicKeys: string) => Promise<void>;
  /** WebAuthn再認証ポリシー（日、0 = 無期限） */
  reauthPolicyDays: 0 | 1 | 3 | 7 | 30;
  setReauthPolicyDays: (days: 0 | 1 | 3 | 7 | 30) => Promise<void>;
  /** Push通知の有効状態 */
  notificationsEnabled: boolean;
  /** Push通知の有効状態を切り替える。戻り値は最終的に有効になったか。 */
  setNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  /** 高リスク操作などの前に再認証を要求する */
  ensureRecentReauth: (
    force?: boolean,
    userName?: string,
    allowRegister?: boolean,
  ) => Promise<boolean>;
  hasWebAuthnCredential: boolean;
  /** Worker経由でPGP署名付き認証メッセージを生成する */
  getSignedMessage: () => Promise<{
    signedMessage: string;
    userId: string;
  } | null>;
  /** 任意のテキストをPGP署名する */
  signText: (text: string) => Promise<string | null>;
  /** 新しいアカウントをストアに登録し、アクティブにする（reloadを遅延可能） */
  activateAccount: (
    userId: string,
    privateKeys: string,
    subPassphrase?: string,
    skipReload?: boolean,
  ) => Promise<void>;
  /** WebAuthn登録を行う */
  registerWebAuthn: (userName?: string) => Promise<boolean>;
  /** 既存のWebAuthnクレデンシャルで検証を行う（discoverable credentials） */
  verifyWebAuthn: () => Promise<boolean>;
  /** サーバ登録済みとしてマークする */
  markRegistered: () => Promise<void>;
  /** 登録済みアカウントIDの一覧 */
  accountIds: string[];
  /** アカウント追加モード（GenerateKey表示のトリガー） */
  isAddingAccount: boolean;
  /** アカウント追加モードを終了する */
  cancelAddAccount: () => void;
  worker: {
    eventWaiter: WorkerEventWaiter;
    postMessage: (msg: z.infer<typeof WorkerCallMessage>) => void;
  } | null;
  serviceWorker: ReturnType<typeof useServiceWorker>;
  isInitialized: boolean;
};

const AuthContext = createContext<AuthContextType>({
  privateKeys: undefined,
  setPrivateKeys: () => {},
  publicKeys: undefined,
  subPassphrase: undefined,
  setSubPassphrase: () => {},
  setSubPassphraseSession: () => {},
  userId: undefined,
  setUserId: () => {},
  isRegistered: false,
  register: async () => {},
  updateKeys: async () => {},
  reauthPolicyDays: 7,
  setReauthPolicyDays: async () => {},
  notificationsEnabled: true,
  setNotificationsEnabled: async () => false,
  ensureRecentReauth: async () => false,
  hasWebAuthnCredential: false,
  getSignedMessage: async () => null,
  signText: async () => null,
  activateAccount: async () => {},
  registerWebAuthn: async () => false,
  verifyWebAuthn: async () => false,
  markRegistered: async () => {},
  accountIds: [],
  isAddingAccount: false,
  cancelAddAccount: () => {},
  worker: null,
  serviceWorker: { registration: undefined, subscribe: async () => false },
  isInitialized: false,
});

const WEBAUTHN_USER_HANDLE_KEY = "webauthnUserHandle";
const REAUTH_POLICY_KEY = "reauthPolicyDays";
const LAST_REAUTH_AT_KEY = "lastReauthAt";
const DEFAULT_REAUTH_DAYS: 0 | 1 | 3 | 7 | 30 = 7;

function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

function parsePolicyDays(value: string | undefined): 0 | 1 | 3 | 7 | 30 {
  if (
    value === "0" ||
    value === "1" ||
    value === "3" ||
    value === "7" ||
    value === "30"
  ) {
    return Number(value) as 0 | 1 | 3 | 7 | 30;
  }
  return DEFAULT_REAUTH_DAYS;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const workerCtx = useWorkerWaiter();
  const serviceWorker = useServiceWorker();
  const { setColor, setMode } = useTheme();
  const { setLocale } = useI18n();

  const [privateKeys, setPrivateKeysState] = useState<string | undefined>(
    undefined,
  );
  const [publicKeys, setPublicKeys] = useState<string | undefined>(undefined);
  const [subPassphrase, setSubPassphraseState] = useState<string | undefined>(
    undefined,
  );
  const [userId, setUserIdState] = useState<string | undefined>(undefined);
  const [isRegistered, setIsRegistered] = useState(false);
  const [reauthPolicyDays, setReauthPolicyDaysState] = useState<
    0 | 1 | 3 | 7 | 30
  >(DEFAULT_REAUTH_DAYS);
  const [hasWebAuthnCredential, setHasWebAuthnCredential] = useState(false);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [accountIds, setAccountIdsState] = useState<string[]>([]);
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  // アクティブアカウントのプレフィックス付きキーに書き込むセッター
  const setPrivateKeys = (keys: string | undefined) => {
    setPrivateKeysState(keys);
    if (keys && userId) {
      setAccountValue(userId, "privateKeys", keys);
    } else if (!keys && userId) {
      setPublicKeys(undefined);
      deleteAccountValue(userId, "privateKeys");
    }
  };

  const setSubPassphrase = (pass: string | undefined) => {
    setSubPassphraseState(pass);
    if (pass && userId) {
      setAccountValue(userId, "subPassphrase", pass);
    } else if (!pass && userId) {
      deleteAccountValue(userId, "subPassphrase");
    }
  };

  const setSubPassphraseSession = (pass: string) => {
    setSubPassphraseState(pass);
    if (userId) deleteAccountValue(userId, "subPassphrase");
  };

  const setUserId = (id: string | undefined) => {
    setUserIdState(id);
    if (id) {
      setActiveAccountId(id);
    }
  };

  // 初期化: マイグレーション → アクティブアカウントのデータ読み込み
  useEffect(() => {
    (async () => {
      // localStorage → IDB マイグレーション（レガシー対応）
      const LS_KEYS = {
        privateKeys: "private_keys",
        subPassphrase: "sub_passphrase",
        userId: "user_id",
      } as const;
      for (const [idbKey, lsKey] of Object.entries(LS_KEYS)) {
        const existing = await getKey(idbKey);
        if (existing === undefined) {
          const lsValue = localStorage.getItem(lsKey);
          if (lsValue) {
            await setKey(idbKey, lsValue);
          }
        }
        localStorage.removeItem(lsKey);
      }

      // 旧 apiBaseUrl のクリーンアップ
      localStorage.removeItem("api_base_url");

      // フラットキー → マルチアカウントへのマイグレーション
      await migrateToMultiAccount();

      // アカウント一覧とアクティブアカウントを読み込み
      let ids = await getAccountIds();
      setAccountIdsState(ids);

      let activeId = await getActiveAccountId();
      if (activeId && ids.includes(activeId)) {
        // ドメインなしのアカウントIDをサーバのcanonical IDに移行
        if (!activeId.includes("@")) {
          try {
            const profileResp = await apiClient().user.getProfile(activeId);
            const canonicalId = profileResp.user_id as string;
            if (canonicalId && canonicalId !== activeId) {
              await renameAccount(activeId, canonicalId);
              activeId = canonicalId;
              ids = await getAccountIds();
              setAccountIdsState(ids);
            }
          } catch {
            // 失敗時は無視して次回リトライ
          }
        }

        // アクティブアカウントのデータを読み込み
        const [pk, sp, reg, policy, lastReauth, notifEnabled] =
          await Promise.all([
            getAccountValue(activeId, "privateKeys"),
            getAccountValue(activeId, "subPassphrase"),
            getAccountValue(activeId, "isRegistered"),
            getAccountValue(activeId, REAUTH_POLICY_KEY),
            getAccountValue(activeId, LAST_REAUTH_AT_KEY),
            getAccountValue(activeId, "notificationsEnabled"),
          ]);

        setUserIdState(activeId);
        setPrivateKeysState(pk);
        setSubPassphraseState(sp);
        setIsRegistered(reg === "true");
        setReauthPolicyDaysState(parsePolicyDays(policy));
        setHasWebAuthnCredential(!!lastReauth);
        setNotificationsEnabledState(notifEnabled !== "false");

        // テーマ・言語設定をアカウント別に同期
        const [acctColor, acctMode, acctLocale] = await Promise.all([
          getAccountValue(activeId, "themeColor"),
          getAccountValue(activeId, "themeMode"),
          getAccountValue(activeId, "locale"),
        ]);
        if (acctColor) {
          setColor(acctColor as ThemeColor);
        } else {
          const ls = localStorage.getItem("theme-color");
          if (ls) await setAccountValue(activeId, "themeColor", JSON.parse(ls));
        }
        if (acctMode) {
          setMode(acctMode as ThemeMode);
        } else {
          const ls = localStorage.getItem("theme-mode");
          if (ls) await setAccountValue(activeId, "themeMode", JSON.parse(ls));
        }
        if (acctLocale) {
          setLocale(acctLocale as Locale);
        } else {
          const ls = localStorage.getItem("locale");
          if (ls) await setAccountValue(activeId, "locale", JSON.parse(ls));
        }
      }
      // activeId が無い or ids が空 → 新規インストールまたはアカウント追加フロー

      setIsInitialized(true);
    })();
  }, []);

  const setReauthPolicyDays = useCallback(
    async (days: 0 | 1 | 3 | 7 | 30) => {
      setReauthPolicyDaysState(days);
      if (userId) {
        await setAccountValue(userId, REAUTH_POLICY_KEY, String(days));
      }
    },
    [userId],
  );

  // アカウント別プレフィックス付きの WebAuthn キー読み書き
  const getWebAuthnKey = useCallback(
    (key: string) => (userId ? getAccountValue(userId, key) : getKey(key)),
    [userId],
  );

  const setWebAuthnKey = useCallback(
    (key: string, value: string) =>
      userId ? setAccountValue(userId, key, value) : setKey(key, value),
    [userId],
  );

  const registerWebAuthn = useCallback(
    async (userName?: string): Promise<boolean> => {
      if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
        return false;
      }
      try {
        const name = userName ?? userId ?? "xrypton-user";
        const savedHandle = await getWebAuthnKey(WEBAUTHN_USER_HANDLE_KEY);
        const userIdBytes = savedHandle
          ? fromBase64Url(savedHandle)
          : randomBytes(32);
        const challenge = toArrayBuffer(randomBytes(32));

        const credential = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: "Xrypton" },
            user: {
              id: toArrayBuffer(userIdBytes),
              name,
              displayName: name,
            },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 }, // ES256
              { type: "public-key", alg: -257 }, // RS256
            ],
            timeout: 60_000,
            attestation: "none",
            authenticatorSelection: {
              residentKey: "preferred",
              userVerification: "required",
            },
          },
        })) as PublicKeyCredential | null;

        if (!credential) return false;

        const now = Date.now().toString();
        await Promise.all([
          setWebAuthnKey(WEBAUTHN_USER_HANDLE_KEY, toBase64Url(userIdBytes)),
          setWebAuthnKey(LAST_REAUTH_AT_KEY, now),
        ]);
        setHasWebAuthnCredential(true);
        return true;
      } catch {
        return false;
      }
    },
    [userId, getWebAuthnKey, setWebAuthnKey],
  );

  const verifyWebAuthn = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      return false;
    }
    try {
      // 常にdiscoverable credentialsを使用し、パスワードマネージャ等の
      // 同期パスキーを含むすべてのパスキーを提示する
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: toArrayBuffer(randomBytes(32)),
          timeout: 60_000,
          userVerification: "required",
        },
      })) as PublicKeyCredential | null;

      if (!assertion) return false;

      await setWebAuthnKey(LAST_REAUTH_AT_KEY, Date.now().toString());
      setHasWebAuthnCredential(true);
      return true;
    } catch {
      return false;
    }
  }, [setWebAuthnKey]);

  const ensureRecentReauth = useCallback(
    async (
      force = false,
      userName?: string,
      allowRegister = false,
    ): Promise<boolean> => {
      if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
        return false;
      }

      // 無期限（0）の場合、force でなければ常に認証済みとみなす
      if (!force && reauthPolicyDays === 0) return true;

      const maxAgeMs = reauthPolicyDays * 24 * 60 * 60 * 1000;
      const lastReauthAt = Number(
        (await getWebAuthnKey(LAST_REAUTH_AT_KEY)) ?? "0",
      );
      const withinWindow =
        !force &&
        Number.isFinite(lastReauthAt) &&
        lastReauthAt > 0 &&
        Date.now() - lastReauthAt <= maxAgeMs;

      if (withinWindow) return true;

      const hasPasskey = !!(await getWebAuthnKey(LAST_REAUTH_AT_KEY));
      setHasWebAuthnCredential(hasPasskey);
      if (!hasPasskey && allowRegister) {
        // パスキー未登録かつ新規登録が許可されている場合は直接登録に進む
        return registerWebAuthn(userName);
      }
      // discoverable credentialsで検証（パスワードマネージャの同期パスキーを含む）
      return verifyWebAuthn();
    },
    [reauthPolicyDays, registerWebAuthn, verifyWebAuthn, getWebAuthnKey],
  );

  // 秘密鍵が変更されたら公開鍵を導出
  useEffect(() => {
    if (privateKeys && workerCtx.worker) {
      workerCtx.eventWaiter("export_public_keys", (data) => {
        if (data.success) {
          setPublicKeys(data.data.keys);
        }
      });
      workerCtx.postMessage({
        call: "export_public_keys",
        keys: privateKeys,
      });
    }
  }, [
    privateKeys,
    workerCtx.worker,
    workerCtx.eventWaiter,
    workerCtx.postMessage,
  ]);

  // 通知許可を取得し、Push購読を行う共通ヘルパー
  // requestPermission=true の場合、未許可ならプロンプトを表示する
  const ensurePushSubscription = useCallback(
    async (requestPermission: boolean, force = false): Promise<boolean> => {
      if (!force && !notificationsEnabled) return false;
      if (!("Notification" in window)) return false;
      if (!privateKeys || !subPassphrase || !userId || !workerCtx.worker)
        return false;

      if (requestPermission) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return false;
      } else {
        // 既に許可済みでなければ何もしない
        if (Notification.permission !== "granted") return false;
      }

      // 既にアクティブな購読があればスキップ
      const reg = serviceWorker.registration;
      if (reg) {
        const existing = await reg.pushManager.getSubscription();
        if (existing) return true;
      }

      const signed = await new Promise<string | null>((resolve) => {
        workerCtx.eventWaiter("sign", (result) => {
          if (result.success) {
            resolve(result.data.signed_message);
          } else {
            resolve(null);
          }
        });
        workerCtx.postMessage({
          call: "sign",
          keys: privateKeys,
          passphrase: subPassphrase,
          payload: JSON.stringify({
            nonce: new Date().toISOString(),
          }),
        });
      });
      if (!signed) return false;
      return serviceWorker.subscribe(signed);
    },
    [
      notificationsEnabled,
      privateKeys,
      subPassphrase,
      userId,
      workerCtx.worker,
      workerCtx.eventWaiter,
      workerCtx.postMessage,
      serviceWorker,
    ],
  );

  const setNotificationsEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setNotificationsEnabledState(enabled);
      if (userId) {
        await setAccountValue(userId, "notificationsEnabled", String(enabled));
      }

      if (!enabled) {
        const reg = serviceWorker.registration;
        if (reg) {
          try {
            const subscription = await reg.pushManager.getSubscription();
            if (subscription) {
              await subscription.unsubscribe();
            }
          } catch {
            // ignore unsubscribe failures
          }
        }
        return false;
      }

      const subscribed = await ensurePushSubscription(true, true);
      if (!subscribed) {
        setNotificationsEnabledState(false);
        if (userId) {
          await setAccountValue(userId, "notificationsEnabled", "false");
        }
      }
      return subscribed;
    },
    [userId, serviceWorker.registration, ensurePushSubscription],
  );

  // サーバに公開鍵を登録する
  // 409 の場合はサーバ上の公開鍵とローカルが一致するか検証する
  const register = useCallback(async () => {
    if (!publicKeys || !userId) return;
    // bot緩和のため、登録直前にWebAuthnを強制する（初回登録なので新規作成を許可）
    const reauthed = await ensureRecentReauth(true, userId, true);
    if (!reauthed) {
      throw new Error("WebAuthn verification failed");
    }

    try {
      await apiClient().user.postKeys(userId, publicKeys, publicKeys);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 既に登録済み — 鍵が同じか異なるかの判別は不可能なのでエラーとして扱う
        throw new Error(
          "This user ID is already registered. Use key import if you have the private key.",
        );
      } else {
        throw e;
      }
    }

    setIsRegistered(true);
    await setAccountValue(userId, "isRegistered", "true");

    // 登録成功後、通知許可を求めてPush購読を行う
    try {
      if (notificationsEnabled) {
        await ensurePushSubscription(true, true);
      }
    } catch {
      // push subscription after register failed
    }
  }, [
    publicKeys,
    userId,
    ensureRecentReauth,
    ensurePushSubscription,
    notificationsEnabled,
  ]);

  // 既登録ユーザが新しいデバイスや購読切れの場合に自動で再購読する
  useEffect(() => {
    if (!isInitialized || !isRegistered) return;
    if (!notificationsEnabled) return;
    if (!privateKeys || !subPassphrase || !userId || !workerCtx.worker) return;

    // 許可済みの場合のみ自動購読（プロンプトは出さない）
    ensurePushSubscription(false).catch(() => {});
  }, [
    isInitialized,
    isRegistered,
    notificationsEnabled,
    privateKeys,
    subPassphrase,
    userId,
    workerCtx.worker,
    ensurePushSubscription,
  ]);

  // Worker の eventWaiter を Promise でラップするユーティリティ（内部用）
  const getSignedMessageInternal = useCallback(async (): Promise<{
    signedMessage: string;
    userId: string;
  } | null> => {
    if (!privateKeys || !subPassphrase || !userId || !workerCtx.worker) {
      return null;
    }

    const payload = JSON.stringify({
      nonce: new Date().toISOString(),
    });

    return new Promise((resolve) => {
      workerCtx.eventWaiter("sign", (result) => {
        if (result.success) {
          resolve({ signedMessage: result.data.signed_message, userId });
        } else {
          resolve(null);
        }
      });
      workerCtx.postMessage({
        call: "sign",
        keys: privateKeys,
        passphrase: subPassphrase,
        payload,
      });
    });
  }, [
    privateKeys,
    subPassphrase,
    userId,
    workerCtx.worker,
    workerCtx.eventWaiter,
    workerCtx.postMessage,
  ]);

  const signText = useCallback(
    async (text: string): Promise<string | null> => {
      if (!privateKeys || !subPassphrase || !workerCtx.worker) {
        return null;
      }
      return new Promise((resolve) => {
        workerCtx.eventWaiter("sign", (result) => {
          if (result.success) {
            resolve(result.data.signed_message);
          } else {
            resolve(null);
          }
        });
        workerCtx.postMessage({
          call: "sign",
          keys: privateKeys,
          passphrase: subPassphrase,
          payload: text,
        });
      });
    },
    [
      privateKeys,
      subPassphrase,
      workerCtx.worker,
      workerCtx.eventWaiter,
      workerCtx.postMessage,
    ],
  );

  const updateKeys = useCallback(
    async (newPublicKeys: string) => {
      if (!userId) {
        throw new Error("user ID not set");
      }

      // 高リスク操作としてWebAuthnを強制
      const reauthed = await ensureRecentReauth(true, userId);
      if (!reauthed) {
        throw new Error("WebAuthn verification failed");
      }

      const signed = await getSignedMessageInternal();
      if (!signed) {
        throw new Error("failed to sign update request");
      }

      await authApiClient(signed.signedMessage).user.updateKeys(
        userId,
        newPublicKeys,
        newPublicKeys,
      );

      setIsRegistered(true);
      await setAccountValue(userId, "isRegistered", "true");
    },
    [userId, ensureRecentReauth, getSignedMessageInternal],
  );

  // 新しいアカウントをストアに登録し、アクティブにする
  const activateAccount = useCallback(
    async (
      newUserId: string,
      newPrivateKeys: string,
      newSubPassphrase?: string,
      skipReload?: boolean,
    ) => {
      await addAccountId(newUserId);
      await setAccountValue(newUserId, "privateKeys", newPrivateKeys);
      if (newSubPassphrase) {
        await setAccountValue(newUserId, "subPassphrase", newSubPassphrase);
      }
      await setActiveAccountId(newUserId);

      if (skipReload) {
        // リロードせずに状態を直接更新
        setUserId(newUserId);
        setPrivateKeys(newPrivateKeys);
        if (newSubPassphrase) setSubPassphrase(newSubPassphrase);
        return;
      }

      // リロードして新アカウントで再初期化
      window.location.reload();
    },
    [],
  );

  const markRegistered = useCallback(async () => {
    setIsRegistered(true);
    if (userId) {
      await setAccountValue(userId, "isRegistered", "true");
    }
    try {
      if (notificationsEnabled) {
        await ensurePushSubscription(true, true);
      }
    } catch {
      // push subscription failed
    }
  }, [userId, ensurePushSubscription, notificationsEnabled]);

  const cancelAddAccount = useCallback(async () => {
    // アカウント追加モードを終了し、前のアクティブアカウントに戻す
    // accountIds が空でなければ最初のアカウントに切り替えてリロード
    if (accountIds.length > 0) {
      const targetId = accountIds[0];
      await syncSettingsToLocalStorage(targetId);
      await setActiveAccountId(targetId);
      window.location.reload();
    }
    setIsAddingAccount(false);
  }, [accountIds]);

  return (
    <AuthContext.Provider
      value={{
        privateKeys,
        setPrivateKeys,
        publicKeys,
        subPassphrase,
        setSubPassphrase,
        setSubPassphraseSession,
        userId,
        setUserId,
        isRegistered,
        register,
        updateKeys,
        reauthPolicyDays,
        setReauthPolicyDays,
        notificationsEnabled,
        setNotificationsEnabled,
        ensureRecentReauth,
        hasWebAuthnCredential,
        getSignedMessage: getSignedMessageInternal,
        signText,
        activateAccount,
        registerWebAuthn,
        verifyWebAuthn,
        markRegistered,
        accountIds,
        isAddingAccount,
        cancelAddAccount,
        worker: workerCtx.worker
          ? {
              eventWaiter: workerCtx.eventWaiter,
              postMessage: workerCtx.postMessage,
            }
          : null,
        serviceWorker,
        isInitialized,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
