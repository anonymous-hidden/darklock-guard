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
        events: true,
        scans: true,
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

#[derive(serde::Serialize)]
struct SystemMetrics {
    cpu_percent: f32,
    memory_used_mb: u64,
    memory_total_mb: u64,
    memory_percent: f32,
}

#[tauri::command]
async fn get_system_metrics() -> Result<SystemMetrics, String> {
    use sysinfo::System;
    
    let mut sys = System::new_all();
    sys.refresh_cpu();
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    sys.refresh_cpu();
    sys.refresh_memory();
    
    let cpu_percent = sys.global_cpu_info().cpu_usage();
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    let memory_used_mb = memory_used / 1024 / 1024;
    let memory_total_mb = memory_total / 1024 / 1024;
    let memory_percent = if memory_total > 0 {
        (memory_used as f32 / memory_total as f32) * 100.0
    } else {
        0.0
    };
    
    Ok(SystemMetrics {
        cpu_percent,
        memory_used_mb,
        memory_total_mb,
        memory_percent,
    })
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
    match ipc_settings_request(IpcRequest::GetEvents { since: None, limit: Some(200) }).await {
        Ok(IpcResponse::Events { events }) => {
            // Transform backend EventEntry format to frontend-compatible format
            let transformed: Vec<serde_json::Value> = events.into_iter().map(|e| {
                let event_type = e.get("event_type").and_then(|v| v.as_str()).unwrap_or("UNKNOWN").to_string();
                let severity = e.get("severity").and_then(|v| v.as_str()).unwrap_or("INFO").to_string();
                let timestamp = e.get("timestamp").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let data = e.get("data").cloned().unwrap_or(serde_json::json!({}));
                let seq = e.get("seq").and_then(|v| v.as_u64()).unwrap_or(0);
                let hash = e.get("hash").and_then(|v| v.as_str()).unwrap_or("").to_string();
                
                // Build detail string from data
                let detail = if let Some(obj) = data.as_object() {
                    let mut parts = Vec::new();
                    if let Some(path) = obj.get("path").and_then(|v| v.as_str()) {
                        parts.push(format!("Path: {}", path));
                    }
                    if let Some(kind) = obj.get("kind").and_then(|v| v.as_str()) {
                        parts.push(format!("Type: {}", kind));
                    }
                    if let Some(files) = obj.get("files").and_then(|v| v.as_u64()) {
                        parts.push(format!("{} files", files));
                    }
                    if let Some(expected) = obj.get("expected_hash").and_then(|v| v.as_str()) {
                        parts.push(format!("Expected: {}…", &expected[..12.min(expected.len())]));
                    }
                    if let Some(actual) = obj.get("actual_hash").and_then(|v| v.as_str()) {
                        parts.push(format!("Actual: {}…", &actual[..12.min(actual.len())]));
                    }
                    if parts.is_empty() {
                        serde_json::to_string(&data).unwrap_or_default()
                    } else {
                        parts.join(" | ")
                    }
                } else {
                    String::new()
                };
                
                serde_json::json!({
                    "event_type": event_type,
                    "severity": severity,
                    "timestamp": timestamp,
                    "data": data,
                    "detail": detail,
                    "seq": seq,
                    "hash": hash,
                })
            }).collect();
            Ok(serde_json::json!({ "events": transformed }))
        }
        Ok(_) => Ok(serde_json::json!({ "events": [] })),
        Err(e) => {
            eprintln!("Failed to fetch events: {}", e);
            Ok(serde_json::json!({ "events": [] }))
        }
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
async fn update_check(channel: Option<String>) -> Result<serde_json::Value, String> {
    let channel = channel.unwrap_or_else(|| "stable".to_string());
    let current_version = env!("CARGO_PKG_VERSION");
    let platform = if cfg!(target_os = "windows") { "windows" }
                   else if cfg!(target_os = "macos") { "macos" }
                   else { "linux" };

    let platform_url = std::env::var("VITE_PLATFORM_URL")
        .or_else(|_| std::env::var("DARKLOCK_PLATFORM_URL"))
        .unwrap_or_else(|_| "https://platform.darklock.net".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Primary endpoint — updater manifest with channel
    let manifest_url = format!(
        "{}/platform/api/updates/{}/{}?channel={}",
        platform_url, platform, current_version, channel
    );

    match client.get(&manifest_url).send().await {
        Ok(r) if r.status() == 204 => {
            return Ok(serde_json::json!({ "available": false }));
        }
        Ok(r) if r.status().is_success() => {
            if let Ok(body) = r.json::<serde_json::Value>().await {
                let has_version = body.get("version").and_then(|v| v.as_str()).is_some();
                if has_version {
                    return Ok(serde_json::json!({
                        "available": true,
                        "version": body.get("version"),
                        "notes": body.get("notes"),
                        "force": body.get("force"),
                        "minVersion": body.get("min_version"),
                        "downloadUrl": body.get("platforms")
                            .and_then(|p| p.as_object())
                            .and_then(|p| p.get(platform).or_else(|| p.values().next()))
                            .and_then(|e| e.get("url"))
                            .and_then(|u| u.as_str()),
                        "channel": body.get("channel").and_then(|c| c.as_str()).unwrap_or(&channel),
                    }));
                }
            }
        }
        _ => {}
    }

    // Fallback — polling endpoint
    let fallback_url = format!(
        "{}/api/v4/admin/app/latest-update?channel={}",
        platform_url, channel
    );
    if let Ok(fr) = client.get(&fallback_url).send().await {
        if fr.status().is_success() {
            if let Ok(bd) = fr.json::<serde_json::Value>().await {
                let available = bd.get("available").and_then(|v| v.as_bool()).unwrap_or(false);
                return Ok(bd.clone().as_object_mut().map(|m| {
                    m.insert("available".into(), serde_json::json!(available));
                    serde_json::Value::Object(m.clone())
                }).unwrap_or(bd));
            }
        }
    }

    Ok(serde_json::json!({ "available": false }))
}

#[tauri::command]
async fn update_install(channel: Option<String>) -> Result<serde_json::Value, String> {
    let channel = channel.unwrap_or_else(|| "stable".to_string());

    // Check for available update first
    let update_info = update_check(Some(channel.clone())).await?;
    if !update_info.get("available").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err("No update available".into());
    }

    let version = update_info.get("version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No version in update info".to_string())?
        .to_string();

    let platform_url = std::env::var("VITE_PLATFORM_URL")
        .or_else(|_| std::env::var("DARKLOCK_PLATFORM_URL"))
        .unwrap_or_else(|_| "https://platform.darklock.net".to_string());

    let platform = if cfg!(target_os = "windows") { "windows" }
                   else if cfg!(target_os = "macos") { "macos" }
                   else { "linux" };

    let download_url = update_info.get("downloadUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!(
            "{}/platform/api/updates/download/{}?platform={}",
            platform_url, version, platform
        ));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client.get(&download_url).send().await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Server returned {} for download", resp.status()));
    }

    // Determine filename from Content-Disposition or URL
    let filename = resp.headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split("filename=").nth(1)
             .and_then(|part| part.split('"').nth(1).or_else(|| part.split(';').next()))
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let ext = if cfg!(target_os = "windows") { "exe" } else if cfg!(target_os = "macos") { "dmg" } else { "deb" };
            format!("darklock-guard-{}.{}", version, ext)
        });

    let bytes = resp.bytes().await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    let dir = data_dir().map_err(|e| format!("Data dir error: {}", e))?.join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Create dir failed: {}", e))?;

    let dest = dir.join(&filename);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Save failed: {}", e))?;

    Ok(serde_json::json!({
        "ok": true,
        "version": version,
        "channel": channel,
        "path": dest.to_string_lossy(),
        "size": bytes.len(),
        "message": format!(
            "Update v{} ({}) downloaded to {}. Run the installer to apply.",
            version, channel, dest.display()
        )
    }))
}

