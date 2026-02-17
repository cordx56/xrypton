"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { Agent } from "@atproto/api";
import {
  BrowserOAuthClient,
  type HandleResolver,
} from "@atproto/oauth-client-browser";
import { useAuth } from "@/contexts/AuthContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient, ApiError } from "@/api/client";
import type { AtprotoAccount } from "@/types/atproto";

/** BrowserOAuthClientが要求するHandleResolverインターフェースの自前実装。
 *  ライブラリのデフォルトはXRPC (`/xrpc/com.atproto.identity.resolveHandle`) を
 *  叩くが、Cryptonバックエンドは REST (`/v1/atproto/handle/{handle}`) なので
 *  カスタムリゾルバで橋渡しする。 */
function createHandleResolver(apiBase: string): HandleResolver {
  const base = apiBase.startsWith("/")
    ? `${window.location.origin}${apiBase}`
    : apiBase;
  return {
    async resolve(handle, options) {
      const res = await fetch(
        `${base}/v1/atproto/handle/${encodeURIComponent(handle)}`,
        { signal: options?.signal },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { did: string };
      const did = json.did;
      if (!did?.startsWith("did:")) return null;
      return did as Awaited<ReturnType<HandleResolver["resolve"]>>;
    },
  };
}

type AtprotoContextType = {
  isConnected: boolean;
  isLoading: boolean;
  did: string | null;
  handle: string | null;
  agent: Agent | null;
  accounts: AtprotoAccount[];
  /** OAuth認証直後で検証投稿がまだの場合 true */
  needsVerificationPost: boolean;
  completeVerification: () => void;
  login: (handle: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
};

const AtprotoContext = createContext<AtprotoContextType>({
  isConnected: false,
  isLoading: true,
  did: null,
  handle: null,
  agent: null,
  accounts: [],
  needsVerificationPost: false,
  completeVerification: () => {},
  login: async () => {},
  logout: async () => {},
  refreshAccounts: async () => {},
});

function getHostname(): string {
  if (process.env.NEXT_PUBLIC_SERVER_HOSTNAME) {
    return process.env.NEXT_PUBLIC_SERVER_HOSTNAME;
  }
  if (typeof window !== "undefined") {
    return window.location.host;
  }
  return "localhost";
}

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
}

export const AtprotoProvider = ({ children }: { children: ReactNode }) => {
  const { userId, getSignedMessage } = useAuth();
  const { showError } = useErrorToast();

  const [oauthClient, setOauthClient] = useState<BrowserOAuthClient | null>(
    null,
  );
  const [agent, setAgent] = useState<Agent | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accounts, setAccounts] = useState<AtprotoAccount[]>([]);
  const [needsVerificationPost, setNeedsVerificationPost] = useState(false);

  const refreshAccounts = useCallback(async () => {
    if (!userId) return;
    try {
      const signed = await getSignedMessage();
      if (!signed) return;
      const result = await authApiClient(
        signed.signedMessage,
      ).atproto.getAccounts();
      setAccounts(result);
    } catch {
      // アカウント取得失敗は致命的ではない
    }
  }, [userId, getSignedMessage]);

  useEffect(() => {
    if (!userId) {
      setOauthClient(null);
      setAgent(null);
      setDid(null);
      setHandle(null);
      setAccounts([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let clientRef: BrowserOAuthClient | null = null;
    const onDeleted = () => {
      setAgent(null);
      setDid(null);
      setHandle(null);
    };

    (async () => {
      setIsLoading(true);
      try {
        const hostname = getHostname();
        const apiBase = getApiBaseUrl();

        const client = await BrowserOAuthClient.load({
          clientId: `https://${hostname}/oauth-client-metadata.json`,
          handleResolver: createHandleResolver(apiBase),
        });
        clientRef = client;
        if (cancelled) return;
        setOauthClient(client);

        // セッション復元 or OAuthコールバック処理
        const result = await client.init();
        if (cancelled) return;

        if (result?.session) {
          const newAgent = new Agent(result.session);
          setAgent(newAgent);
          setDid(result.session.did);

          // プロフィールからハンドルを取得
          try {
            const profile = await newAgent.getProfile({
              actor: result.session.did,
            });
            setHandle(profile.data.handle);
          } catch {
            // ハンドル取得失敗は致命的ではない
          }

          // OAuthコールバックからの復帰時はアカウント紐付けを自動実行
          if ("state" in result) {
            try {
              const signed = await getSignedMessage();
              if (signed) {
                const pdsUrl =
                  result.session.server?.issuer ?? `https://${hostname}`;
                const profileData = await newAgent.getProfile({
                  actor: result.session.did,
                });
                await authApiClient(signed.signedMessage).atproto.linkAccount(
                  result.session.did,
                  profileData.data.handle,
                  pdsUrl,
                );
              }
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) {
                showError("This DID is already linked to another account.");
              } else if (e instanceof Error) {
                showError(e.message);
              }
            }
            // 検証投稿を要求
            setNeedsVerificationPost(true);
          }

          // セッションイベントリスナー
          client.addEventListener("deleted", onDeleted);
        }

        await refreshAccounts();
      } catch (e) {
        console.error("ATproto init failed:", e);
      } finally {
        if (cancelled) return;
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (clientRef) {
        clientRef.removeEventListener("deleted", onDeleted);
      }
    };
  }, [userId, getSignedMessage, showError, refreshAccounts]);

  const login = useCallback(
    async (inputHandle: string) => {
      if (!oauthClient) throw new Error("OAuth client not initialized");
      const url = await oauthClient.authorize(inputHandle);
      window.open(url, "_self", "noopener");
    },
    [oauthClient],
  );

  const logout = useCallback(async () => {
    setAgent(null);
    setDid(null);
    setHandle(null);
  }, []);

  const completeVerification = useCallback(() => {
    setNeedsVerificationPost(false);
  }, []);

  return (
    <AtprotoContext.Provider
      value={{
        isConnected: !!agent,
        isLoading,
        did,
        handle,
        agent,
        accounts,
        needsVerificationPost,
        completeVerification,
        login,
        logout,
        refreshAccounts,
      }}
    >
      {children}
    </AtprotoContext.Provider>
  );
};

export const useAtproto = () => useContext(AtprotoContext);
