//! Settings Tauri commands.
use std::collections::HashMap;
use tauri::State;
use crate::state::AppState;

#[tauri::command]
pub async fn cmd_get_settings(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(&store.pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

#[tauri::command]
pub async fn cmd_set_setting(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .bind(&key).bind(&value)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}
