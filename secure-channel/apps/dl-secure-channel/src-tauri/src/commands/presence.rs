//! Tauri commands for presence system — thin HTTP wrappers to IDS.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceDto {
    pub user_id: String,
    pub status: String,         // online | idle | dnd | invisible | offline
    pub custom_status: Option<String>,
    pub last_seen: Option<String>,
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

// ── Commands ─────────────────────────────────────────────────────────────────

/// Send presence heartbeat to IDS.
#[tauri::command]
pub async fn cmd_presence_heartbeat(
    status: Option<String>,
    custom_status: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/presence/heartbeat", state.api_base_url);
    let body = serde_json::json!({
        "status": status,
        "custom_status": custom_status,
    });
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Get presence for a single user.
#[tauri::command]
pub async fn cmd_get_presence(
    user_id: String,
    state: State<'_, AppState>,
) -> Result<PresenceDto, String> {
    let url = format!("{}/presence/{}", state.api_base_url, user_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<PresenceDto>().await.map_err(|e| e.to_string())
}

/// Get presence for multiple users at once.
#[tauri::command]
pub async fn cmd_get_batch_presence(
    user_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<PresenceDto>, String> {
    let url = format!("{}/presence/batch", state.api_base_url);
    let resp = authed_request(
        &state,
        reqwest::Method::POST,
        &url,
        Some(serde_json::json!({ "user_ids": user_ids })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { presences: Vec<PresenceDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.presences)
}

/// Set presence status override (dnd, invisible, etc).
#[tauri::command]
pub async fn cmd_set_presence_status(
    status: String,
    custom_status: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/presence/status", state.api_base_url);
    let body = serde_json::json!({
        "status": status,
        "custom_status": custom_status,
    });
    let resp = authed_request(&state, reqwest::Method::PATCH, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}
