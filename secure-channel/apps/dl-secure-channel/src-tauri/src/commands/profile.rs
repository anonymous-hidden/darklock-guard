//! Profile Tauri commands.
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileDto {
    pub user_id: String,
    pub username: String,
    pub email: String,
    pub identity_pubkey: String,
    pub fingerprint: String,
    pub devices: Vec<DeviceDto>,
    pub created_at: String,
    pub system_role: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceDto {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub device_pubkey: String,
    pub enrolled_at: String,
    pub is_current_device: bool,
    pub fingerprint: String,
}

#[tauri::command]
pub async fn cmd_get_profile(state: State<'_, AppState>) -> Result<ProfileDto, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    let (user_id, username, email, identity_pubkey, created_at): (String,String,String,String,String) =
        sqlx::query_as("SELECT user_id, username, email, identity_pubkey, created_at FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let fp = dl_crypto::identity::PublicKeyBytes(
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &identity_pubkey)
            .unwrap_or_default()
    ).fingerprint();

    let dev_rows: Vec<(String,String,String,String,String,bool)> = sqlx::query_as(
        r#"SELECT device_id, device_name, platform, device_pubkey, enrolled_at,
                  is_current_device as is_current_device
           FROM devices WHERE user_id = ?"#
    ).bind(&user_id).fetch_all(&store.pool).await.map_err(|e| e.to_string())?;

    let devices = dev_rows.into_iter().map(|(did, dname, platform, dpub, enrolled, is_cur)| {
        let dfp = dl_crypto::identity::PublicKeyBytes(
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &dpub)
                .unwrap_or_default()
        ).fingerprint();
        DeviceDto {
            device_id: did,
            device_name: dname,
            platform,
            device_pubkey: dpub,
            enrolled_at: enrolled,
            is_current_device: is_cur,
            fingerprint: dfp,
        }
    }).collect();

    let system_role = state.get_system_role().await;
    eprintln!("[DEBUG profile] cmd_get_profile: system_role from AppState = {:?}", system_role);

    // If AppState has no role (e.g. session survived restart), fetch from IDS profile endpoint.
    let system_role = if system_role.is_none() {
        #[derive(Deserialize)]
        struct IdsProfileResp { system_role: Option<String> }
        let token = state.get_token().await;
        let fetched: Option<String> = if let Some(tok) = token {
            let client = reqwest::Client::builder().use_rustls_tls().build();
            if let Ok(client) = client {
                let url = format!("{}/users/{}/profile", state.api_base_url, user_id);
                let resp = client.get(&url).bearer_auth(&tok).send().await;
                if let Ok(r) = resp {
                    r.json::<IdsProfileResp>().await.ok().and_then(|p| p.system_role)
                } else { None }
            } else { None }
        } else { None };
        eprintln!("[DEBUG profile] fetched system_role from IDS profile endpoint = {:?}", fetched);
        if fetched.is_some() {
            state.set_system_role(fetched.clone()).await;
        }
        fetched
    } else {
        system_role
    };

    Ok(ProfileDto { user_id, username, email, identity_pubkey, fingerprint: fp, devices, created_at, system_role })
}

/// Rotate device key — generates new device key + cert, uploads to IDS.
#[tauri::command]
pub async fn cmd_rotate_device_key(state: State<'_, AppState>) -> Result<(), String> {
    // REPLACE_ME: implement device key rotation with user warning
    Err("Device key rotation not yet implemented in v1 — ensure you have a backup identity key".to_string())
}

/// Update the user's display name (stored locally in settings).
#[tauri::command]
pub async fn cmd_update_profile(
    display_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('display_name', ?, datetime('now')) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(&display_name)
    .execute(&store.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a non-current device from the vault (+ best-effort IDS revocation).
#[tauri::command]
pub async fn cmd_remove_device(
    device_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    // Guard: cannot remove the device we are currently running on.
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT is_current_device FROM devices WHERE device_id = ?",
    )
    .bind(&device_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    match row {
        None => return Err("Device not found".to_string()),
        Some((1,)) => return Err("Cannot remove the current device from this device".to_string()),
        _ => {}
    }

    sqlx::query("DELETE FROM devices WHERE device_id = ?")
        .bind(&device_id)
        .execute(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    // Best-effort: ask IDS to revoke the device key
    if let Some(token) = state.get_token().await {
        if let Ok(client) = reqwest::Client::builder().use_rustls_tls().build() {
            let _ = client
                .delete(format!("{}/devices/{}", state.api_base_url, device_id))
                .bearer_auth(&token)
                .send()
                .await;
        }
    }

    Ok(())
}

/// Return the base64 identity public key for the current account.
#[tauri::command]
pub async fn cmd_export_identity_key(state: State<'_, AppState>) -> Result<String, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let (pubkey,): (String,) =
        sqlx::query_as("SELECT identity_pubkey FROM accounts LIMIT 1")
            .fetch_one(&store.pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(pubkey)
}

/// Public profile data fetched from IDS for a contact.
#[derive(Debug, Serialize, Deserialize)]
pub struct ContactProfileDto {
    pub user_id: String,
    pub username: String,
    pub profile_bio: Option<String>,
    pub pronouns: Option<String>,
    pub custom_status: Option<String>,
    pub profile_color: Option<String>,
    pub avatar: Option<String>,
    pub banner: Option<String>,
}

/// Fetch a contact's public profile from IDS (/users/:id/profile).
#[tauri::command]
pub async fn cmd_get_contact_profile(
    user_id: String,
    state: State<'_, AppState>,
) -> Result<ContactProfileDto, String> {
    let mut token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    let url = format!("{}/users/{}/profile", state.api_base_url, user_id);
    let resp = client.get(&url).bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    let resp = if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        token = crate::commands::auth::refresh_access_token(&state).await
            .map_err(|e| format!("Token refresh failed: {e}"))?;
        client.get(&url).bearer_auth(&token).send().await.map_err(|e| e.to_string())?
    } else { resp };

    if !resp.status().is_success() {
        return Err(format!("IDS returned {}", resp.status()));
    }
    resp.json::<ContactProfileDto>().await.map_err(|e| e.to_string())
}

/// Push the current user's public profile fields to IDS.
#[tauri::command]
pub async fn cmd_update_public_profile(
    profile_bio: Option<String>,
    pronouns: Option<String>,
    custom_status: Option<String>,
    profile_color: Option<String>,
    avatar: Option<String>,
    banner: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "profile_bio": profile_bio,
        "pronouns": pronouns,
        "custom_status": custom_status,
        "profile_color": profile_color,
        "avatar": avatar,
        "banner": banner,
    });

    let url = format!("{}/users/me/profile", state.api_base_url);
    let resp = client.put(&url).bearer_auth(&token).json(&body).send().await.map_err(|e| e.to_string())?;
    let resp = if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        token = crate::commands::auth::refresh_access_token(&state).await
            .map_err(|e| format!("Token refresh failed: {e}"))?;
        client.put(&url).bearer_auth(&token).json(&body).send().await.map_err(|e| e.to_string())?
    } else { resp };

    if resp.status().is_success() { Ok(()) } else {
        Err(format!("IDS returned {}", resp.status()))
    }
}
