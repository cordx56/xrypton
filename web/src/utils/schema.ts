import { z } from "zod";

export const WorkerResultCallList = {
  generate: "generate",
  export_public_keys: "export_public_keys",
  encrypt: "encrypt",
  encrypt_bin: "encrypt_bin",
  decrypt: "decrypt",
  decrypt_bin: "decrypt_bin",
  unwrap_outer: "unwrap_outer",
  decrypt_bytes: "decrypt_bytes",
  extract_fingerprint: "extract_fingerprint",
  verify: "verify",
  get_primary_fingerprint: "get_primary_fingerprint",
  sign: "sign",
  sign_bytes: "sign_bytes",
  validate_passphrases: "validate_passphrases",
  get_private_key_user_ids: "get_private_key_user_ids",
  verify_extract_string: "verify_extract_string",
  extract_and_verify_string: "extract_and_verify_string",
  verify_extract_bytes: "verify_extract_bytes",
} as const;
export type WorkerResultCall =
  (typeof WorkerResultCallList)[keyof typeof WorkerResultCallList];

// --- WASM return types ---

export const WasmResultData = z.union([
  z.object({ type: z.literal("string"), data: z.string() }),
  z.object({ type: z.literal("base64"), data: z.string() }),
]);

export const WasmReturnValue = z.union([
  z.object({ result: z.literal("ok"), value: z.array(WasmResultData) }),
  z.object({ result: z.literal("error"), message: z.string() }),
]);

// --- Push notification ---

export const Notification = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    sender_id: z.string().optional(),
    sender_name: z.string().optional(),
    chat_id: z.string().optional(),
    thread_id: z.string().optional(),
    message_id: z.string().optional(),
    is_self: z.boolean().optional(),
    recipient_id: z.string().optional(),
  }),
  z.object({
    type: z.literal("added_to_group"),
    chat_id: z.string(),
    name: z.string(),
    recipient_id: z.string().optional(),
  }),
  z.object({
    type: z.literal("new_thread"),
    chat_id: z.string(),
    name: z.string(),
    recipient_id: z.string().optional(),
  }),
  z.object({
    type: z.literal("realtime_offer"),
    chat_id: z.string(),
    session_id: z.string(),
    sender_id: z.string(),
    name: z.string(),
    encrypted: z.string(),
    recipient_id: z.string().optional(),
  }),
  z.object({
    type: z.literal("realtime_answer"),
    chat_id: z.string(),
    session_id: z.string(),
    sender_id: z.string(),
    answer: z.string(),
    recipient_id: z.string().optional(),
  }),
]);

// --- User ID validation ---

/** ローカルパートのバリデーション用正規表現。
 *  許可文字: 英数字, `_`, `.`, `+`, `-`
 *  先頭・末尾のドットは禁止（正規表現で担保）。連続ドットは refine で検査。 */
const LOCAL_PART_RE = /^[a-zA-Z0-9_+\-]([a-zA-Z0-9._+\-]*[a-zA-Z0-9_+\-])?$/;

/** ユーザID: メールローカルパートとして有効な文字、@禁止、予約語禁止 */
export const UserId = z
  .string()
  .regex(LOCAL_PART_RE)
  .refine((s) => !s.includes(".."))
  .refine((s) => !["root", "admin"].includes(s.toLowerCase()), {
    message: "reserved",
  });

/** ユーザIDの表示用変換。ローカルドメインと一致する @domain 部分を省略する。 */
export function displayUserId(userId: string): string {
  const host = typeof window !== "undefined" ? window.location.host : "";
  return userId.endsWith(`@${host}`)
    ? userId.slice(0, -host.length - 1)
    : userId;
}

/** 連絡先検索: ユーザID または ユーザID@ドメイン */
export const ContactQuery = z
  .string()
  .regex(
    /^[a-zA-Z0-9_+\-]([a-zA-Z0-9._+\-]*[a-zA-Z0-9_+\-])?(@[a-zA-Z0-9._\-]+)?$/,
  )
  .refine((s) => !s.split("@")[0].includes(".."));

// --- API request/response schemas ---

// POST /v1/user/{id}/keys
export const PostKeysRequest = z.object({
  encryption_public_key: z.string(),
  signing_public_key: z.string(),
});

// GET /v1/user/{id}/keys
export const GetKeysResponse = z.object({
  id: z.string(),
  encryption_public_key: z.string(),
  signing_public_key: z.string(),
  primary_key_fingerprint: z.string(),
});

// GET/POST /v1/user/{id}/profile
export const Profile = z.object({
  user_id: z.string(),
  display_name: z.string(),
  status: z.string(),
  bio: z.string(),
  icon_url: z.string().nullable(),
});

export const UpdateProfileRequest = z.object({
  display_name: z.string().optional(),
  status: z.string().optional(),
  bio: z.string().optional(),
});

// POST /v1/chat
export const CreateChatRequest = z.object({
  name: z.string(),
  member_ids: z.array(z.string()),
});

