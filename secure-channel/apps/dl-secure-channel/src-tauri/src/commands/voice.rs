//! Tauri commands for voice room state — thin HTTP wrappers to IDS.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceMemberDto {
    pub user_id: String,
    pub is_muted: bool,
    pub is_deafened: bool,
    #[serde(default)]
    pub is_camera_on: bool,
    #[serde(default)]
    pub is_stage_speaker: bool,
    #[serde(default)]
    pub is_stage_requesting: bool,
    #[serde(default)]
    pub last_heartbeat_at: Option<String>,
    #[serde(default)]
    pub fingerprint: Option<String>,
    pub joined_at: String,
    pub username: String,
    #[serde(default)]
    pub nickname: Option<String>,
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

/// Join a voice channel.
#[tauri::command]
pub async fn cmd_join_voice_channel(
    server_id: String,
    channel_id: String,
    fingerprint: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<VoiceMemberDto>, String> {
    let url = format!("{}/voice/{}/{}/join", state.api_base_url, server_id, channel_id);
    let resp = authed_request(
        &state,
        reqwest::Method::POST,
        &url,
        Some(serde_json::json!({ "fingerprint": fingerprint })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { members: Vec<VoiceMemberDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.members)
}

/// Leave a voice channel.
#[tauri::command]
pub async fn cmd_leave_voice_channel(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/voice/{}/{}/leave", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(serde_json::json!({}))).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Get members in a voice channel.
#[tauri::command]
pub async fn cmd_get_voice_members(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<VoiceMemberDto>, String> {
    let url = format!("{}/voice/{}/{}/members", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { members: Vec<VoiceMemberDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.members)
}

/// Update voice state (mute/deafen).
#[tauri::command]
pub async fn cmd_update_voice_state(
    server_id: String,
    channel_id: String,
    is_muted: Option<bool>,
    is_deafened: Option<bool>,
    is_camera_on: Option<bool>,
    fingerprint: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/voice/{}/{}/state", state.api_base_url, server_id, channel_id);
    let body = serde_json::json!({
        "is_muted": is_muted,
        "is_deafened": is_deafened,
        "is_camera_on": is_camera_on,
        "fingerprint": fingerprint,
    });
    let resp = authed_request(&state, reqwest::Method::PATCH, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Get all voice state for a server (members across all voice channels).
#[tauri::command]
pub async fn cmd_get_server_voice_state(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/voice/{}/state", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_voice_heartbeat(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/voice/{}/{}/heartbeat", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(serde_json::json!({}))).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_stage_request_speak(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/voice/{}/{}/stage/request", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(serde_json::json!({}))).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_stage_promote(
    server_id: String,
    channel_id: String,
    target_user_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/voice/{}/{}/stage/promote/{}", state.api_base_url, server_id, channel_id, target_user_id);
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(serde_json::json!({}))).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_stage_demote(
    server_id: String,
    channel_id: String,
    target_user_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/voice/{}/{}/stage/demote/{}", state.api_base_url, server_id, channel_id, target_user_id);
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(serde_json::json!({}))).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_realtime_token(state: State<'_, AppState>) -> Result<String, String> {
    state.get_token().await.ok_or("Not authenticated".to_string())
}

#[tauri::command]
pub async fn cmd_get_ids_base_url(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.api_base_url.clone())
}
