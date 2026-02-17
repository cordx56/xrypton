// Xrypton server-side account linking information
export type AtprotoAccount = {
  user_id: string;
  atproto_did: string;
  atproto_handle: string | null;
  pds_url: string;
  pubkey_post_uri: string | null;
  created_at: string;
  updated_at: string;
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
