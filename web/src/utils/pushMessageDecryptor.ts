import { z } from "zod";
import { Notification, WasmReturnValue } from "@/utils/schema";
import { base64ToBytes, decodeBase64Url } from "@/utils/base64";
import { buildAuthPayload } from "@/utils/authPayload";
import { getKey } from "@/utils/keyStore";
import initWasm, {
  decrypt_bytes,
  extract_fingerprint,
  sign,
  unwrap_outer,
  verify_detached_signature,
} from "xrypton-wasm";

type PushNotification = z.infer<typeof Notification>;
type PushMessageNotification = Extract<PushNotification, { type: "message" }>;

export type PushDecryptSecrets = {
  privateKeys: string;
  subPassphrase: string;
};

type ParsedMessageTarget = {
  chatId: string;
  threadId: string;
  messageId: string;
};

type TryDecryptPushMessageBodyOptions = {
  origin: string;
  signedMessage?: string;
  senderSigningPublicKey?: string;
  secrets?: PushDecryptSecrets;
  resolveSecrets?: (
    notification: PushMessageNotification,
  ) => Promise<PushDecryptSecrets | null>;
};

let wasmInitPromise: Promise<boolean> | null = null;
let wasmInitialized = false;

const parseWasmOk = (
  value: unknown,
):
  | {
      ok: true;
      data: z.infer<typeof WasmReturnValue> & { result: "ok" };
    }
  | { ok: false; message: string } => {
  const parsed = WasmReturnValue.safeParse(value);
  if (!parsed.success) {
    return { ok: false, message: "invalid wasm response" };
  }
  if (parsed.data.result !== "ok") {
    return { ok: false, message: parsed.data.message };
  }
  return {
    ok: true,
    data: parsed.data,
  };
};

const ensureWasmInitialized = async (): Promise<boolean> => {
  if (wasmInitialized) return true;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      await initWasm();
      wasmInitialized = true;
      return true;
    } catch {
      return false;
    } finally {
      wasmInitPromise = null;
    }
  })();

  return wasmInitPromise;
};

const getMessageTarget = (
  notification: PushNotification,
): ParsedMessageTarget | null => {
  if (notification.type !== "message") return null;
  if (
    !notification.chat_id ||
    !notification.thread_id ||
    !notification.message_id
  ) {
    return null;
  }
  return {
    chatId: notification.chat_id,
    threadId: notification.thread_id,
    messageId: notification.message_id,
  };
};

const decodeSignedMessage = (base64urlArmored: string): string | null => {
  try {
    return decodeBase64Url(base64urlArmored);
  } catch {
    return null;
  }
};

const signAuthPayload = (secrets: PushDecryptSecrets): string | null => {
  const payload = new TextEncoder().encode(buildAuthPayload());
  const signedRaw = sign(secrets.privateKeys, secrets.subPassphrase, payload);
  const signed = parseWasmOk(signedRaw);
  if (!signed.ok) {
    throw new Error(`auth sign failed: ${signed.message}`);
  }
  if (signed.data.value[0]?.type !== "base64") {
    throw new Error("auth sign failed: invalid data type");
  }
  return decodeSignedMessage(signed.data.value[0].data);
};

const fetchEncryptedMessageContent = async (
  origin: string,
  signedMessage: string,
  notification: PushMessageNotification,
): Promise<string | null> => {
  const target = getMessageTarget(notification);
  if (!target) return null;

  const path = `/api/v1/chat/${encodeURIComponent(target.chatId)}/${encodeURIComponent(target.threadId)}/message/${encodeURIComponent(target.messageId)}`;
  const response = await fetch(`${origin}${path}`, {
    headers: {
      Authorization: btoa(signedMessage),
    },
  });

  if (!response.ok) {
    throw new Error(`message fetch failed with status ${response.status}`);
  }

  const json = (await response.json()) as { content?: unknown };
  return typeof json.content === "string" ? json.content : null;
};

const fetchSenderSigningPublicKey = async (
  origin: string,
  senderId: string,
): Promise<string | null> => {
  const path = `/api/v1/user/${encodeURIComponent(senderId)}/keys`;
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) {
    throw new Error(`sender key fetch failed with status ${response.status}`);
  }
  const json = (await response.json()) as { signing_public_key?: unknown };
  return typeof json.signing_public_key === "string"
    ? json.signing_public_key
    : null;
};

