//! Tauri commands for pinned messages — IDS for server pins, local for DM pins.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinnedMessageDto {
    pub id: String,
    pub message_id: String,
    pub channel_id: Option<String>,
    pub session_id: Option<String>,
    pub pinned_by: String,
    pub content_preview: String,
    pub pinned_at: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())
}

async fn authed_request(
    state: &AppState,
    method: reqwest::Method,
    url: &str,
    body: Option<serde_json::Value>,
) -> Result<reqwest::Response, String> {
    let c = client()?;
    let token = state.get_token().await.ok_or("Not logged in")?;

    let mut req = c.request(method.clone(), url).bearer_auth(&token);
    if let Some(ref b) = body {
        req = req.json(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;

    if resp.status().as_u16() == 401 {
        let new_token = refresh_access_token(state).await?;
        let mut req = c.request(method, url).bearer_auth(&new_token);
        if let Some(b) = body {
            req = req.json(&b);
        }
        return req.send().await.map_err(|e| e.to_string());
    }

    Ok(resp)
}

async fn api_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    body.get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Request failed ({})", status))
}

// ── DM Pin Commands (local vault) ────────────────────────────────────────────

/// Pin a message in a DM session (stored locally).
#[tauri::command]
pub async fn cmd_pin_dm_message(
    session_id: String,
    message_id: String,
    content_preview: String,
    state: State<'_, AppState>,
) -> Result<PinnedMessageDto, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let local_user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT OR IGNORE INTO pinned_dm_messages (id, session_id, message_id, pinned_by, content_preview, pinned_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
        .bind(&id)
        .bind(&session_id)
        .bind(&message_id)
        .bind(&local_user_id)
        .bind(&content_preview)
        .bind(&now)
        .execute(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(PinnedMessageDto {
        id,
        message_id,
        channel_id: None,
        session_id: Some(session_id),
        pinned_by: local_user_id,
        content_preview,
        pinned_at: now,
    })
}

/// Unpin a DM message.
#[tauri::command]
pub async fn cmd_unpin_dm_message(
    pin_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    sqlx::query("DELETE FROM pinned_dm_messages WHERE id = ?")
        .bind(&pin_id)
        .execute(&store.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get all pinned messages for a DM session.
#[tauri::command]
pub async fn cmd_get_dm_pins(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PinnedMessageDto>, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, message_id, pinned_by, content_preview, pinned_at FROM pinned_dm_messages WHERE session_id = ? ORDER BY pinned_at DESC"
    )
        .bind(&session_id)
        .fetch_all(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(id, message_id, pinned_by, content_preview, pinned_at)| {
        PinnedMessageDto {
            id,
            message_id,
            channel_id: None,
            session_id: Some(session_id.clone()),
            pinned_by,
            content_preview,
            pinned_at,
        }
    }).collect())
}

// ── Server Pin Commands (IDS) ────────────────────────────────────────────────

/// Pin a message in a server channel (via IDS).
#[tauri::command]
pub async fn cmd_pin_server_message(
    server_id: String,
    channel_id: String,
    message_id: String,
    content_preview: String,
    state: State<'_, AppState>,
) -> Result<PinnedMessageDto, String> {
    let url = format!("{}/servers/{}/channels/{}/pins", state.api_base_url, server_id, channel_id);
    let body = serde_json::json!({
        "message_id": message_id,
        "content_preview": content_preview,
    });
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<PinnedMessageDto>().await.map_err(|e| e.to_string())
}

/// Get pinned messages for a server channel (via IDS).
#[tauri::command]
pub async fn cmd_get_server_pins(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PinnedMessageDto>, String> {
    let url = format!("{}/servers/{}/channels/{}/pins", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { pins: Vec<PinnedMessageDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.pins)
}

/// Unpin a server message.
#[tauri::command]
pub async fn cmd_unpin_server_message(
    server_id: String,
    channel_id: String,
    pin_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/servers/{}/channels/{}/pins/{}", state.api_base_url, server_id, channel_id, pin_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}
