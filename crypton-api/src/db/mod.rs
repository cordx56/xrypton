pub mod chat;
pub mod contacts;
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
