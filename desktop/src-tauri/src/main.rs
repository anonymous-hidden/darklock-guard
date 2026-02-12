#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use guard_core::{
    device_state::DeviceState,
    ipc::{IpcRequest, IpcResponse},
    ipc_client::send_request,
    paths::{data_dir, ipc_socket_path},
    safe_mode::SafeModeReason,
    secure_storage::get_ipc_secret,
    settings::GuardSettings,
    vault::{SecurityProfile, Vault},
};
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

async fn ipc_settings_request(request: IpcRequest) -> Result<IpcResponse, String> {
    let state = status_client::fetch_device_state()
        .await
        .map_err(|_| "Guard service unavailable".to_string())?;
    let device_id = state
        .device_id
        .ok_or_else(|| "Device ID unavailable".to_string())?;
    
    // Try to get IPC secret from keyring, fallback to loading from vault
    let secret = match get_ipc_secret(&device_id) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("⚠️  Failed to load IPC secret from keyring: {}. Attempting vault fallback...", e);
            // Fallback: load secret directly from vault
            load_ipc_secret_from_vault()?
        }
    };
    
    let socket_path = ipc_socket_path().map_err(|e| e.to_string())?;
    send_request(socket_path, &secret, request)
        .await
        .map_err(|e| e.to_string())
}

fn load_ipc_secret_from_vault() -> Result<Vec<u8>, String> {
    use std::env;
    let dir = data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
    let vault_path = dir.join("vault.dat");
    
    let password = env::var("GUARD_VAULT_PASSWORD")
        .map_err(|_| "Vault password not available. Set GUARD_VAULT_PASSWORD environment variable.".to_string())?;
    
    let vault = Vault::open(&vault_path, &password)
        .map_err(|e| format!("Failed to open vault: {}", e))?;
    
    let secret = vault.ipc_shared_secret()
        .map_err(|e| format!("Failed to extract IPC secret from vault: {}", e))?;
    
    Ok(secret)
}

#[tauri::command]
async fn get_status() -> Result<ServiceStatus, String> {
    let device_state = status_client::fetch_device_state()
        .await
        .map_err(|_| "Guard service unavailable".to_string())?;
    Ok(map_device_state_to_status(&device_state))
}

#[tauri::command]
async fn get_settings() -> Result<GuardSettings, String> {
    match ipc_settings_request(IpcRequest::GetSettings).await? {
        IpcResponse::Settings { settings } => Ok(settings),
        _ => Err("Unexpected IPC response".to_string()),
    }
}

#[tauri::command]
async fn update_settings(settings: GuardSettings) -> Result<(), String> {
    match ipc_settings_request(IpcRequest::UpdateSettings { settings }).await? {
        IpcResponse::SettingsUpdated => Ok(()),
        _ => Err("Unexpected IPC response".to_string()),
    }
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
    // Try to read events from the guard service via IPC
    match ipc_settings_request(IpcRequest::GetEvents { since: None, limit: Some(100) }).await {
        Ok(IpcResponse::Events { events }) => {
            serde_json::to_value(events).map_err(|e| e.to_string())
        }
        Ok(_) => Ok(serde_json::json!([])),
        Err(_) => Ok(serde_json::json!([])),
    }
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
    match ipc_settings_request(IpcRequest::TriggerScan).await {
        Ok(IpcResponse::ScanComplete { result }) => {
            Ok(serde_json::json!({
                "ok": true,
                "result": result
            }))
        }
        Ok(_) => Err("Unexpected response from guard service".into()),
        Err(e) => Err(format!("Scan failed: {}", e)),
    }
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

#[tauri::command]
async fn send_crash_report(report: serde_json::Value) -> Result<serde_json::Value, String> {
    let platform_url = std::env::var("DARKLOCK_PLATFORM_URL")
        .unwrap_or_else(|_| "https://darklock.net".to_string());
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    
    let response = client
        .post(format!("{}/api/admin/telemetry/report", platform_url))
        .json(&report)
        .send()
        .await
        .map_err(|e| format!("Failed to send report: {}", e))?;
    
    if response.status().is_success() {
        Ok(serde_json::json!({"ok": true}))
    } else {
        // Still return ok — we don't want crash reporting to itself cause issues
        Ok(serde_json::json!({"ok": false, "status": response.status().as_u16()}))
    }
}

#[derive(Debug, Deserialize)]
struct InitVaultArgs {
    password: String,
    mode: String,
    security_profile: String,
}

#[tauri::command]
async fn init_vault(args: InitVaultArgs) -> Result<serde_json::Value, String> {
    let dir = data_dir().map_err(|e| format!("Failed to determine data dir: {e}"))?;
    let path = dir.join("vault.dlock");

    if path.exists() {
        return Err("Vault already exists. Reset it first or delete the vault file.".into());
    }

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create vault directory: {e}"))?;
    }

    let vault = Vault::create_new(&path, &args.password)
        .map_err(|e| format!("Vault creation failed: {e}"))?;

    let device_id = vault.payload.device_id.clone();
    let public_key = vault.payload.device_public_key.clone();

    Ok(serde_json::json!({
        "ok": true,
        "device_id": device_id,
        "public_key": public_key,
        "vault_path": path.to_string_lossy(),
        "mode": args.mode,
        "security_profile": args.security_profile
    }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            update_settings,
            get_capabilities,
            get_events,
            get_device_state,
            trigger_scan,
            update_check,
            update_install,
            update_rollback,
            init_vault,
            send_crash_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
