pub mod chat;
pub mod contacts;
pub mod files;
pub mod messages;
pub mod models;
pub mod nonces;
pub mod push;
pub mod threads;
pub mod users;

#[cfg(not(feature = "postgres"))]
pub type Db = sqlx::SqlitePool;
#[cfg(feature = "postgres")]
pub type Db = sqlx::PgPool;

/// `?` プレースホルダを PostgreSQL の `$1, $2, ...` に変換する。
/// SQLite ビルドではそのまま返す。
#[cfg(not(feature = "postgres"))]
pub(crate) fn sql(query: &str) -> std::borrow::Cow<'_, str> {
    std::borrow::Cow::Borrowed(query)
}

#[cfg(feature = "postgres")]
pub(crate) fn sql(query: &str) -> std::borrow::Cow<'_, str> {
    use std::fmt::Write;
    let mut result = String::with_capacity(query.len() + 16);
    let mut idx = 0u32;
    let mut in_literal = false;
    for ch in query.chars() {
        match ch {
            '\'' => {
                in_literal = !in_literal;
                result.push(ch);
            }
            '?' if !in_literal => {
                idx += 1;
                write!(result, "${idx}").unwrap();
            }
            _ => result.push(ch),
        }
    }
    std::borrow::Cow::Owned(result)
}

pub async fn connect(url: &str) -> Result<Db, sqlx::Error> {
    #[cfg(not(feature = "postgres"))]
    {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(5)
            .connect(url)
            .await?;
        Ok(pool)
    }
    #[cfg(feature = "postgres")]
    {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect(url)
            .await?;
        Ok(pool)
    }
}

pub async fn migrate(pool: &Db) -> Result<(), sqlx::migrate::MigrateError> {
    #[cfg(not(feature = "postgres"))]
    {
        sqlx::migrate!("./migrations/sqlite").run(pool).await?;
    }
    #[cfg(feature = "postgres")]
    {
        sqlx::migrate!("./migrations/postgres").run(pool).await?;
    }
    Ok(())
}

/// 既存のドメインなしユーザIDに `@server_hostname` を付与するランタイムマイグレーション。
/// `WHERE ... NOT LIKE '%@%'` で既にドメイン付きのIDはスキップする。
pub async fn migrate_user_ids(pool: &Db, server_hostname: &str) -> Result<(), sqlx::Error> {
    let suffix = format!("@{server_hostname}");
    let like_pattern = "%@%";

    let mut tx = pool.begin().await?;

    // SQLite: FK制約チェックをコミット時まで遅延
    #[cfg(not(feature = "postgres"))]
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;

    // PostgreSQL: FK制約を一時的に削除（制約名は自動生成の標準パターン）
    #[cfg(feature = "postgres")]
    {
        for stmt in &[
            "ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey",
            "ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_user_id_fkey",
            "ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey",
            "ALTER TABLE chat_groups DROP CONSTRAINT IF EXISTS chat_groups_created_by_fkey",
            "ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_created_by_fkey",
        ] {
            sqlx::query(stmt).execute(&mut *tx).await?;
        }
    }

    // FK制約なしのテーブル（0006で制約が削除済み）
    let q = sql("UPDATE used_nonces SET user_id = user_id || ? WHERE user_id NOT LIKE ?");
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql("UPDATE chat_members SET user_id = user_id || ? WHERE user_id NOT LIKE ?");
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql(
        "UPDATE messages SET sender_id = sender_id || ? WHERE sender_id IS NOT NULL AND sender_id NOT LIKE ?",
    );
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql(
        "UPDATE contacts SET contact_user_id = contact_user_id || ? WHERE contact_user_id NOT LIKE ?",
    );
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    // FK制約ありのテーブル
    let q = sql("UPDATE contacts SET user_id = user_id || ? WHERE user_id NOT LIKE ?");
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql("UPDATE profiles SET user_id = user_id || ? WHERE user_id NOT LIKE ?");
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql("UPDATE push_subscriptions SET user_id = user_id || ? WHERE user_id NOT LIKE ?");
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql(
        "UPDATE chat_groups SET created_by = created_by || ? WHERE created_by IS NOT NULL AND created_by NOT LIKE ?",
    );
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    let q = sql(
        "UPDATE threads SET created_by = created_by || ? WHERE created_by IS NOT NULL AND created_by NOT LIKE ?",
    );
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    // 最後にusers.id本体を更新
    let q = sql("UPDATE users SET id = id || ? WHERE id NOT LIKE ?");
    sqlx::query(&q)
        .bind(&suffix)
        .bind(like_pattern)
        .execute(&mut *tx)
        .await?;

    // PostgreSQL: FK制約を再追加
    #[cfg(feature = "postgres")]
    {
        for stmt in &[
            "ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE contacts ADD CONSTRAINT contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            "ALTER TABLE chat_groups ADD CONSTRAINT chat_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
            "ALTER TABLE threads ADD CONSTRAINT threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
        ] {
            sqlx::query(stmt).execute(&mut *tx).await?;
        }
    }

    tx.commit().await?;
    Ok(())
}
