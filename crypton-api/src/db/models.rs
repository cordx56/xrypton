use serde::Serialize;

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
    pub signing_key_id: String,
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
    pub created_by: String,
    pub created_at: Timestamp,
    pub archived_at: Option<Timestamp>,
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
    pub created_by: String,
    pub created_at: Timestamp,
    pub archived_at: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MessageRow {
    pub id: String,
    pub thread_id: String,
    pub sender_id: String,
    pub content: String,
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
