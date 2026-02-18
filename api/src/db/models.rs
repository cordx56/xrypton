use serde::{Deserialize, Serialize};

/// SQLite では TEXT として格納されるため String、
/// PostgreSQL では TIMESTAMPTZ として格納されるため chrono 型を使用。
#[cfg(not(feature = "postgres"))]
pub type Timestamp = String;
#[cfg(feature = "postgres")]
pub type Timestamp = chrono::DateTime<chrono::Utc>;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct UserRow {
    pub id: String,
    pub encryption_public_key: String,
    pub signing_public_key: String,
    pub primary_key_fingerprint: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ProfileRow {
    pub user_id: String,
    pub display_name: String,
    pub status: String,
    pub bio: String,
    pub icon_key: Option<String>,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ChatGroupRow {
    pub id: String,
    pub name: String,
    pub created_by: Option<String>,
    pub created_at: Timestamp,
    pub archived_at: Option<Timestamp>,
    pub server_domain: Option<String>,
    /// 最終メッセージ日時（リスト取得時のみサブクエリで算出）
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ChatMemberRow {
    pub chat_id: String,
    pub user_id: String,
    pub joined_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ThreadRow {
    pub id: String,
    pub chat_id: String,
    pub name: String,
    pub created_by: Option<String>,
    pub created_at: Timestamp,
    pub archived_at: Option<Timestamp>,
    pub expires_at: Option<Timestamp>,
    /// 最終メッセージ日時（リスト取得時のみサブクエリで算出）
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MessageRow {
    pub id: String,
    pub thread_id: String,
    pub sender_id: Option<String>,
    pub content: String,
    pub file_id: Option<String>,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FileRow {
    pub id: String,
    pub chat_id: String,
    pub s3_key: String,
    pub size: i32,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PushSubscriptionRow {
    pub id: String,
    pub user_id: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ContactRow {
    pub user_id: String,
    pub contact_user_id: String,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AtprotoAccountRow {
    pub user_id: String,
    pub atproto_did: String,
    pub atproto_handle: Option<String>,
    pub pds_url: String,
    pub pubkey_post_uri: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AtprotoSignatureRow {
    pub id: String,
    pub user_id: String,
    pub atproto_did: String,
    pub atproto_uri: String,
    pub atproto_cid: String,
    pub collection: String,
    pub record_json: String,
    pub signature: String,
    pub created_at: Timestamp,
}

/// 署名取得時に公開鍵をJOINして返す用の型
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AtprotoSignatureWithKeyRow {
    pub id: String,
    pub user_id: String,
    pub atproto_did: String,
    pub atproto_uri: String,
    pub atproto_cid: String,
    pub collection: String,
    pub record_json: String,
    pub signature: String,
    pub created_at: Timestamp,
    pub signing_public_key: String,
}

// --- X (Twitter) アカウント ---

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct XAccountRow {
    pub user_id: String,
    pub x_handle: String,
    pub x_author_url: String,
    pub x_post_url: String,
    pub proof_json: String,
    pub signature: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

// --- 外部アカウント ---

/// プロフィールレスポンスに含める外部アカウント情報
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExternalAccount {
    Atproto {
        did: String,
        handle: Option<String>,
        pds_url: String,
        pubkey_post_uri: Option<String>,
    },
    X {
        handle: String,
        author_url: String,
        post_url: String,
    },
}

impl From<AtprotoAccountRow> for ExternalAccount {
    fn from(a: AtprotoAccountRow) -> Self {
        Self::Atproto {
            did: a.atproto_did,
            handle: a.atproto_handle,
            pds_url: a.pds_url,
            pubkey_post_uri: a.pubkey_post_uri,
        }
    }
}

impl From<XAccountRow> for ExternalAccount {
    fn from(a: XAccountRow) -> Self {
        Self::X {
            handle: a.x_handle,
            author_url: a.x_author_url,
            post_url: a.x_post_url,
        }
    }
}
