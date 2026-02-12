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
import { getKey, setKey, deleteKey } from "@/utils/keyStore";
import { apiClient, ApiError } from "@/api/client";

type AuthContextType = {
  privateKeys: string | undefined;
  setPrivateKeys: (keys: string | undefined) => void;
  publicKeys: string | undefined;
  subPassphrase: string | undefined;
  setSubPassphrase: (pass: string | undefined) => void;
  userId: string | undefined;
  setUserId: (id: string | undefined) => void;
  /** サーバに公開鍵が登録済みかどうか */
  isRegistered: boolean;
  /** サーバに公開鍵を登録する */
  register: () => Promise<void>;
  /** WebAuthn再認証ポリシー（日、0 = 無期限） */
  reauthPolicyDays: 0 | 1 | 3 | 7 | 30;
  setReauthPolicyDays: (days: 0 | 1 | 3 | 7 | 30) => Promise<void>;
  /** 高リスク操作などの前に再認証を要求する */
  ensureRecentReauth: (force?: boolean, userName?: string) => Promise<boolean>;
  hasWebAuthnCredential: boolean;
  /** Worker経由でPGP署名付き認証メッセージを生成する */
  getSignedMessage: () => Promise<{
    signedMessage: string;
    userId: string;
  } | null>;
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
  userId: undefined,
  setUserId: () => {},
  isRegistered: false,
  register: async () => {},
  reauthPolicyDays: 7,
  setReauthPolicyDays: async () => {},
  ensureRecentReauth: async () => false,
  hasWebAuthnCredential: false,
  getSignedMessage: async () => null,
  worker: null,
  serviceWorker: { registration: undefined, subscribe: async () => {} },
  isInitialized: false,
});

const WEBAUTHN_CRED_KEY = "webauthnCredentialId";
const WEBAUTHN_USER_HANDLE_KEY = "webauthnUserHandle";
const REAUTH_POLICY_KEY = "reauthPolicyDays";
const LAST_REAUTH_AT_KEY = "lastReauthAt";
const DEFAULT_REAUTH_DAYS: 0 | 1 | 3 | 7 | 30 = 7;

function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

