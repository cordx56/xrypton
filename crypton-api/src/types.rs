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

/// メールアドレスのローカルパートとして有効かを検証する。
/// 許可文字: 英数字, `_`, `.`, `+`, `-`
/// 先頭・末尾のドット、連続ドット、予約語は禁止。
fn validate_local_part(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("user ID must not be empty".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '+' | '-'))
    {
        return Err("user ID contains invalid characters".into());
    }
    if s.starts_with('.') || s.ends_with('.') {
        return Err("user ID must not start or end with a dot".into());
    }
    if s.contains("..") {
        return Err("user ID must not contain consecutive dots".into());
    }
    let lower = s.to_ascii_lowercase();
    if lower == "root" || lower == "admin" {
        return Err("this user ID is reserved".into());
    }
    Ok(())
}

impl UserId {
    /// ローカルユーザIDの形式を検証（メールローカルパートとして有効な文字、@禁止、予約語禁止）
    pub fn validate_local(s: &str) -> Result<Self, String> {
        if s.contains('@') {
            return Err("local user ID must not contain '@'".into());
        }
        validate_local_part(s)?;
        Ok(Self(s.to_string()))
    }

    /// フルユーザIDの形式を検証（`user` または `user@domain`）
    pub fn validate_full(s: &str) -> Result<Self, String> {
        if s.is_empty() {
            return Err("user ID must not be empty".into());
        }
        let local = s.split('@').next().unwrap();
        validate_local_part(local)?;
        Ok(Self(s.to_string()))
    }

    /// 既存の`validate`互換（`validate_local`と同じ）
    pub fn validate(s: &str) -> Result<Self, String> {
        Self::validate_local(s)
    }

    /// ローカルパートとドメインからドメイン付きUserIdを生成する。
    /// ローカルパートのバリデーションを行い、`"{local}@{domain}"` 形式で返す。
    pub fn new_local(local: &str, domain: &str) -> Result<Self, String> {
        validate_local_part(local)?;
        Ok(Self(format!("{local}@{domain}")))
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

    /// パスパラメータからローカルUserIdを解決する。
    /// ドメインなし → `@server_hostname` を付与。
    /// ドメインあり → そのまま返す（ドメイン一致の検証は呼び出し側で行う）。
    pub fn resolve_local(id: &str, server_hostname: &str) -> Result<Self, String> {
        if let Some((local_part, _domain)) = id.split_once('@') {
            validate_local_part(local_part)?;
            Ok(Self(id.to_string()))
        } else {
            Self::new_local(id, server_hostname)
        }
    }

    /// パスパラメータからUserIdを解決する。
    /// ドメインなし → `@server_hostname` を付与。
    /// ドメインあり → そのまま返す。
    pub fn resolve(id: &str, server_hostname: &str) -> Result<Self, String> {
        if id.contains('@') {
            Self::validate_full(id)
        } else {
            Self::new_local(id, server_hostname)
        }
    }
}
newtype_id!(ThreadId);
newtype_id!(MessageId);
newtype_id!(FileId);
newtype_id!(SubscriptionId);
