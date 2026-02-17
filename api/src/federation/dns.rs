use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::Instant;

use hickory_resolver::TokioResolver;
use hickory_resolver::proto::rr::rdata::TXT;

/// DNS TXTレコードによるドメイン解決の結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedDomain {
    /// TXTレコードにマッピングが見つかった。
    Mapped { local_part: String, domain: String },
    /// マッピングなし、元のドメインをそのまま使用。
    Original,
}

/// キャッシュエントリ: パース済みTXTエントリと有効期限。
struct CacheEntry {
    entries: Vec<String>,
    expires_at: Instant,
}

/// DNS TXTレコードを用いたドメインリゾルバ。
///
/// `_xrypton.{domain}` のTXTレコードを参照し、`user=[id]@[domain]` 形式の
/// エントリからユーザIDのマッピングを解決する。結果はTTL付きでキャッシュされる。
#[derive(Clone)]
pub struct DnsTxtResolver {
    cache: Arc<RwLock<HashMap<String, CacheEntry>>>,
    ttl: std::time::Duration,
}

impl DnsTxtResolver {
    pub fn new(ttl: std::time::Duration) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            ttl,
        }
    }

    /// 指定ドメインのTXTレコードからユーザIDのマッピングを解決する。
    ///
    /// DNS失敗時は `Original` を返す（フォールバック、非致命的）。
    pub async fn resolve(&self, domain: &str, user_id: &str) -> ResolvedDomain {
        let entries = match self.get_txt_entries(domain).await {
            Some(entries) => entries,
            None => {
                tracing::warn!("DNS TXT entries not available for {domain}, treating as Original");
                return ResolvedDomain::Original;
            }
        };

        let result = find_user_mapping(&entries, user_id);
        tracing::info!("DNS resolve {user_id}@{domain}: entries={entries:?}, result={result:?}");
        result
    }

    /// キャッシュまたはDNSからTXTエントリを取得する。
    async fn get_txt_entries(&self, domain: &str) -> Option<Vec<String>> {
        // キャッシュチェック
        {
            let cache = self.cache.read().await;
            if let Some(entry) = cache.get(domain)
                && entry.expires_at > Instant::now()
            {
                return Some(entry.entries.clone());
            }
        }

        // DNSクエリ
        let entries = query_txt_records(domain).await?;

        // キャッシュ更新
        {
            let mut cache = self.cache.write().await;
            cache.insert(
                domain.to_string(),
                CacheEntry {
                    entries: entries.clone(),
                    expires_at: Instant::now() + self.ttl,
                },
            );
        }

        Some(entries)
    }
}

/// `_xrypton.{domain}` のDNS TXTレコードをクエリする。
async fn query_txt_records(domain: &str) -> Option<Vec<String>> {
    let resolver = TokioResolver::builder_tokio()
        .map_err(|e| {
            tracing::warn!("failed to create DNS resolver: {e}");
        })
        .ok()?
        .build();

    let lookup_name = format!("_xrypton.{domain}");
    let response = resolver
        .txt_lookup(lookup_name.as_str())
        .await
        .map_err(|e| {
            tracing::warn!("DNS TXT lookup for {lookup_name} failed: {e}");
        })
        .ok()?;

    // TXTレコードを文字列としてパース: `;` で分割 → trim
    let entries: Vec<String> = response
        .iter()
        .flat_map(|txt: &TXT| {
            let raw = txt.to_string();
            raw.split(';')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<Vec<String>>()
        })
        .collect();

    Some(entries)
}

