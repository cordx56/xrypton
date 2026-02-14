export type UserKeys = {
  id: string;
  encryption_public_key: string;
  signing_public_key: string;
  signing_key_id: string;
};

export type UserProfile = {
  user_id: string;
  display_name: string;
  status: string;
  bio: string;
  icon_url: string | null;
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
  iconUrl?: string | null;
};
