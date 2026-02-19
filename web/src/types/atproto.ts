// Xrypton server-side account linking information (accounts API)
export type AtprotoAccount = {
  user_id: string;
  atproto_did: string;
  atproto_handle: string | null;
  pds_url: string;
  pubkey_post_uri: string | null;
  created_at: string;
  updated_at: string;
};

// プロフィールに埋め込まれるpubkey投稿の署名データ
export type EmbeddedAtprotoSignature = {
  atproto_uri: string;
  atproto_cid: string;
  record_json: string;
  signature: string;
  signing_public_key: string;
};

// Profile API の external_accounts に含まれるATProtoアカウント情報
export type ExternalAtprotoAccount = {
  type: "atproto";
  did: string;
  handle: string | null;
  pds_url: string;
  pubkey_post_uri: string | null;
  pubkey_post_signature?: EmbeddedAtprotoSignature;
};

// Profile API の external_accounts に含まれるXアカウント情報
export type ExternalXAccount = {
  type: "x";
  handle: string;
  author_url: string;
  post_url: string;
  proof_json?: string;
  signature?: string;
};

// 外部アカウントのunion型
export type ExternalAccount = ExternalAtprotoAccount | ExternalXAccount;

// Xrypton server-side signature record
export type AtprotoSignature = {
  id: string;
  user_id: string;
  atproto_did: string;
  atproto_uri: string;
  atproto_cid: string;
  collection: string;
  record_json: string;
  signature: string;
  signing_public_key: string;
  created_at: string;
};

export type VerificationLevel = "verified" | "mismatch" | "none";
