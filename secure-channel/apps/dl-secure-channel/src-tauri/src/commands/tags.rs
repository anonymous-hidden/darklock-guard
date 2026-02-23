use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;
use super::servers::{authed_request, api_error};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTagDto {
    pub id: String,
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    pub color_hex: String,
    #[serde(default)]
    pub position: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyTagsDto {
    pub max_selected: i64,
    #[serde(default)]
    pub granted: Vec<UserTagDto>,
    #[serde(default)]
    pub selected: Vec<UserTagDto>,
}

#[tauri::command]
pub async fn cmd_get_my_tags(
    state: State<'_, AppState>,
) -> Result<MyTagsDto, String> {
    let url = format!("{}/users/me/tags", state.api_base_url);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    resp.json::<MyTagsDto>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_update_selected_tags(
    tag_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = format!("{}/users/me/tags/selected", state.api_base_url);
    let resp = authed_request(
        &state,
        reqwest::Method::PUT,
        &url,
        Some(serde_json::json!({ "tag_ids": tag_ids })),
    ).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_user_tags(
    user_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<UserTagDto>, String> {
    let url = format!("{}/users/{}/tags", state.api_base_url, user_id);
    let resp = authed_request(&state, reqwest::Method::GET, &url, None).await?;
    if !resp.status().is_success() { return Err(api_error(resp).await); }
    #[derive(Deserialize)]
    struct Wrap { selected: Vec<UserTagDto> }
    let w: Wrap = resp.json().await.map_err(|e| e.to_string())?;
    Ok(w.selected)
}
