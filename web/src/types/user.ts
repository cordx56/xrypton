export type UserKeys = {
  id: string;
  encryption_public_key: string;
  signing_public_key: string;
  primary_key_fingerprint: string;
};

export type UserProfile = {
  user_id: string;
  display_name: string;
  display_name_signature: string;
  status: string;
  status_signature: string;
  bio: string;
  bio_signature: string;
  icon_url: string | null;
  icon_signature: string;
};

export type Account = {
  id: string;
  privateKeys: string;
  subPassphrase: string;
  publicKeys?: string;
};

/** アカウントセレクタ表示用のキャッシュ情報 */
export type AccountInfo = {
  userId: string;
  displayName?: string;
  displayNameSignature?: string | null;
  iconUrl?: string | null;
  iconSignature?: string | null;
  signingPublicKey?: string;
};
