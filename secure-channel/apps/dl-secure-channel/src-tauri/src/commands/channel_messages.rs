//! Tauri commands for server channel messages.
//! Thin HTTP wrappers around the IDS channel-messages endpoints.

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;
use crate::commands::auth::refresh_access_token;

// Re-use helpers from servers module
use super::servers::{authed_request, api_error};

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelMessageDto {
    pub id: String,
    pub server_id: String,
    pub channel_id: String,
    pub author_id: String,
    pub author_username: Option<String>,
    pub content: String,
    #[serde(rename = "type", default = "default_msg_type")]
    pub msg_type: String,
    pub reply_to_id: Option<String>,
    pub edited_at: Option<String>,
    pub created_at: String,
}

fn default_msg_type() -> String { "text".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelUnreadDto {
    pub unread_count: i64,
    pub mention_count: i64,
    pub last_read_at: Option<String>,
    pub last_read_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerUnreadDto {
    pub server_id: String,
    pub has_unread: bool,
    pub mention_count: i64,
    pub channels: std::collections::HashMap<String, ChannelUnreadDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MentionNotificationDto {
    pub id: String,
    pub user_id: String,
    pub server_id: String,
    pub channel_id: String,
    pub message_id: String,
    pub created_at: String,
    pub read_at: Option<String>,
    pub content: Option<String>,
    #[serde(rename = "type")]
    pub message_type: Option<String>,
    pub author_id: Option<String>,
    pub author_username: Option<String>,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Fetch channel messages (paginated, newest last).
#[tauri::command]
pub async fn cmd_get_channel_messages(
    server_id: String,
    channel_id: String,
    limit: Option<u32>,
    before: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelMessageDto>, String> {
    let mut url = format!(
        "{}/servers/{}/channels/{}/messages?limit={}",
        state.api_base_url, server_id, channel_id, limit.unwrap_or(50)
    );
    if let Some(b) = before {
        url.push_str(&format!("&before={}", b));
    }

    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<Vec<ChannelMessageDto>>().await.map_err(|e| e.to_string())
}

/// Send a message to a server channel.
#[tauri::command]
pub async fn cmd_send_channel_message(
    server_id: String,
    channel_id: String,
    content: String,
    reply_to_id: Option<String>,
    msg_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChannelMessageDto, String> {
    let url = format!(
        "{}/servers/{}/channels/{}/messages",
        state.api_base_url, server_id, channel_id
    );
    let body = serde_json::json!({
        "content": content,
        "type": msg_type.unwrap_or_else(|| "text".into()),
        "reply_to_id": reply_to_id,
    });
    let resp = authed_request(&state, reqwest::Method::POST, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ChannelMessageDto>().await.map_err(|e| e.to_string())
}

/// Edit a channel message.
#[tauri::command]
pub async fn cmd_edit_channel_message(
    server_id: String,
    channel_id: String,
    message_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<ChannelMessageDto, String> {
    let url = format!(
        "{}/servers/{}/channels/{}/messages/{}",
        state.api_base_url, server_id, channel_id, message_id
    );
    let body = serde_json::json!({ "content": content });
    let resp = authed_request(&state, reqwest::Method::PATCH, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ChannelMessageDto>().await.map_err(|e| e.to_string())
}

/// Delete a channel message.
#[tauri::command]
pub async fn cmd_delete_channel_message(
    server_id: String,
    channel_id: String,
    message_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!(
        "{}/servers/{}/channels/{}/messages/{}",
        state.api_base_url, server_id, channel_id, message_id
    );
    let resp = authed_request(&state, reqwest::Method::DELETE, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_mark_channel_read(
    server_id: String,
    channel_id: String,
    last_read_message_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!(
        "{}/servers/{}/channels/{}/read",
        state.api_base_url, server_id, channel_id
    );
    let body = serde_json::json!({
        "last_read_message_id": last_read_message_id,
        "last_read_at": chrono::Utc::now().to_rfc3339(),
    });
    let resp = authed_request(&state, reqwest::Method::PUT, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_server_unread(
    server_id: String,
    state: State<'_, AppState>,
) -> Result<ServerUnreadDto, String> {
    let url = format!("{}/servers/{}/unread", state.api_base_url, server_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<ServerUnreadDto>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_mention_notifications(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<MentionNotificationDto>, String> {
    let url = format!("{}/users/me/mentions?limit={}", state.api_base_url, limit.unwrap_or(50));
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    #[derive(Deserialize)]
    struct Wrap { mentions: Vec<MentionNotificationDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.mentions)
}

#[tauri::command]
pub async fn cmd_mark_mentions_read(
    notification_ids: Option<Vec<String>>,
    all: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/users/me/mentions/read", state.api_base_url);
    let body = serde_json::json!({
        "notification_ids": notification_ids.unwrap_or_default(),
        "all": all.unwrap_or(false),
    });
    let resp = authed_request(&state, reqwest::Method::PATCH, &url, Some(body)).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}