export const ChatGroup = z.object({
  id: z.string(),
  name: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

// POST /v1/chat/{chat_id} (create thread)
export const CreateThreadRequest = z.object({
  name: z.string(),
});

export const Thread = z.object({
  id: z.string(),
  chat_id: z.string(),
  name: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

// POST /v1/chat/{chat_id}/{thread_id}/message
export const PostMessageRequest = z.object({
  content: z.string(),
});

export const Message = z.object({
  id: z.string(),
  thread_id: z.string(),
  sender_id: z.string().nullable(),
  content: z.string(),
  created_at: z.string(),
});

// GET /v1/chat/{chat_id}/{thread_id}/message?from=&until=
export const MessageList = z.object({
  messages: z.array(Message),
  total: z.number(),
});

// Chat member
export const ChatMember = z.object({
  chat_id: z.string(),
  user_id: z.string(),
  joined_at: z.string(),
});

// Push subscription
export const PushSubscribeRequest = z.object({
  endpoint: z.string(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

export const NotificationPublicKeyResponse = z.object({
  key: z.string(),
});

// --- ATproto API schemas ---

export const AtprotoAccountSchema = z.object({
  user_id: z.string(),
  atproto_did: z.string(),
  atproto_handle: z.string().nullable(),
  pds_url: z.string(),
  pubkey_post_uri: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const AtprotoSignatureSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  atproto_did: z.string(),
  atproto_uri: z.string(),
  atproto_cid: z.string(),
  collection: z.string(),
  record_json: z.string(),
  signature: z.string(),
  signing_public_key: z.string(),
  created_at: z.string(),
});

export const AtprotoSaveSignatureResponse = z.object({
  id: z.string(),
});

export const AtprotoSignatureBatchResponse = z.object({
  signatures: z.record(z.string(), z.array(AtprotoSignatureSchema)),
});

export const AtprotoSignatureListResponse = z.object({
  signatures: z.array(AtprotoSignatureSchema),
  total: z.number(),
});

// --- X (Twitter) API schemas ---

export const XAccountSchema = z.object({
  user_id: z.string(),
  x_handle: z.string(),
  x_author_url: z.string(),
  x_post_url: z.string(),
  proof_json: z.string(),
  signature: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const XLinkAccountResponse = z.object({
  handle: z.string(),
});

// Old
export const Contacts = z.record(
  z.string(),
  z.object({ name: z.string(), publicKeys: z.string() }),
);

export const WorkerCallMessage = z.union([
  z.object({
    call: z.literal("init"),
    wasmUrl: z.string().nullish(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["generate"]),
    userId: z.string(),
    mainPassphrase: z.string(),
    subPassphrase: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["export_public_keys"]),
    keys: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["encrypt"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    publicKeys: z.string().array(),
    payload: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["encrypt_bin"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    publicKeys: z.string().array(),
    payload: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    knownPublicKeys: Contacts,
    message: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["unwrap_outer"]),
    publicKey: z.string(),
    outerArmored: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt_bin"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    knownPublicKeys: Contacts,
    data: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt_bytes"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    data: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["extract_fingerprint"]),
    armored: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["verify"]),
    passphrase: z.string(),
    publicKeys: z.string(),
    message: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["get_primary_fingerprint"]),
    publicKeys: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["sign"]),
    keys: z.string(),
    passphrase: z.string(),
    payload: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["sign_bytes"]),
    keys: z.string(),
    passphrase: z.string(),
    payload: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["validate_passphrases"]),
    privateKeys: z.string(),
    mainPassphrase: z.string(),
    subPassphrase: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["get_private_key_user_ids"]),
    privateKeys: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["verify_extract_string"]),
    publicKey: z.string(),
    armored: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["extract_and_verify_string"]),
    publicKey: z.string(),
    armored: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["verify_extract_bytes"]),
    publicKey: z.string(),
    data: z.base64(),
  }),
]);

export const WorkerResult = <T>(schema: T) =>
  z.union([
    z.object({
      success: z.literal(true),
      data: schema,
    }),
    z.object({
      success: z.literal(false),
      message: z.string(),
    }),
  ]);
export const WorkerResultMessage = z.union([
  z.object({
    call: z.literal(WorkerResultCallList["generate"]),
    result: WorkerResult(z.object({ keys: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["export_public_keys"]),
    result: WorkerResult(z.object({ keys: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["encrypt"]),
    result: WorkerResult(z.object({ message: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["encrypt_bin"]),
    result: WorkerResult(z.object({ data: z.base64() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt"]),
    result: WorkerResult(
      z.object({ fingerprints: z.string().array(), payload: z.base64url() }),
    ),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["unwrap_outer"]),
    result: WorkerResult(
      z.object({ innerBytes: z.base64(), outerFingerprint: z.string() }),
    ),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt_bin"]),
    result: WorkerResult(
      z.object({ fingerprints: z.string().array(), payload: z.base64url() }),
    ),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt_bytes"]),
    result: WorkerResult(
      z.object({ fingerprints: z.string().array(), payload: z.base64url() }),
    ),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["extract_fingerprint"]),
    result: WorkerResult(z.object({ fingerprint: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["get_primary_fingerprint"]),
    result: WorkerResult(z.object({ fingerprint: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["sign"]),
    result: WorkerResult(z.object({ signed_message: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["sign_bytes"]),
    result: WorkerResult(z.object({ data: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["validate_passphrases"]),
    result: WorkerResult(z.object({})),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["get_private_key_user_ids"]),
    result: WorkerResult(z.object({ user_ids: z.string().array() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["verify_extract_string"]),
    result: WorkerResult(z.object({ plaintext: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["extract_and_verify_string"]),
    result: WorkerResult(
      z.object({ plaintext: z.string(), verified: z.boolean() }),
    ),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["verify_extract_bytes"]),
    result: WorkerResult(
      z.object({ data: z.base64(), fingerprint: z.string() }),
    ),
  }),
]);
