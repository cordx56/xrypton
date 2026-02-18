import {
  NotificationPublicKeyResponse,
  AtprotoAccountSchema,
  AtprotoSignatureSchema,
  AtprotoSignatureBatchResponse,
  AtprotoSignatureListResponse,
  AtprotoSaveSignatureResponse,
} from "@/utils/schema";

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
): Promise<Response> {
  const baseUrl = getApiBaseUrl();

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

  // 相対パスの場合はそのまま連結、絶対URLの場合はURL constructorを使用
  const url = baseUrl.startsWith("/")
    ? `${baseUrl}${path}`
    : new URL(path, baseUrl).toString();

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
      getProfile: async (userId: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(userId)}/profile`,
        );
        return resp.json();
      },
      getKeys: async (userId: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(userId)}/keys`,
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
      getSignature: async (uri: string, cid?: string) => {
        const params = new URLSearchParams({ uri });
        if (cid) params.set("cid", cid);
        const resp = await apiFetch(`/v1/atproto/signature?${params}`);
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
      getKeys: async (userId: string) => {
        const resp = await apiFetch(
          `/v1/user/${encodeURIComponent(userId)}/keys`,
          {},
          auth,
        );
        return resp.json();
      },
      updateProfile: async (
        id: string,
        body: { display_name?: string; status?: string; bio?: string },
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
      uploadIcon: async (id: string, blob: Blob) => {
        const formData = new FormData();
        formData.append("icon", blob);
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
  };
}