/// TXTエントリのリストから `user_id` に一致するマッピングを検索する。
///
/// エントリ形式: `user=[original_id]@[mapped_domain]`
/// `original_id` が `user_id` と一致すれば、マッピング先を返す。
/// ワイルドカード `*` も対応: `user=*@[mapped_domain]` は全ユーザに一致する。
fn find_user_mapping(entries: &[String], user_id: &str) -> ResolvedDomain {
    // 完全一致を優先して検索
    for entry in entries {
        let Some(value) = entry.strip_prefix("user=") else {
            continue;
        };
        let Some((local_part, domain)) = value.split_once('@') else {
            continue;
        };
        if local_part == user_id {
            return ResolvedDomain::Mapped {
                local_part: local_part.to_string(),
                domain: domain.to_string(),
            };
        }
    }

    // ワイルドカード検索
    for entry in entries {
        let Some(value) = entry.strip_prefix("user=") else {
            continue;
        };
        let Some((local_part, domain)) = value.split_once('@') else {
            continue;
        };
        if local_part == "*" {
            return ResolvedDomain::Mapped {
                local_part: user_id.to_string(),
                domain: domain.to_string(),
            };
        }
    }

    ResolvedDomain::Original
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_user_mapping_exact_match() {
        let entries = vec![
            "user=alice@server.example.com".to_string(),
            "user=bob@other.example.com".to_string(),
        ];
        assert_eq!(
            find_user_mapping(&entries, "alice"),
            ResolvedDomain::Mapped {
                local_part: "alice".to_string(),
                domain: "server.example.com".to_string(),
            }
        );
    }

    #[test]
    fn find_user_mapping_no_match() {
        let entries = vec![
            "user=alice@server.example.com".to_string(),
            "user=bob@other.example.com".to_string(),
        ];
        assert_eq!(
            find_user_mapping(&entries, "charlie"),
            ResolvedDomain::Original
        );
    }

    #[test]
    fn find_user_mapping_empty_entries() {
        let entries: Vec<String> = vec![];
        assert_eq!(
            find_user_mapping(&entries, "alice"),
            ResolvedDomain::Original
        );
    }

    #[test]
    fn find_user_mapping_wildcard() {
        let entries = vec!["user=*@server.example.com".to_string()];
        assert_eq!(
            find_user_mapping(&entries, "anyone"),
            ResolvedDomain::Mapped {
                local_part: "anyone".to_string(),
                domain: "server.example.com".to_string(),
            }
        );
    }

    #[test]
    fn find_user_mapping_exact_over_wildcard() {
        // 完全一致がワイルドカードより優先される
        let entries = vec![
            "user=*@fallback.example.com".to_string(),
            "user=alice@specific.example.com".to_string(),
        ];
        assert_eq!(
            find_user_mapping(&entries, "alice"),
            ResolvedDomain::Mapped {
                local_part: "alice".to_string(),
                domain: "specific.example.com".to_string(),
            }
        );
    }

    #[test]
    fn find_user_mapping_ignores_non_user_entries() {
        let entries = vec![
            "v=spf1 include:example.com".to_string(),
            "user=alice@server.example.com".to_string(),
        ];
        assert_eq!(
            find_user_mapping(&entries, "alice"),
            ResolvedDomain::Mapped {
                local_part: "alice".to_string(),
                domain: "server.example.com".to_string(),
            }
        );
    }

    #[test]
    fn find_user_mapping_malformed_entry() {
        // @なしのエントリは無視される
        let entries = vec!["user=alice-no-domain".to_string()];
        assert_eq!(
            find_user_mapping(&entries, "alice-no-domain"),
            ResolvedDomain::Original
        );
    }

    #[tokio::test]
    async fn resolver_cached_data() {
        let resolver = DnsTxtResolver::new(std::time::Duration::from_secs(3600));

        // 手動でキャッシュにデータを挿入
        {
            let mut cache = resolver.cache.write().await;
            cache.insert(
                "example.com".to_string(),
                CacheEntry {
                    entries: vec!["user=test@real-server.example.com".to_string()],
                    expires_at: Instant::now() + std::time::Duration::from_secs(3600),
                },
            );
        }

        let result = resolver.resolve("example.com", "test").await;
        assert_eq!(
            result,
            ResolvedDomain::Mapped {
                local_part: "test".to_string(),
                domain: "real-server.example.com".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn resolver_expired_cache_returns_original_on_dns_failure() {
        let resolver = DnsTxtResolver::new(std::time::Duration::from_secs(0));

        // 即時期限切れのキャッシュ
        {
            let mut cache = resolver.cache.write().await;
            cache.insert(
                "nonexistent.invalid".to_string(),
                CacheEntry {
                    entries: vec!["user=test@real.example.com".to_string()],
                    expires_at: Instant::now(), // すでに期限切れ
                },
            );
        }

        // DNSクエリが失敗するため、Originalが返る
        let result = resolver.resolve("nonexistent.invalid", "test").await;
        assert_eq!(result, ResolvedDomain::Original);
    }
}
