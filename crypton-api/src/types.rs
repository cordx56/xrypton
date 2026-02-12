use serde::{Deserialize, Serialize};

macro_rules! newtype_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn new_v4() -> Self {
                Self(uuid::Uuid::new_v4().to_string())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<String> for $name {
            fn from(s: String) -> Self {
                Self(s)
            }
        }
    };
}

newtype_id!(UserId);
newtype_id!(ChatId);

impl UserId {
    /// ユーザIDの形式を検証（英数字とアンダースコアのみ）
    pub fn validate(s: &str) -> Result<Self, String> {
        if s.is_empty() {
            return Err("user ID must not be empty".into());
        }
        if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("user ID must contain only alphanumeric characters and underscores".into());
        }
        Ok(Self(s.to_string()))
    }
}
newtype_id!(ThreadId);
newtype_id!(MessageId);
newtype_id!(SubscriptionId);
