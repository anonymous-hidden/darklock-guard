//! Tauri commands for server, role, channel, and member management.
//! All state is server-side (IDS). These commands are thin HTTP wrappers.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerDto {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub banner_color: Option<String>,
    pub member_count: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelDto {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub topic: Option<String>,
    #[serde(rename = "type")]
    pub channel_type: Option<String>,
    pub position: i64,
    pub category_id: Option<String>,
    #[serde(default)]
    pub is_secure: bool,
    #[serde(default)]
    pub lockdown: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelReorderPatch {
    pub id: String,
    pub position: i64,
    #[serde(default)]
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleDto {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub color_hex: String,
    pub position: i64,
    pub permissions: String,
    pub is_admin: bool,
    pub show_tag: bool,
    pub hoist: bool,
    pub tag_style: Option<String>,
    #[serde(default)]
    pub separate_members: bool,
    #[serde(default)]
    pub badge_image_url: Option<String>,
    #[serde(default)]
    pub security_level: i64,
    pub member_count: Option<i64>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberRoleInfo {
    pub id: String,
    pub name: String,
    pub color_hex: String,
    pub position: i64,
    pub is_admin: bool,
    pub show_tag: bool,
    #[serde(default)]
    pub separate_members: bool,
    #[serde(default)]
    pub badge_image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerMemberDto {
    pub user_id: String,
    pub username: String,
    pub nickname: Option<String>,
    pub avatar: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub profile_bio: Option<String>,
    pub profile_color: Option<String>,
    pub joined_at: String,
    pub is_owner: bool,
    pub roles: Vec<MemberRoleInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelOverrideDto {
    pub id: String,
    pub channel_id: String,
    pub role_id: String,
    pub allow_permissions: String,
    pub deny_permissions: String,
    pub role_name: Option<String>,
    pub color_hex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntryDto {
    pub id: String,
    pub server_id: String,
    pub actor_id: String,
    pub actor_username: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub changes: Option<serde_json::Value>,
    pub diff_json: Option<serde_json::Value>,
    pub reason: Option<String>,
    pub created_at: String,
}

// ── Internal helpers ─────────────────────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())
}

/// Make an authenticated request, auto-refresh on 401.
pub async fn authed_request(
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
        // Attempt refresh
        let new_token = refresh_access_token(state).await?;
        let mut req = c.request(method, url).bearer_auth(&new_token);
        if let Some(b) = body {
            req = req.json(&b);
        }
        return req.send().await.map_err(|e| e.to_string());
    }

    Ok(resp)
}

/// Extract error message from non-success response.
pub async fn api_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or_default();
    body.get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Request failed ({})", status))
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/// Create a new server.
#[tauri::command]
pub async fn cmd_create_server(
    name: String,
    description: Option<String>,
    state: State<'_, AppState>,
) -> Result<ServerDto, String> {
    let url = format!("{}/servers", state.api_base_url);
    let resp = authed_request(
        &state,
        reqwest::Method::POST,
        &url,
        Some(serde_json::json!({ "name": name, "description": description })),
    ).await?;

    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ServerDto>().await.map_err(|e| e.to_string())
}

/// List all servers the user is a member of.
#[tauri::command]
pub async fn cmd_get_servers(state: State<'_, AppState>) -> Result<Vec<ServerDto>, String> {
    let url = format!("{}/servers", state.api_base_url);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { servers: Vec<ServerDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.servers)
}

/// Get a single server by ID.
#[tauri::command]
pub async fn cmd_get_server(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<ServerDto, String> {
    let url = format!("{}/servers/{}", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ServerDto>().await.map_err(|e| e.to_string())
}

/// Update a server.
#[tauri::command]
pub async fn cmd_update_server(
    server_id: String,
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    banner_color: Option<String>,
    state: State<'_, AppState>,
) -> Result<ServerDto, String> {
    let url = format!("{}/servers/{}", state.api_base_url, server_id);
    let mut body = serde_json::Map::new();
    if let Some(n) = name { body.insert("name".into(), serde_json::json!(n)); }
    if let Some(d) = description { body.insert("description".into(), serde_json::json!(d)); }
    if let Some(i) = icon { body.insert("icon".into(), serde_json::json!(i)); }
    if let Some(bc) = banner_color { body.insert("banner_color".into(), serde_json::json!(bc)); }

    let resp = authed_request(
        &state, reqwest::Method::PATCH, &url, Some(serde_json::Value::Object(body)),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ServerDto>().await.map_err(|e| e.to_string())
}

/// Delete a server (owner only).
#[tauri::command]
pub async fn cmd_delete_server(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/servers/{}", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MEMBER COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/// List members of a server.
#[tauri::command]
pub async fn cmd_get_server_members(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ServerMemberDto>, String> {
    let url = format!("{}/servers/{}/members", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { members: Vec<ServerMemberDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.members)
}

/// Add a member to a server.
#[tauri::command]
pub async fn cmd_add_server_member(
    server_id: String,
    target_user_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[cmd_add_server_member] server_id={}, target_user_id={}", server_id, target_user_id);
    let url = format!("{}/servers/{}/members", state.api_base_url, server_id);
    let resp = authed_request(
        &state, reqwest::Method::POST, &url,
        Some(serde_json::json!({ "target_user_id": target_user_id })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Remove / kick a member (or self-leave).
#[tauri::command]
pub async fn cmd_remove_server_member(
    server_id: String,
    target_user_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[cmd_remove_server_member] server_id={}, target_user_id={}", server_id, target_user_id);
    let url = format!("{}/servers/{}/members/{}", state.api_base_url, server_id, target_user_id);
    let body = reason.map(|r| serde_json::json!({ "reason": r }));
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, body).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHANNEL COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/// List channels in a server.
#[tauri::command]
pub async fn cmd_get_channels(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelDto>, String> {
    let url = format!("{}/servers/{}/channels", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { channels: Vec<ChannelDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.channels)
}

/// Create a channel.
#[tauri::command]
pub async fn cmd_create_channel(
    server_id: String,
    name: String,
    channel_type: Option<String>,
    topic: Option<String>,
    category_id: Option<String>,
    is_secure: Option<bool>,
    state: State<'_, AppState>,
) -> Result<ChannelDto, String> {
    println!("[cmd_create_channel] server_id={}, name={}, type={:?}, topic={:?}, category_id={:?}, is_secure={:?}", server_id, name, channel_type, topic, category_id, is_secure);
    let url = format!("{}/servers/{}/channels", state.api_base_url, server_id);
    let resp = authed_request(
        &state, reqwest::Method::POST, &url,
        Some(serde_json::json!({ "name": name, "type": channel_type, "topic": topic, "category_id": category_id, "is_secure": is_secure.unwrap_or(false) })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ChannelDto>().await.map_err(|e| e.to_string())
}

/// Update a channel.
#[tauri::command]
pub async fn cmd_update_channel(
    server_id: String,
    channel_id: String,
    name: Option<String>,
    topic: Option<String>,
    position: Option<i64>,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChannelDto, String> {
    let url = format!("{}/servers/{}/channels/{}", state.api_base_url, server_id, channel_id);
    let mut body = serde_json::Map::new();
    if let Some(n) = name { body.insert("name".into(), serde_json::json!(n)); }
    if let Some(t) = topic { body.insert("topic".into(), serde_json::json!(t)); }
    if let Some(p) = position { body.insert("position".into(), serde_json::json!(p)); }
    if category_id.is_some() { body.insert("category_id".into(), serde_json::json!(category_id)); }

    let resp = authed_request(
        &state, reqwest::Method::PATCH, &url, Some(serde_json::Value::Object(body)),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ChannelDto>().await.map_err(|e| e.to_string())
}

/// Delete a channel.
#[tauri::command]
pub async fn cmd_delete_channel(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/servers/{}/channels/{}", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Bulk-reorder channels — sends new positions in one request.
#[tauri::command]
pub async fn cmd_reorder_channels(
    server_id: String,
    channels: Vec<ChannelReorderPatch>,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelDto>, String> {
    let url = format!("{}/servers/{}/channels/reorder", state.api_base_url, server_id);
    let body = serde_json::json!({ "channels": channels });
    let resp = authed_request(&state, reqwest::Method::PATCH, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { channels: Vec<ChannelDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.channels)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROLE COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

/// List roles in a server.
#[tauri::command]
pub async fn cmd_get_roles(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDto>, String> {
    let url = format!("{}/servers/{}/roles", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { roles: Vec<RoleDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.roles)
}

/// Create a role.
#[tauri::command]
pub async fn cmd_create_role(
    server_id: String,
    name: String,
    color_hex: Option<String>,
    permissions: Option<String>,
    is_admin: Option<bool>,
    show_tag: Option<bool>,
    hoist: Option<bool>,
    tag_style: Option<String>,
    separate_members: Option<bool>,
    badge_image_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<RoleDto, String> {
    let url = format!("{}/servers/{}/roles", state.api_base_url, server_id);
    let resp = authed_request(
        &state, reqwest::Method::POST, &url,
        Some(serde_json::json!({
            "name": name,
            "color_hex": color_hex,
            "permissions": permissions,
            "is_admin": is_admin,
            "show_tag": show_tag,
            "hoist": hoist,
            "tag_style": tag_style,
            "separate_members": separate_members,
            "badge_image_url": badge_image_url,
        })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<RoleDto>().await.map_err(|e| e.to_string())
}

/// Update a role.
#[tauri::command]
pub async fn cmd_update_role(
    server_id: String,
    role_id: String,
    name: Option<String>,
    color_hex: Option<String>,
    permissions: Option<String>,
    is_admin: Option<bool>,
    show_tag: Option<bool>,
    hoist: Option<bool>,
    tag_style: Option<String>,
    separate_members: Option<bool>,
    badge_image_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<RoleDto, String> {
    let url = format!("{}/servers/{}/roles/{}", state.api_base_url, server_id, role_id);
    let mut body = serde_json::Map::new();
    if let Some(n) = name { body.insert("name".into(), serde_json::json!(n)); }
    if let Some(c) = color_hex { body.insert("color_hex".into(), serde_json::json!(c)); }
    if let Some(p) = permissions { body.insert("permissions".into(), serde_json::json!(p)); }
    if let Some(a) = is_admin { body.insert("is_admin".into(), serde_json::json!(a)); }
    if let Some(s) = show_tag { body.insert("show_tag".into(), serde_json::json!(s)); }
    if let Some(h) = hoist { body.insert("hoist".into(), serde_json::json!(h)); }
    if let Some(ts) = tag_style { body.insert("tag_style".into(), serde_json::json!(ts)); }
    if let Some(sm) = separate_members { body.insert("separate_members".into(), serde_json::json!(sm)); }
    if badge_image_url.is_some() { body.insert("badge_image_url".into(), serde_json::json!(badge_image_url)); }

    let resp = authed_request(
        &state, reqwest::Method::PATCH, &url, Some(serde_json::Value::Object(body)),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<RoleDto>().await.map_err(|e| e.to_string())
}

/// Delete a role.
#[tauri::command]
pub async fn cmd_delete_role(
    server_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/servers/{}/roles/{}", state.api_base_url, server_id, role_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Reorder roles.
#[tauri::command]
pub async fn cmd_reorder_roles(
    server_id: String,
    role_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<RoleDto>, String> {
    let url = format!("{}/servers/{}/roles/reorder", state.api_base_url, server_id);
    let resp = authed_request(
        &state, reqwest::Method::PUT, &url,
        Some(serde_json::json!({ "role_ids": role_ids })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { roles: Vec<RoleDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.roles)
}

/// Assign a role to a member.
#[tauri::command]
pub async fn cmd_assign_role(
    server_id: String,
    target_user_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[cmd_assign_role] server_id={}, target_user_id={}, role_id={}", server_id, target_user_id, role_id);
    let url = format!(
        "{}/servers/{}/members/{}/roles",
        state.api_base_url, server_id, target_user_id
    );
    let resp = authed_request(
        &state, reqwest::Method::POST, &url,
        Some(serde_json::json!({ "role_id": role_id })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Remove a role from a member.
#[tauri::command]
pub async fn cmd_remove_role(
    server_id: String,
    target_user_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[cmd_remove_role] server_id={}, target_user_id={}, role_id={}", server_id, target_user_id, role_id);
    let url = format!(
        "{}/servers/{}/members/{}/roles/{}",
        state.api_base_url, server_id, target_user_id, role_id
    );
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHANNEL PERMISSION OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════════

/// Get channel permission overrides.
#[tauri::command]
pub async fn cmd_get_channel_overrides(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelOverrideDto>, String> {
    let url = format!(
        "{}/servers/{}/channels/{}/overrides",
        state.api_base_url, server_id, channel_id
    );
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { overrides: Vec<ChannelOverrideDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.overrides)
}

/// Set channel permission override for a role.
#[tauri::command]
pub async fn cmd_set_channel_override(
    server_id: String,
    channel_id: String,
    role_id: String,
    allow_permissions: String,
    deny_permissions: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!(
        "{}/servers/{}/channels/{}/overrides",
        state.api_base_url, server_id, channel_id
    );
    let resp = authed_request(
        &state, reqwest::Method::PUT, &url,
        Some(serde_json::json!({
            "role_id": role_id,
            "allow_permissions": allow_permissions,
            "deny_permissions": deny_permissions,
        })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

/// Delete a channel permission override.
#[tauri::command]
pub async fn cmd_delete_channel_override(
    server_id: String,
    channel_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!(
        "{}/servers/{}/channels/{}/overrides/{}",
        state.api_base_url, server_id, channel_id, role_id
    );
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════════

/// Fetch audit log for a server.
#[tauri::command]
pub async fn cmd_get_audit_log(
    server_id: String,
    limit: Option<i64>,
    before: Option<String>,
    actor_id: Option<String>,
    action: Option<String>,
    target_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<AuditLogEntryDto>, String> {
    let mut url = format!("{}/servers/{}/audit-log?limit={}", state.api_base_url, server_id, limit.unwrap_or(50));
    if let Some(b) = before { url.push_str(&format!("&before={}", b)); }
    if let Some(a) = actor_id { url.push_str(&format!("&actor_id={}", a)); }
    if let Some(act) = action { url.push_str(&format!("&action={}", act)); }
    if let Some(tt) = target_type { url.push_str(&format!("&target_type={}", tt)); }

    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }

    #[derive(Deserialize)]
    struct Wrap { entries: Vec<AuditLogEntryDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.entries)
}

// ── Secure Channel Commands ─────────────────────────────────────────────────

/// Mark a channel as secure (owner only).
#[tauri::command]
pub async fn cmd_set_channel_secure(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/servers/{}/channels/{}/secure", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::POST, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Remove secure flag from a channel (owner only).
#[tauri::command]
pub async fn cmd_remove_channel_secure(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/servers/{}/channels/{}/secure", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Trigger lockdown on a secure channel (admin+).
#[tauri::command]
pub async fn cmd_trigger_lockdown(
    server_id: String,
    channel_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/servers/{}/channels/{}/lockdown", state.api_base_url, server_id, channel_id);
    let body = reason.map(|r| serde_json::json!({ "reason": r }));
    let resp = authed_request(&state, reqwest::Method::POST, &url, body).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Release lockdown on a secure channel (admin+).
#[tauri::command]
pub async fn cmd_release_lockdown(
    server_id: String,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/servers/{}/channels/{}/lockdown", state.api_base_url, server_id, channel_id);
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Fetch secure channel audit log (security_admin+).
#[tauri::command]
pub async fn cmd_get_secure_audit(
    server_id: String,
    channel_id: String,
    limit: Option<i64>,
    before: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut url = format!(
        "{}/servers/{}/channels/{}/secure/audit?limit={}",
        state.api_base_url, server_id, channel_id, limit.unwrap_or(50)
    );
    if let Some(b) = before { url.push_str(&format!("&before={}", b)); }
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

// ── Security Alert Commands ─────────────────────────────────────────────────

/// Create a security alert (security_admin+).
#[tauri::command]
pub async fn cmd_create_security_alert(
    server_id: String,
    channel_id: Option<String>,
    alert_type: String,
    severity: Option<String>,
    message: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/servers/{}/security/alerts", state.api_base_url, server_id);
    let body = Some(serde_json::json!({
        "channel_id": channel_id,
        "alert_type": alert_type,
        "severity": severity.unwrap_or_else(|| "medium".to_string()),
        "message": message,
    }));
    let resp = authed_request(&state, reqwest::Method::POST, &url, body).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Get security alerts for a server (moderator+).
#[tauri::command]
pub async fn cmd_get_security_alerts(
    server_id: String,
    limit: Option<i64>,
    channel_id: Option<String>,
    alert_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut url = format!(
        "{}/servers/{}/security/alerts?limit={}",
        state.api_base_url, server_id, limit.unwrap_or(50)
    );
    if let Some(ch) = channel_id { url.push_str(&format!("&channel_id={}", ch)); }
    if let Some(at) = alert_type { url.push_str(&format!("&alert_type={}", at)); }
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Resolve a security alert (security_admin+).
#[tauri::command]
pub async fn cmd_resolve_security_alert(
    server_id: String,
    alert_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/servers/{}/security/alerts/{}", state.api_base_url, server_id, alert_id);
    let resp = authed_request(&state, reqwest::Method::PATCH, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Get security audit log for a server (security_admin+).
#[tauri::command]
pub async fn cmd_get_security_audit(
    server_id: String,
    limit: Option<i64>,
    channel_id: Option<String>,
    action: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut url = format!(
        "{}/servers/{}/security/audit?limit={}",
        state.api_base_url, server_id, limit.unwrap_or(50)
    );
    if let Some(ch) = channel_id { url.push_str(&format!("&channel_id={}", ch)); }
    if let Some(a) = action { url.push_str(&format!("&action={}", a)); }
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}
