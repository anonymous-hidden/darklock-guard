//! Tauri commands for invite system — thin HTTP wrappers to IDS.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteDto {
    pub id: String,
    pub server_id: String,
    pub token: String,
    pub created_by: String,
    #[serde(default)]
    pub creator_name: Option<String>,
    pub expires_at: Option<String>,
    #[serde(default)]
    pub max_uses: Option<i64>,
    #[serde(default)]
    pub use_count: i64,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteInfoDto {
    pub server_name: String,
    pub server_icon: Option<String>,
    #[serde(default)]
    pub server_banner: Option<String>,
    #[serde(default)]
    pub server_bio: Option<String>,
    #[serde(default)]
    pub server_description: Option<String>,
    pub member_count: i64,
    pub creator_username: Option<String>,
    pub expires_at: Option<String>,
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

/// Create an invite for a server.
#[tauri::command]
pub async fn cmd_create_invite(
    server_id: String,
    expires_in: Option<String>,
    max_uses: Option<i64>,
    state: State<'_, AppState>,
) -> Result<InviteDto, String> {
    let url = format!("{}/servers/{}/invites", state.api_base_url, server_id);
    let body = serde_json::json!({
        "expires_in": expires_in,
        "max_uses": max_uses,
    });
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<InviteDto>().await.map_err(|e| e.to_string())
}

/// List all invites for a server.
#[tauri::command]
pub async fn cmd_get_invites(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<InviteDto>, String> {
    let url = format!("{}/servers/{}/invites", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { invites: Vec<InviteDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.invites)
}

/// Revoke (delete) an invite.
#[tauri::command]
pub async fn cmd_revoke_invite(
    server_id: String,
    invite_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/servers/{}/invites/{}", state.api_base_url, server_id, invite_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Get public info about an invite (no auth needed, but we send it anyway).
#[tauri::command]
pub async fn cmd_get_invite_info(
    invite_token: String,
    state: State<'_, AppState>,
) -> Result<InviteInfoDto, String> {
    let url = format!("{}/api/invites/{}/preview", state.api_base_url, invite_token);
    let c = client()?;
    let resp = c.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(api_error(resp).await);
    }
    resp.json::<InviteInfoDto>().await.map_err(|e| e.to_string())
}

/// Join a server via invite token.
#[tauri::command]
pub async fn cmd_join_via_invite(
    invite_token: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/invites/{}/join", state.api_base_url, invite_token);
    let resp = authed_request(&state, reqwest::Method::POST, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}
