//! Vault lock/unlock/reset/backup commands.
use tauri::State;
use crate::state::AppState;

/// Lock vault (wipes key from memory).
#[tauri::command]
pub async fn cmd_lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    state.vault.lock().await;
    Ok(())
}

/// Unlock vault with password re-entry (used by High-Security Mode).
#[tauri::command]
pub async fn cmd_unlock_vault(
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let (vault_salt_hex,): (String,) = sqlx::query_as(
        "SELECT vault_salt FROM accounts LIMIT 1"
    ).fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let salt_bytes = hex::decode(&vault_salt_hex).map_err(|e| e.to_string())?;
    let salt: [u8; 16] = salt_bytes.try_into().map_err(|_| "Bad salt".to_string())?;

    state.vault.unlock(password.as_bytes(), &salt).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear all locally-cached messages, attachments, and sessions.
/// Account credentials and contacts are preserved.
#[tauri::command]
pub async fn cmd_clear_local_cache(state: State<'_, AppState>) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    sqlx::query("DELETE FROM attachments").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM messages").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM sessions").execute(&store.pool).await.ok();
    Ok(())
}

/// Wipe the entire local vault (all tables). Requires the current password to
/// confirm. After ‘Ok’ the frontend should call clearAuth() and navigate to /auth.
#[tauri::command]
pub async fn cmd_reset_vault(
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    // Verify password before wiping anything.
    let (vault_salt_hex,): (String,) =
        sqlx::query_as("SELECT vault_salt FROM accounts LIMIT 1")
            .fetch_one(&store.pool)
            .await
            .map_err(|e| e.to_string())?;

    let salt: [u8; 16] = hex::decode(&vault_salt_hex)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Bad vault salt".to_string())?;

    {
        let test_vault = dl_store::vault::Vault::new();
        test_vault
            .unlock(password.as_bytes(), &salt)
            .await
            .map_err(|_| "Incorrect password".to_string())?;
    }

    // Order matters: delete children before parents.
    sqlx::query("DELETE FROM attachments").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM messages").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM sessions").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM group_members").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM groups").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM contacts").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM devices").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM risk_events").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM settings").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM accounts").execute(&store.pool).await.ok();

    // Lock vault and clear in-memory state.
    state.vault.lock().await;
    state.set_token(None).await;
    *state.store.lock().await = None;
    Ok(())
}

/// Export a copy of the encrypted vault database file to the app-data backup
/// directory. Returns the absolute path of the backup file.
#[tauri::command]
pub async fn cmd_export_backup(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;

    let store = state.get_store().await.ok_or("Not logged in")?;

    let (user_id,): (String,) = sqlx::query_as("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    // Source: the live vault DB.
    let mut src = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    src.push("vaults");
    src.push(format!("{user_id}.db"));

    // Destination: app-data/backups/<timestamp>.db
    let mut dst_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    dst_dir.push("backups");
    std::fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;

    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let dst = dst_dir.join(format!("darklock_backup_{ts}.db"));

    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;

    Ok(dst.to_string_lossy().into_owned())
}