function toBase64Url(input: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...input));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64 + pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function parsePolicyDays(value: string | undefined): 0 | 1 | 3 | 7 | 30 {
  if (value === "0" || value === "1" || value === "3" || value === "7" || value === "30") {
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

  const [privateKeys, setPrivateKeysState] = useState<string | undefined>(
    undefined,
  );
  const [publicKeys, setPublicKeys] = useState<string | undefined>(undefined);
  const [subPassphrase, setSubPassphraseState] = useState<string | undefined>(
    undefined,
  );
  const [userId, setUserIdState] = useState<string | undefined>(undefined);
  const [isRegistered, setIsRegistered] = useState(false);
  const [reauthPolicyDays, setReauthPolicyDaysState] =
    useState<0 | 1 | 3 | 7 | 30>(DEFAULT_REAUTH_DAYS);
  const [hasWebAuthnCredential, setHasWebAuthnCredential] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const setPrivateKeys = (keys: string | undefined) => {
    setPrivateKeysState(keys);
    if (keys) {
      setKey("privateKeys", keys);
    } else {
      setPublicKeys(undefined);
      deleteKey("privateKeys");
    }
  };

  const setSubPassphrase = (pass: string | undefined) => {
    setSubPassphraseState(pass);
    if (pass) {
      setKey("subPassphrase", pass);
    } else {
      deleteKey("subPassphrase");
    }
  };

  const setUserId = (id: string | undefined) => {
    setUserIdState(id);
    if (id) {
      setKey("userId", id);
    } else {
      deleteKey("userId");
    }
  };

  // 初期化: IndexedDBから読み込み（localStorageからの移行を含む）
  useEffect(() => {
    const LS_KEYS = {
      privateKeys: "private_keys",
      subPassphrase: "sub_passphrase",
      userId: "user_id",
    } as const;

    async function migrateAndLoad(
      idbKey: string,
      lsKey: string,
    ): Promise<string | undefined> {
      let value = await getKey(idbKey);
      if (value === undefined) {
        const lsValue = localStorage.getItem(lsKey);
        if (lsValue) {
          value = lsValue;
          await setKey(idbKey, lsValue);
        }
      }
      localStorage.removeItem(lsKey);
      return value;
    }

    (async () => {
      const [pk, sp, uid, reg, policy, cred] = await Promise.all([
        migrateAndLoad("privateKeys", LS_KEYS.privateKeys),
        migrateAndLoad("subPassphrase", LS_KEYS.subPassphrase),
        migrateAndLoad("userId", LS_KEYS.userId),
        getKey("isRegistered"),
        getKey(REAUTH_POLICY_KEY),
        getKey(WEBAUTHN_CRED_KEY),
      ]);

      // 旧 apiBaseUrl のクリーンアップ
      localStorage.removeItem("api_base_url");
      deleteKey("apiBaseUrl");

      setPrivateKeysState(pk);
      setSubPassphraseState(sp);
      setUserIdState(uid);
      setIsRegistered(reg === "true");
      setReauthPolicyDaysState(parsePolicyDays(policy));
      setHasWebAuthnCredential(!!cred);
      setIsInitialized(true);
    })();
  }, []);

  const setReauthPolicyDays = useCallback(async (days: 0 | 1 | 3 | 7 | 30) => {
    setReauthPolicyDaysState(days);
    await setKey(REAUTH_POLICY_KEY, String(days));
  }, []);

  const registerWebAuthn = useCallback(async (userName?: string): Promise<boolean> => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      return false;
    }
    try {
      const name = userName ?? userId ?? "crypton-user";
      const savedHandle = await getKey(WEBAUTHN_USER_HANDLE_KEY);
      const userIdBytes = savedHandle
        ? fromBase64Url(savedHandle)
        : randomBytes(32);
      const challenge = toArrayBuffer(randomBytes(32));

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Crypton" },
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
            userVerification: "required",
          },
        },
      })) as PublicKeyCredential | null;

      if (!credential) return false;

      const credentialId = toBase64Url(new Uint8Array(credential.rawId));
      const now = Date.now().toString();
      await Promise.all([
        setKey(WEBAUTHN_CRED_KEY, credentialId),
        setKey(WEBAUTHN_USER_HANDLE_KEY, toBase64Url(userIdBytes)),
        setKey(LAST_REAUTH_AT_KEY, now),
      ]);
      setHasWebAuthnCredential(true);
      return true;
    } catch {
      return false;
    }
  }, [userId]);

  const verifyWebAuthn = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      return false;
    }
    try {
      const credentialId = await getKey(WEBAUTHN_CRED_KEY);
      if (!credentialId) return false;

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: toArrayBuffer(randomBytes(32)),
          allowCredentials: [
            {
              type: "public-key",
              id: toArrayBuffer(fromBase64Url(credentialId)),
            },
          ],
          timeout: 60_000,
          userVerification: "required",
        },
      })) as PublicKeyCredential | null;

      if (!assertion) return false;
      await setKey(LAST_REAUTH_AT_KEY, Date.now().toString());
      return true;
    } catch {
      return false;
    }
  }, []);

  const ensureRecentReauth = useCallback(
    async (force = false, userName?: string): Promise<boolean> => {
      if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
        return false;
      }

      // 無期限（0）の場合、force でなければ常に認証済みとみなす
      if (!force && reauthPolicyDays === 0) return true;

      const maxAgeMs = reauthPolicyDays * 24 * 60 * 60 * 1000;
      const lastReauthAt = Number((await getKey(LAST_REAUTH_AT_KEY)) ?? "0");
      const withinWindow =
        !force &&
        Number.isFinite(lastReauthAt) &&
        lastReauthAt > 0 &&
        Date.now() - lastReauthAt <= maxAgeMs;

      if (withinWindow) return true;

      const hasCredential = !!(await getKey(WEBAUTHN_CRED_KEY));
      setHasWebAuthnCredential(hasCredential);
      if (!hasCredential) {
        return registerWebAuthn(userName);
      }
      return verifyWebAuthn();
    },
    [reauthPolicyDays, registerWebAuthn, verifyWebAuthn],
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
  }, [privateKeys, workerCtx.worker, workerCtx.eventWaiter, workerCtx.postMessage]);

  // サーバに公開鍵を登録する
  // 409 の場合はサーバ上の公開鍵とローカルが一致するか検証する
  const register = useCallback(async () => {
    if (!publicKeys || !userId) return;
    // bot緩和のため、登録直前にWebAuthnを強制する
    const reauthed = await ensureRecentReauth(true, userId);
    if (!reauthed) {
      throw new Error("WebAuthn verification failed");
    }

    try {
      await apiClient().user.postKeys(userId, publicKeys, publicKeys);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 既に登録済み — ローカルの公開鍵とサーバ上の鍵が一致するか検証
        const serverKeys = await apiClient().user.getKeys(userId);
        if (
          serverKeys.signing_public_key !== publicKeys ||
          serverKeys.encryption_public_key !== publicKeys
        ) {
          throw new Error(
            "This user ID is already registered with different keys.",
          );
        }
      } else {
        throw e;
      }
    }

    setIsRegistered(true);
    await setKey("isRegistered", "true");

    // 登録成功後、通知許可を求めてPush購読を行う
    try {
      if ("Notification" in window) {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          if (privateKeys && subPassphrase && userId && workerCtx.worker) {
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
                  nonce: crypto.randomUUID(),
                  timestamp: new Date().toISOString(),
                }),
              });
            });
            if (signed) {
              await serviceWorker.subscribe(signed);
            }
          }
        }
      }
    } catch {
      // push subscription after register failed
    }
  }, [
    publicKeys,
    userId,
    serviceWorker,
    ensureRecentReauth,
    privateKeys,
    subPassphrase,
    workerCtx.worker,
    workerCtx.eventWaiter,
    workerCtx.postMessage,
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
      nonce: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
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
  }, [privateKeys, subPassphrase, userId, workerCtx.worker, workerCtx.eventWaiter, workerCtx.postMessage]);

  return (
    <AuthContext.Provider
      value={{
        privateKeys,
        setPrivateKeys,
        publicKeys,
        subPassphrase,
        setSubPassphrase,
        userId,
        setUserId,
        isRegistered,
        register,
        reauthPolicyDays,
        setReauthPolicyDays,
        ensureRecentReauth,
        hasWebAuthnCredential,
        getSignedMessage: getSignedMessageInternal,
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
