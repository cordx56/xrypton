import {
  NotificationPublicKeyResponse,
  SecretKeyBackupBody,
  SecretKeyBackupResponse,
  AtprotoAccountSchema,
  AtprotoSignatureSchema,
  AtprotoSignatureBatchResponse,
  AtprotoSignatureListResponse,
  AtprotoSaveSignatureResponse,
  XAccountSchema,
  XLinkAccountResponse,
} from "@/utils/schema";

export type WotNode = {
  fingerprint: string;
  user_id: string | null;
  revoked: boolean;
};

export type WotEdge = {
  signature_id: string;
  from_fingerprint: string;
  to_fingerprint: string;
  signature_b64: string;
  signature_hash: string;
  received_at: string;
  revoked: boolean;
};

export type WotGraphResponse = {
  root_fingerprint: string;
  query: {
    max_depth: number;
    max_nodes: number;
    max_edges: number;
    direction: "inbound" | "outbound" | "both";
  };
  nodes: WotNode[];
  edges: WotEdge[];
  meta: {
    server_time: string;
    truncated: boolean;
    next_cursor: string | null;
    limits_applied: {
      depth_capped: boolean;
      node_capped: boolean;
      edge_capped: boolean;
      time_budget_ms: number;
    };
    data_freshness_sec: number;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly errorMessage: string;
  constructor(status: number, errorMessage: string) {
    super(`API error ${status}: ${errorMessage}`);
    this.name = "ApiError";
    this.status = status;
    this.errorMessage = errorMessage;
  }
}

type FreshFetchOption = {
  fresh?: boolean;
};

function withFreshPath(path: string, fresh?: boolean): string {
  if (!fresh) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}_=${Date.now()}`;
}

function freshRequestInit(fresh?: boolean): RequestInit {
  return fresh ? { cache: "no-store" } : {};
}

/**
 * APIベースURLを取得する。
 * NEXT_PUBLIC_API_BASE_URL が設定されていればそれを使い、
 * なければ /api （Next.jsのrewriteでバックエンドへ転送される）を返す。
 */
export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
}

/**
 * 認証ヘッダ付きfetchラッパー。
 * signedMessage が渡された場合、Authorization を付与する。
 */
async function apiFetch(
  path: string,
  options: RequestInit = {},
  auth?: { signedMessage: string },
  baseUrlOverride?: string,
): Promise<Response> {
  const baseUrl = baseUrlOverride ?? getApiBaseUrl();

  const headers = new Headers(options.headers);
  if (auth) {
    headers.set("Authorization", btoa(auth.signedMessage));
  }
  if (
    options.body &&
    typeof options.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  // baseUrlにパスプレフィクスが含まれる場合を考慮し、単純連結でURLを構築する。
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const url = `${normalizedBaseUrl}${path}`;

  const resp = await fetch(url, {
    ...options,
    headers,
  });

  if (!resp.ok) {
    let errorMessage = "";
    try {
      const json = await resp.json();
      errorMessage = json.error ?? JSON.stringify(json);
    } catch {
      errorMessage = await resp.text().catch(() => "");
    }
    throw new ApiError(resp.status, errorMessage);
  }

  return resp;
}

/** 認証不要のAPIクライアント */
export function apiClient() {
  return {
    user: {
      postKeys: async (
        userId: string,
        encryptionPublicKey: string,
        signingPublicKey: string,
      ) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(userId)}/keys`,
          {
            method: "POST",
            body: JSON.stringify({
              encryption_public_key: encryptionPublicKey,
              signing_public_key: signingPublicKey,
            }),
          },
        );
        return resp.json();
      },
      getProfile: async (userId: string, options?: FreshFetchOption) => {
        const resp = await apiFetch(
          withFreshPath(
            `/v1/user/${encodeURIComponent(userId)}/profile`,
            options?.fresh,
          ),
          freshRequestInit(options?.fresh),
        );
        return resp.json();
      },
      getKeys: async (userId: string, options?: FreshFetchOption) => {
        const resp = await apiFetch(
          withFreshPath(
            `/v1/user/${encodeURIComponent(userId)}/keys`,
            options?.fresh,
          ),
          freshRequestInit(options?.fresh),
        );
        return resp.json();
      },
      getSecretKeyBackup: async (id: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/secret-key-backup`,
        );
        return SecretKeyBackupResponse.parse(await resp.json());
      },
    },
    wot: {
      getKeyByFingerprint: async (
        fingerprint: string,
        baseUrlOverride?: string,
      ) => {
        const resp = await apiFetch(
          `/v1/keys/${encodeURIComponent(fingerprint)}`,
          {},
          undefined,
          baseUrlOverride,
        );
        return resp.json();
      },
    },
    notification: {
      publicKey: async (): Promise<string> => {
        const resp = await apiFetch("/notification/public-key");
        const data = NotificationPublicKeyResponse.parse(await resp.json());
        return data.key;
      },
    },
    atproto: {
      getSignature: async (
        uri: string,
        cid?: string,
        options?: FreshFetchOption,
      ) => {
        const params = new URLSearchParams({ uri });
        if (cid) params.set("cid", cid);
        const resp = await apiFetch(
          withFreshPath(`/v1/atproto/signature?${params}`, options?.fresh),
          freshRequestInit(options?.fresh),
        );
        const json = await resp.json();
        return AtprotoSignatureSchema.array().parse(json.signatures);
      },
      getSignatureBatch: async (uris: string[]) => {
        const params = new URLSearchParams();
        uris.forEach((u) => params.append("uris", u));
        const resp = await apiFetch(`/v1/atproto/signature/batch?${params}`);
        const data = AtprotoSignatureBatchResponse.parse(await resp.json());
        return data.signatures;
      },
      getUserSignatures: async (
        userId: string,
        params?: { limit?: number; offset?: number },
      ) => {
        const search = new URLSearchParams();
        if (params?.limit) search.set("limit", String(params.limit));
        if (params?.offset) search.set("offset", String(params.offset));
        const qs = search.toString() ? `?${search}` : "";
        const resp = await apiFetch(
          `/v1/atproto/signature/user/${encodeURIComponent(userId)}${qs}`,
        );
        return AtprotoSignatureListResponse.parse(await resp.json());
      },
    },
  };
}

/** 認証付きAPIクライアント */
export function authApiClient(signedMessage: string) {
  const auth = { signedMessage };

  return {
    user: {
      getKeys: async (userId: string, options?: FreshFetchOption) => {
        const resp = await apiFetch(
          withFreshPath(
            `/v1/user/${encodeURIComponent(userId)}/keys`,
            options?.fresh,
          ),
          freshRequestInit(options?.fresh),
          auth,
        );
        return resp.json();
      },
      updateProfile: async (
        id: string,
        body: {
          display_name?: string;
          display_name_signature?: string;
          status?: string;
          status_signature?: string;
          bio?: string;
          bio_signature?: string;
        },
      ) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/profile`,
          { method: "POST", body: JSON.stringify(body) },
          auth,
        );
        return resp.json();
      },
      updateKeys: async (
        id: string,
        encryptionPublicKey: string,
        signingPublicKey: string,
      ) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/keys`,
          {
            method: "PUT",
            body: JSON.stringify({
              encryption_public_key: encryptionPublicKey,
              signing_public_key: signingPublicKey,
            }),
          },
          auth,
        );
        return resp.json();
      },
      deleteUser: async (id: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/keys`,
          { method: "DELETE" },
          auth,
        );
        return resp.json();
      },
      uploadIcon: async (id: string, blob: Blob, iconSignature: string) => {
        const formData = new FormData();
        formData.append("icon", blob);
        formData.append("icon_signature", iconSignature);
        const baseUrl = getApiBaseUrl();
        const url = baseUrl.startsWith("/")
          ? `${baseUrl}/v1/user/${encodeURIComponent(id)}/icon`
          : new URL(
              `/v1/user/${encodeURIComponent(id)}/icon`,
              baseUrl,
            ).toString();
        const headers = new Headers();
        headers.set("Authorization", btoa(auth.signedMessage));
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
        });
        if (!resp.ok) {
          let errorMessage = "";
          try {
            const json = await resp.json();
            errorMessage = json.error ?? JSON.stringify(json);
          } catch {
            errorMessage = await resp.text().catch(() => "");
          }
          throw new ApiError(resp.status, errorMessage);
        }
        return resp.json();
      },
      getIconUrl: (id: string) => {
        return `${getApiBaseUrl()}/v1/user/${encodeURIComponent(id)}/icon`;
      },
      putSecretKeyBackup: async (
        id: string,
        body: {
          armor: string;
          version: number;
          webauthn_credential_id_b64: string;
        },
      ) => {
        const payload = SecretKeyBackupBody.parse(body);
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/secret-key-backup`,
          { method: "PUT", body: JSON.stringify(payload) },
          auth,
        );
        return SecretKeyBackupResponse.parse(await resp.json());
      },
      getSecretKeyBackup: async (id: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/secret-key-backup`,
          {},
          auth,
        );
        return SecretKeyBackupResponse.parse(await resp.json());
      },
      deleteSecretKeyBackup: async (id: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(id)}/secret-key-backup`,
          { method: "DELETE" },
          auth,
        );
        return resp.json();
      },
    },
    chat: {
      list: async () => {
        const resp = await apiFetch("/v1/chat", {}, auth);
        return resp.json();
      },
      create: async (name: string, memberIds: string[]) => {
        const resp = await apiFetch(
          "/v1/chat",
          {
            method: "POST",
            body: JSON.stringify({ name, member_ids: memberIds }),
          },
          auth,
        );
        return resp.json();
      },
      get: async (chatId: string) => {
        const resp = await apiFetch(`/v1/chat/${chatId}`, {}, auth);
        return resp.json();
      },
      createThread: async (chatId: string, name: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}`,
          { method: "POST", body: JSON.stringify({ name }) },
          auth,
        );
        return resp.json();
      },
      archive: async (chatId: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/archive`,
          { method: "POST" },
          auth,
        );
        return resp.json();
      },
      unarchive: async (chatId: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/unarchive`,
          { method: "POST" },
          auth,
        );
        return resp.json();
      },
      listArchived: async () => {
        const resp = await apiFetch("/v1/chat/archived", {}, auth);
        return resp.json();
      },
    },
    realtime: {
      start: async (
        chatId: string,
        name: string,
        encrypted: Record<string, string>,
      ) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/realtime`,
          { method: "POST", body: JSON.stringify({ name, encrypted }) },
          auth,
        );
        return resp.json();
      },
      answer: async (
        chatId: string,
        sessionId: string,
        toUserId: string,
        answer: string,
      ) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/realtime/${sessionId}/answer`,
          {
            method: "POST",
            body: JSON.stringify({ to_user_id: toUserId, answer }),
          },
          auth,
        );
        return resp.json();
      },
    },
    thread: {
      get: async (chatId: string, threadId: string) => {
        const resp = await apiFetch(`/v1/chat/${chatId}/${threadId}`, {}, auth);
        return resp.json();
      },
      updateName: async (chatId: string, threadId: string, name: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/${threadId}`,
          { method: "POST", body: JSON.stringify({ name }) },
          auth,
        );
        return resp.json();
      },
      archive: async (chatId: string, threadId: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/${threadId}/archive`,
          { method: "POST" },
          auth,
        );
        return resp.json();
      },
      unarchive: async (chatId: string, threadId: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/${threadId}/unarchive`,
          { method: "POST" },
          auth,
        );
        return resp.json();
      },
    },
    message: {
      get: async (chatId: string, threadId: string, messageId: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/${threadId}/message/${messageId}`,
          {},
          auth,
        );
        return resp.json();
      },
      list: async (chatId: string, threadId: string, from = -20, until = 0) => {
        const params = new URLSearchParams({
          from: from.toString(),
          until: until.toString(),
        });
        const resp = await apiFetch(
          `/v1/chat/${chatId}/${threadId}/message?${params}`,
          {},
          auth,
        );
        return resp.json();
      },
      send: async (chatId: string, threadId: string, content: string) => {
        const resp = await apiFetch(
          `/v1/chat/${chatId}/${threadId}/message`,
          { method: "POST", body: JSON.stringify({ content }) },
          auth,
        );
        return resp.json();
      },
    },
    contacts: {
      list: async () => {
        const resp = await apiFetch("/v1/contacts", {}, auth);
        return resp.json();
      },
      add: async (userId: string) => {
        const resp = await apiFetch(
          "/v1/contacts",
          { method: "POST", body: JSON.stringify({ user_id: userId }) },
          auth,
        );
        return resp.json();
      },
      delete: async (contactUserId: string) => {
        const resp = await apiFetch(
          `/v1/contacts/${encodeURIComponent(contactUserId)}`,
          { method: "DELETE" },
          auth,
        );
        return resp.json();
      },
    },
    wot: {
      getSignaturesByFingerprint: async (
        fingerprint: string,
        params?: {
          max_depth?: number;
          max_nodes?: number;
          max_edges?: number;
          direction?: "inbound" | "outbound" | "both";
        },
      ): Promise<WotGraphResponse> => {
        const search = new URLSearchParams();
        if (params?.max_depth)
          search.set("max_depth", String(params.max_depth));
        if (params?.max_nodes)
          search.set("max_nodes", String(params.max_nodes));
        if (params?.max_edges)
          search.set("max_edges", String(params.max_edges));
        if (params?.direction) search.set("direction", params.direction);
        const qs = search.toString() ? `?${search}` : "";
        const resp = await apiFetch(
          `/v1/keys/${encodeURIComponent(fingerprint)}/signatures${qs}`,
          {},
          auth,
        );
        return resp.json();
      },
      postSignatureByFingerprint: async (
        fingerprint: string,
        body: {
          signature_b64: string;
          signature_type: "certification";
          hash_algo: "sha256";
          qr_nonce: { random: string; time: string };
        },
        baseUrlOverride?: string,
      ) => {
        const resp = await apiFetch(
          `/v1/keys/${encodeURIComponent(fingerprint)}/signature`,
          { method: "POST", body: JSON.stringify(body) },
          auth,
          baseUrlOverride,
        );
        return resp.json();
      },
    },
    file: {
      upload: async (
        chatId: string,
        threadId: string,
        metadata: string,
        fileBlob: Blob,
      ) => {
        const formData = new FormData();
        formData.append("metadata", metadata);
        formData.append("file", fileBlob);
        const baseUrl = getApiBaseUrl();
        const url = baseUrl.startsWith("/")
          ? `${baseUrl}/v1/chat/${chatId}/${threadId}/file`
          : new URL(`/v1/chat/${chatId}/${threadId}/file`, baseUrl).toString();
        const headers = new Headers();
        headers.set("Authorization", btoa(auth.signedMessage));
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
        });
        if (!resp.ok) {
          let errorMessage = "";
          try {
            const json = await resp.json();
            errorMessage = json.error ?? JSON.stringify(json);
          } catch {
            errorMessage = await resp.text().catch(() => "");
          }
          throw new ApiError(resp.status, errorMessage);
        }
        return resp.json();
      },
      download: async (fileId: string): Promise<ArrayBuffer> => {
        const resp = await apiFetch(`/v1/file/${fileId}`, {}, auth);
        return resp.arrayBuffer();
      },
    },
    notification: {
      subscribe: async (subscription: PushSubscription) => {
        const json = subscription.toJSON();
        await apiFetch(
          "/v1/notification/subscribe",
          {
            method: "POST",
            body: JSON.stringify({
              endpoint: json.endpoint,
              keys: json.keys,
            }),
          },
          auth,
        );
      },
    },
    atproto: {
      linkAccount: async (did: string, handle: string, pdsUrl: string) => {
        const resp = await apiFetch(
          "/v1/atproto/account",
          {
            method: "POST",
            body: JSON.stringify({
              atproto_did: did,
              atproto_handle: handle,
              pds_url: pdsUrl,
            }),
          },
          auth,
        );
        return AtprotoAccountSchema.parse(await resp.json());
      },
      getAccounts: async () => {
        const resp = await apiFetch("/v1/atproto/account", {}, auth);
        const json = await resp.json();
        return AtprotoAccountSchema.array().parse(json.accounts ?? json);
      },
      unlinkAccount: async (did: string) => {
        await apiFetch(
          `/v1/atproto/account/${encodeURIComponent(did)}`,
          { method: "DELETE" },
          auth,
        );
      },
      saveSignature: async (body: {
        atproto_did: string;
        atproto_uri: string;
        atproto_cid: string;
        collection: string;
        record_json: string;
        signature: string;
        is_pubkey_post?: boolean;
      }) => {
        const resp = await apiFetch(
          "/v1/atproto/signature",
          { method: "POST", body: JSON.stringify(body) },
          auth,
        );
        return AtprotoSaveSignatureResponse.parse(await resp.json());
      },
    },
    x: {
      linkAccount: async (body: {
        author_url: string;
        post_url: string;
        proof_json: string;
        signature: string;
      }) => {
        const resp = await apiFetch(
          "/v1/x/account",
          { method: "POST", body: JSON.stringify(body) },
          auth,
        );
        return XLinkAccountResponse.parse(await resp.json());
      },
      getAccounts: async () => {
        const resp = await apiFetch("/v1/x/account", {}, auth);
        const json = await resp.json();
        return XAccountSchema.array().parse(
          Array.isArray(json) ? json : (json.accounts ?? json),
        );
      },
      unlinkAccount: async (handle: string) => {
        await apiFetch(
          `/v1/x/account/${encodeURIComponent(handle)}`,
          { method: "DELETE" },
          auth,
        );
      },
    },
  };
}
