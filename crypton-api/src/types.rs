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
    /// ローカルユーザIDの形式を検証（英数字とアンダースコアのみ、@禁止、予約語禁止）
    pub fn validate_local(s: &str) -> Result<Self, String> {
        if s.is_empty() {
            return Err("user ID must not be empty".into());
        }
        if s.contains('@') {
            return Err("local user ID must not contain '@'".into());
        }
        if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("user ID must contain only alphanumeric characters and underscores".into());
        }
        let lower = s.to_ascii_lowercase();
        if lower == "root" || lower == "admin" {
            return Err("this user ID is reserved".into());
        }
        Ok(Self(s.to_string()))
    }

    /// フルユーザIDの形式を検証（`user` または `user@domain`）
    pub fn validate_full(s: &str) -> Result<Self, String> {
        if s.is_empty() {
            return Err("user ID must not be empty".into());
        }
        let local = s.split('@').next().unwrap();
        if local.is_empty() {
            return Err("user ID local part must not be empty".into());
        }
        if !local.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err("user ID must contain only alphanumeric characters and underscores".into());
        }
        let lower = local.to_ascii_lowercase();
        if lower == "root" || lower == "admin" {
            return Err("this user ID is reserved".into());
        }
        Ok(Self(s.to_string()))
    }

    /// 既存の`validate`互換（`validate_local`と同じ）
    pub fn validate(s: &str) -> Result<Self, String> {
        Self::validate_local(s)
    }

    /// `@`以前のローカル部分を返す
    pub fn local_part(&self) -> &str {
        self.0.split('@').next().unwrap()
    }

    /// `@`以降のドメイン部分を返す（なければNone）
    pub fn domain(&self) -> Option<&str> {
        self.0.split_once('@').map(|(_, d)| d)
    }

    /// 指定ホスト名がローカルか判定する
    pub fn is_local(&self, hostname: &str) -> bool {
        self.domain().is_none() || self.domain() == Some(hostname)
    }

    /// ドメインを付与した新しいUserIdを返す
    pub fn with_domain(&self, domain: &str) -> UserId {
        UserId(format!("{}@{}", self.local_part(), domain))
    }

    /// ドメインを除去した新しいUserIdを返す
    pub fn without_domain(&self) -> UserId {
        UserId(self.local_part().to_string())
    }

    /// パスパラメータからローカルUserIdを抽出する。
    /// `user@domain` 形式の場合、ドメインが自サーバと一致すればローカル部分のみ返す。
    /// 異なるドメインの場合はエラー。
    pub fn resolve_local(id: &str, server_hostname: &str) -> Result<Self, String> {
        if let Some((local_part, domain)) = id.split_once('@') {
            if domain != server_hostname {
                return Err("domain does not match this server".into());
            }
            Self::validate_local(local_part)
        } else {
            Self::validate_local(id)
        }
    }

    /// パスパラメータからUserIdを解決する。
    /// 自サーバのドメインならローカル部分のみ、外部ドメインならフルIDを返す。
    pub fn resolve(id: &str, server_hostname: &str) -> Result<Self, String> {
        if let Some((local_part, domain)) = id.split_once('@') {
            if domain == server_hostname {
                Self::validate_local(local_part)
            } else {
                Self::validate_full(id)
            }
        } else {
            Self::validate_local(id)
        }
    }
}
newtype_id!(ThreadId);
newtype_id!(MessageId);
newtype_id!(FileId);
newtype_id!(SubscriptionId);
