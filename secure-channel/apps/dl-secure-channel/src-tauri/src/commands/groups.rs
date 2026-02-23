//! Group management commands (v1 stubs with correct interface).
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupDto {
    pub id: String,
    pub name: String,
    pub creator_user_id: String,
    pub member_count: i64,
    pub created_at: String,
    pub description: Option<String>,
}

/// Create a new group. v1 stub.
#[tauri::command]
pub async fn cmd_create_group(
    name: String,
    description: Option<String>,
    member_user_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<GroupDto, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let creator: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    sqlx::query(
        "INSERT INTO groups (id, name, creator_user_id, created_at, description) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id).bind(&name).bind(&creator).bind(now.to_rfc3339()).bind(&description)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    // Add creator as admin
    sqlx::query(
        "INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)"
    )
    .bind(&id).bind(&creator).bind(now.to_rfc3339())
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    Ok(GroupDto {
        id,
        name,
        creator_user_id: creator,
        member_count: 1,
        created_at: now.to_rfc3339(),
        description,
    })
}

/// List all groups the current user is a member of.
#[tauri::command]
pub async fn cmd_get_groups(state: State<'_, AppState>) -> Result<Vec<GroupDto>, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, String, Option<String>, String)> = sqlx::query_as(
        r#"SELECT g.id, g.name, g.creator_user_id, g.description, g.created_at
           FROM groups g
           JOIN group_members gm ON g.id = gm.group_id
           WHERE gm.user_id = ?
           ORDER BY g.name ASC"#
    ).bind(user_id).fetch_all(&store.pool).await.map_err(|e| e.to_string())?;

    let dtos = rows.into_iter().map(|(id, name, creator, desc, created)| GroupDto {
        id,
        name,
        creator_user_id: creator,
        member_count: 0, // REPLACE_ME: count from group_members
        created_at: created,
        description: desc,
    }).collect();

    Ok(dtos)
}
