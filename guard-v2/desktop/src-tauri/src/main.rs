#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use guard_core::{device_state::DeviceState, safe_mode::SafeModeReason, vault::SecurityProfile};
use serde::{Deserialize, Serialize};

mod status_client;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CapabilityMap {
    pub updates: bool,
    pub events: bool,
    pub scans: bool,
    pub device_control: bool,
    pub connected_mode: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceStatus {
    pub ok: bool,
    pub mode: String,
    pub connected: bool,
    pub safe_mode_reason: Option<String>,
    pub version: Option<String>,
    pub vault_locked: Option<bool>,
    pub capabilities: CapabilityMap,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EventEntry {
    pub timestamp: String,
    pub severity: String,
    pub message: String,
}

fn map_device_state_to_status(state: &DeviceState) -> ServiceStatus {
    let safe_mode_active = state.safe_mode.unwrap_or(false);
    let mode = if safe_mode_active {
        "safemode".to_string()
    } else {
        match state.security_profile {
            Some(SecurityProfile::ZeroTrust) => "zerotrust".to_string(),
            _ if state.connected => "normal".to_string(),
            _ => "disconnected".to_string(),
        }
    };

    let safe_mode_reason = state.safe_mode_reason.as_ref().map(format_safe_mode_reason);

    let version = state.updates.as_ref().map(|u| u.installed_version.clone());

    ServiceStatus {
        ok: !safe_mode_active,
        mode,
        connected: state.connected,
        safe_mode_reason,
        version,
        vault_locked: None,
        capabilities: map_capabilities(state),
    }
}

fn map_capabilities(state: &DeviceState) -> CapabilityMap {
    CapabilityMap {
        updates: state.updates.is_some(),
        events: false,
        scans: false,
        device_control: false,
        connected_mode: state.connected,
    }
}

fn format_safe_mode_reason(reason: &SafeModeReason) -> String {
    match reason {
        SafeModeReason::Manual => "MANUAL",
        SafeModeReason::VaultCorrupt => "VAULT_CORRUPT",
        SafeModeReason::CryptoError => "CRYPTO_ERROR",
        SafeModeReason::ServiceCrashLoop => "SERVICE_CRASH_LOOP",
        SafeModeReason::IntegrityFailure => "INTEGRITY_FAILURE",
        SafeModeReason::IpcFailure => "IPC_FAILURE",
        SafeModeReason::RemoteCommand => "REMOTE_COMMAND",
        SafeModeReason::Unknown => "UNKNOWN",
    }
    .to_string()
}

#[tauri::command]
async fn get_status() -> Result<ServiceStatus, String> {
    let device_state = status_client::fetch_device_state()
        .await
        .map_err(|_| "Guard service unavailable".to_string())?;
    Ok(map_device_state_to_status(&device_state))
}

#[tauri::command]
async fn get_capabilities() -> Result<serde_json::Value, String> {
    let state = status_client::fetch_device_state()
        .await
        .map_err(|_| "Guard service unavailable".to_string())?;
    let caps = map_capabilities(&state);
    serde_json::to_value(caps).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_events() -> Result<serde_json::Value, String> {
    let events: Vec<EventEntry> = Vec::new();
    serde_json::to_value(events).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_device_state() -> Result<serde_json::Value, String> {
    match status_client::fetch_device_state().await {
        Ok(state) => serde_json::to_value(state).map_err(|e| e.to_string()),
        Err(_) => Ok(DeviceState::error("Guard service unavailable")),
    }
}

#[tauri::command]
async fn trigger_scan(_kind: String) -> Result<serde_json::Value, String> {
    Err("Scan endpoint not available".into())
}

#[tauri::command]
async fn update_check() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({"available": false, "version": null}))
}

#[tauri::command]
async fn update_install() -> Result<serde_json::Value, String> {
    Err("Update install not available".into())
}

#[tauri::command]
async fn update_rollback(_backup_manifest: String) -> Result<serde_json::Value, String> {
    Err("Rollback not available".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_capabilities,
            get_events,
            get_device_state,
            trigger_scan,
            update_check,
            update_install,
            update_rollback
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
