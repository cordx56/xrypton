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

// Profile API の external_accounts に含まれるATProtoアカウント情報
export type ExternalAtprotoAccount = {
  type: "atproto";
  did: string;
  handle: string | null;
  pds_url: string;
  pubkey_post_uri: string | null;
};

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
