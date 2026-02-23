//! Tauri commands for AutoMod system — thin HTTP wrappers to IDS.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoModRuleDto {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub rule_type: String,        // word_filter, spam, mention, link, media, anti_raid
    pub action: String,           // nothing, warn, delete, timeout, kick, ban
    pub config: serde_json::Value,
    pub enabled: bool,
    pub exempt_roles: serde_json::Value,
    pub exempt_channels: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoModEventDto {
    pub id: String,
    pub server_id: String,
    pub rule_id: String,
    pub rule_name: Option<String>,
    pub user_id: String,
    pub username: Option<String>,
    pub channel_id: Option<String>,
    pub content_snippet: Option<String>,
    pub action_taken: String,
    pub created_at: String,
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

/// List AutoMod rules for a server.
#[tauri::command]
pub async fn cmd_get_automod_rules(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AutoModRuleDto>, String> {
    let url = format!("{}/servers/{}/automod/rules", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { rules: Vec<AutoModRuleDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.rules)
}

/// Create an AutoMod rule.
#[tauri::command]
pub async fn cmd_create_automod_rule(
    server_id: String,
    name: String,
    rule_type: String,
    action: String,
    config: serde_json::Value,
    exempt_roles: Option<Vec<String>>,
    exempt_channels: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<AutoModRuleDto, String> {
    let url = format!("{}/servers/{}/automod/rules", state.api_base_url, server_id);
    let body = serde_json::json!({
        "name": name,
        "rule_type": rule_type,
        "action": action,
        "config": config,
        "exempt_roles": exempt_roles.unwrap_or_default(),
        "exempt_channels": exempt_channels.unwrap_or_default(),
    });
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<AutoModRuleDto>().await.map_err(|e| e.to_string())
}

/// Update an AutoMod rule.
#[tauri::command]
pub async fn cmd_update_automod_rule(
    server_id: String,
    rule_id: String,
    name: Option<String>,
    action: Option<String>,
    config: Option<serde_json::Value>,
    enabled: Option<bool>,
    exempt_roles: Option<Vec<String>>,
    exempt_channels: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<AutoModRuleDto, String> {
    let url = format!("{}/servers/{}/automod/rules/{}", state.api_base_url, server_id, rule_id);
    let mut body = serde_json::Map::new();
    if let Some(n) = name { body.insert("name".into(), serde_json::json!(n)); }
    if let Some(a) = action { body.insert("action".into(), serde_json::json!(a)); }
    if let Some(c) = config { body.insert("config".into(), c); }
    if let Some(e) = enabled { body.insert("enabled".into(), serde_json::json!(e)); }
    if let Some(er) = exempt_roles { body.insert("exempt_roles".into(), serde_json::json!(er)); }
    if let Some(ec) = exempt_channels { body.insert("exempt_channels".into(), serde_json::json!(ec)); }

    let resp = authed_request(
        &state,
        reqwest::Method::PATCH,
        &url,
        Some(serde_json::Value::Object(body)),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<AutoModRuleDto>().await.map_err(|e| e.to_string())
}

/// Delete an AutoMod rule.
#[tauri::command]
pub async fn cmd_delete_automod_rule(
    server_id: String,
    rule_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/servers/{}/automod/rules/{}", state.api_base_url, server_id, rule_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Get AutoMod event log.
#[tauri::command]
pub async fn cmd_get_automod_events(
    server_id: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<AutoModEventDto>, String> {
    let url = format!(
        "{}/servers/{}/automod/events?limit={}",
        state.api_base_url,
        server_id,
        limit.unwrap_or(50)
    );
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { events: Vec<AutoModEventDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.events)
}
