use super::models::{ChatGroupRow, ChatMemberRow};
use super::{Db, sql};
use crate::types::{ChatId, ThreadId, UserId};

/// グループの表示名を解決する。
/// リクエストユーザ以外のメンバーの表示名をソートして結合する。
/// 自分だけの場合は自分の表示名を返す。メンバーが見つからない場合は `None`。
pub async fn resolve_group_display_name(
    pool: &Db,
    chat_id: &ChatId,
    requester: &UserId,
) -> Option<String> {
    let members = get_chat_members(pool, chat_id).await.ok()?;
    if members.is_empty() {
        return None;
    }

    let mut names: Vec<(bool, String)> = Vec::with_capacity(members.len());
    for m in &members {
        let uid = UserId(m.user_id.clone());
        let display = super::users::resolve_display_name(pool, &uid)
            .await
            .unwrap_or_else(|| m.user_id.clone());
        let is_self = m.user_id == requester.as_str();
        names.push((is_self, display));
    }

    let mut others: Vec<&str> = names
        .iter()
        .filter(|(is_self, _)| !is_self)
        .map(|(_, name)| name.as_str())
        .collect();
    others.sort_unstable();

    if others.is_empty() {
        // 自分だけのグループ
        names
            .into_iter()
            .find(|(is_self, _)| *is_self)
            .map(|(_, n)| n)
    } else {
        Some(others.join(", "))
    }
}

#[tracing::instrument(skip(pool), err)]
pub async fn create_chat_group(
    pool: &Db,
    id: &ChatId,
    name: &str,
    created_by: &UserId,
    member_ids: &[String],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let q = sql("INSERT INTO chat_groups (id, name, created_by) VALUES (?, ?, ?)");
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(name)
        .bind(created_by.as_str())
        .execute(&mut *tx)
        .await?;

    // 作成者もメンバーに追加
    let q = sql("INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)");
    sqlx::query(&q)
        .bind(id.as_str())
        .bind(created_by.as_str())
        .execute(&mut *tx)
        .await?;

    let q = sql(
        "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?) ON CONFLICT (chat_id, user_id) DO NOTHING",
    );
    for member_id in member_ids {
        if member_id != created_by.as_str() {
            sqlx::query(&q)
                .bind(id.as_str())
                .bind(member_id)
                .execute(&mut *tx)
                .await?;
        }
    }

    // generalスレッドを自動作成
    let general_thread_id = ThreadId::new_v4();
    let q = sql("INSERT INTO threads (id, chat_id, name, created_by) VALUES (?, ?, 'general', ?)");
    sqlx::query(&q)
        .bind(general_thread_id.as_str())
        .bind(id.as_str())
        .bind(created_by.as_str())
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_user_chat_groups(
    pool: &Db,
    user_id: &UserId,
) -> Result<Vec<ChatGroupRow>, sqlx::Error> {
    let q = sql("SELECT g.*, \
         (SELECT MAX(msg.created_at) FROM messages msg \
          INNER JOIN threads t ON msg.thread_id = t.id \
          WHERE t.chat_id = g.id) AS updated_at \
         FROM chat_groups g \
         INNER JOIN chat_members m ON g.id = m.chat_id \
         WHERE m.user_id = ? AND g.archived_at IS NULL \
         ORDER BY g.created_at DESC");
    sqlx::query_as::<_, ChatGroupRow>(&q)
        .bind(user_id.as_str())
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_user_archived_chat_groups(
    pool: &Db,
    user_id: &UserId,
) -> Result<Vec<ChatGroupRow>, sqlx::Error> {
    let q = sql("SELECT g.*, \
         (SELECT MAX(msg.created_at) FROM messages msg \
          INNER JOIN threads t ON msg.thread_id = t.id \
          WHERE t.chat_id = g.id) AS updated_at \
         FROM chat_groups g \
         INNER JOIN chat_members m ON g.id = m.chat_id \
         WHERE m.user_id = ? AND g.archived_at IS NOT NULL \
         ORDER BY g.archived_at DESC");
    sqlx::query_as::<_, ChatGroupRow>(&q)
        .bind(user_id.as_str())
        .fetch_all(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn archive_chat_group(pool: &Db, chat_id: &ChatId) -> Result<bool, sqlx::Error> {
    let q = sql("UPDATE chat_groups SET archived_at = CURRENT_TIMESTAMP WHERE id = ?");
    let result = sqlx::query(&q).bind(chat_id.as_str()).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn unarchive_chat_group(pool: &Db, chat_id: &ChatId) -> Result<bool, sqlx::Error> {
    let q = sql("UPDATE chat_groups SET archived_at = NULL WHERE id = ?");
    let result = sqlx::query(&q).bind(chat_id.as_str()).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_chat_group(
    pool: &Db,
    chat_id: &ChatId,
) -> Result<Option<ChatGroupRow>, sqlx::Error> {
    let q = sql("SELECT * FROM chat_groups WHERE id = ?");
    sqlx::query_as::<_, ChatGroupRow>(&q)
        .bind(chat_id.as_str())
        .fetch_optional(pool)
        .await
}

#[tracing::instrument(skip(pool), err)]
pub async fn get_chat_members(
    pool: &Db,
    chat_id: &ChatId,
) -> Result<Vec<ChatMemberRow>, sqlx::Error> {
    let q = sql("SELECT * FROM chat_members WHERE chat_id = ?");
    sqlx::query_as::<_, ChatMemberRow>(&q)
        .bind(chat_id.as_str())
        .fetch_all(pool)
        .await
}

/// 外部サーバから同期されたチャットの参照を作成する。
/// server_domain にホームサーバのドメインを設定し、
/// ローカルメンバーのみ chat_members に追加する。
#[tracing::instrument(skip(pool), err)]
pub async fn create_remote_chat_reference(
    pool: &Db,
    chat_id: &ChatId,
    name: &str,
    server_domain: &str,
    local_member_ids: &[String],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    let q = sql(
        "INSERT INTO chat_groups (id, name, server_domain) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
    );
    sqlx::query(&q)
        .bind(chat_id.as_str())
        .bind(name)
        .bind(server_domain)
        .execute(&mut *tx)
        .await?;

    let q = sql(
        "INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?) ON CONFLICT (chat_id, user_id) DO NOTHING",
    );
    for member_id in local_member_ids {
        sqlx::query(&q)
            .bind(chat_id.as_str())
            .bind(member_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

#[tracing::instrument(skip(pool), err)]
pub async fn is_member(pool: &Db, chat_id: &ChatId, user_id: &UserId) -> Result<bool, sqlx::Error> {
    let q = sql("SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?");
    let row: Option<(i32,)> = sqlx::query_as(&q)
        .bind(chat_id.as_str())
        .bind(user_id.as_str())
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}