#[tauri::command]
async fn update_rollback(_backup_manifest: String) -> Result<serde_json::Value, String> {
    Err("Manual rollback is not supported. Please reinstall the previous version.".into())
}

#[tauri::command]
async fn create_baseline() -> Result<serde_json::Value, String> {
    match ipc_settings_request(IpcRequest::BaselineCreate).await {
        Ok(IpcResponse::BaselineCreated { entries }) => {
            Ok(serde_json::json!({ "entries": entries }))
        }
        Ok(_) => Err("Unexpected response".into()),
        Err(e) => Err(format!("Failed to create baseline: {}", e)),
    }
}

#[tauri::command]
async fn verify_baseline() -> Result<serde_json::Value, String> {
    match ipc_settings_request(IpcRequest::BaselineVerify).await {
        Ok(IpcResponse::BaselineVerified { valid, detail }) => {
            Ok(serde_json::json!({ "valid": valid, "detail": detail }))
        }
        Ok(_) => Err("Unexpected response".into()),
        Err(e) => Err(format!("Failed to verify baseline: {}", e)),
    }
}

#[tauri::command]
async fn send_crash_report(report: serde_json::Value) -> Result<serde_json::Value, String> {
    let platform_url = std::env::var("DARKLOCK_PLATFORM_URL")
        .unwrap_or_else(|_| "https://platform.darklock.net".to_string());
    
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
async fn check_first_run() -> Result<serde_json::Value, String> {
    let dir = data_dir().map_err(|e| format!("Failed to determine data dir: {e}"))?;
    let vault_path = dir.join("vault.dlock");
    let vault_alt = dir.join("vault.dat");
    
    let vault_exists = vault_path.exists() || vault_alt.exists();
    
    Ok(serde_json::json!({
        "needs_setup": !vault_exists,
        "vault_path": vault_path.to_string_lossy()
    }))
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

#[tauri::command]
async fn lock_vault(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // Lock vault by exiting the application
    // When app closes, the vault password is cleared from memory
    app_handle.exit(0);
    Ok(serde_json::json!({"ok": true}))
}

#[tauri::command]
async fn delete_vault() -> Result<serde_json::Value, String> {
    let dir = data_dir().map_err(|e| format!("Failed to determine data dir: {e}"))?;
    let removed: Vec<String> = ["vault.dlock", "vault.dat"]
        .iter()
        .filter_map(|name| {
            let p = dir.join(name);
            if p.exists() {
                std::fs::remove_file(&p).ok()?;
                Some(p.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();
    Ok(serde_json::json!({ "ok": true, "removed": removed }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_system_metrics,
            get_settings,
            update_settings,
            get_capabilities,
            get_events,
            get_device_state,
            trigger_scan,
            update_check,
            update_install,
            update_rollback,
            check_first_run,
            init_vault,
            lock_vault,
            delete_vault,
            create_baseline,
            verify_baseline,
            send_crash_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