const decryptMessageBody = (
  encrypted: string,
  senderSigningPublicKey: string,
  secrets: PushDecryptSecrets,
): string => {
  const outerFingerprintRaw = extract_fingerprint(encrypted);
  const outerFingerprint = parseWasmOk(outerFingerprintRaw);
  if (!outerFingerprint.ok) {
    throw new Error(`extract fingerprint failed: ${outerFingerprint.message}`);
  }
  if (outerFingerprint.data.value[0]?.type !== "string") {
    throw new Error("extract fingerprint failed: invalid data type");
  }
  const outerSignerFingerprint = outerFingerprint.data.value[0].data;

  const unwrapRaw = unwrap_outer(senderSigningPublicKey, encrypted);
  const unwrapResult = parseWasmOk(unwrapRaw);
  if (!unwrapResult.ok) {
    throw new Error(`outer unwrap failed: ${unwrapResult.message}`);
  }
  if (unwrapResult.data.value[0]?.type !== "base64") {
    throw new Error("outer unwrap failed: invalid data type");
  }

  const innerBytes = base64ToBytes(unwrapResult.data.value[0].data);
  const decryptRaw = decrypt_bytes(
    secrets.privateKeys,
    secrets.subPassphrase,
    innerBytes,
  );
  const decryptResult = parseWasmOk(decryptRaw);
  if (!decryptResult.ok) {
    throw new Error(`inner decrypt failed: ${decryptResult.message}`);
  }
  if (decryptResult.data.value[0]?.type !== "base64") {
    throw new Error("inner decrypt failed: invalid data type");
  }

  if (decryptResult.data.value.length > 1) {
    const detached = decryptResult.data.value[1];
    if (!detached || detached.type !== "base64") {
      throw new Error("inner signature missing");
    }

    const innerSigners = decryptResult.data.value
      .slice(2)
      .map((entry) => (entry.type === "string" ? entry.data : ""));
    if (!innerSigners.includes(outerSignerFingerprint)) {
      throw new Error("signer mismatch between outer and inner payload");
    }

    const verifyRaw = verify_detached_signature(
      senderSigningPublicKey,
      detached.data,
      base64ToBytes(decryptResult.data.value[0].data),
    );
    const verifyResult = parseWasmOk(verifyRaw);
    if (!verifyResult.ok) {
      throw new Error(`inner signature verify failed: ${verifyResult.message}`);
    }
  }

  return new TextDecoder().decode(
    base64ToBytes(decryptResult.data.value[0].data),
  );
};

export const loadPushDecryptSecretsFromStore = async (
  recipientId?: string,
): Promise<PushDecryptSecrets | null> => {
  const loadForAccountId = async (
    accountId: string,
  ): Promise<PushDecryptSecrets | null> => {
    const [privateKeys, subPassphrase] = await Promise.all([
      getKey(`account:${accountId}:privateKeys`),
      getKey(`account:${accountId}:subPassphrase`),
    ]);
    if (!privateKeys || !subPassphrase) return null;
    return { privateKeys, subPassphrase };
  };

  if (recipientId) {
    const byRecipient = await loadForAccountId(recipientId);
    if (byRecipient) return byRecipient;
  }

  const activeAccountId = await getKey("activeAccountId");
  if (activeAccountId) {
    const byActive = await loadForAccountId(activeAccountId);
    if (byActive) return byActive;
  }

  const [legacyPrivateKeys, legacySubPassphrase] = await Promise.all([
    getKey("privateKeys"),
    getKey("subPassphrase"),
  ]);
  if (!legacyPrivateKeys || !legacySubPassphrase) return null;

  return {
    privateKeys: legacyPrivateKeys,
    subPassphrase: legacySubPassphrase,
  };
};

export const tryDecryptPushMessageBody = async (
  notification: PushNotification,
  options: TryDecryptPushMessageBodyOptions,
): Promise<string | null> => {
  if (notification.type !== "message") return null;
  if (!notification.sender_id) return null;

  try {
    const initialized = await ensureWasmInitialized();
    if (!initialized) return null;

    const secrets =
      options.secrets ??
      (options.resolveSecrets
        ? await options.resolveSecrets(notification)
        : await loadPushDecryptSecretsFromStore(notification.recipient_id));
    if (!secrets) return null;

    const signedMessage = options.signedMessage ?? signAuthPayload(secrets);
    if (!signedMessage) return null;

    const encrypted = await fetchEncryptedMessageContent(
      options.origin,
      signedMessage,
      notification,
    );
    if (!encrypted) return null;

    const senderSigningPublicKey =
      options.senderSigningPublicKey ??
      (await fetchSenderSigningPublicKey(
        options.origin,
        notification.sender_id,
      ));
    if (!senderSigningPublicKey) return null;

    const decrypted = decryptMessageBody(
      encrypted,
      senderSigningPublicKey,
      secrets,
    );
    const trimmed = decrypted.trim();
    return trimmed || null;
  } catch {
    return null;
  }
};
