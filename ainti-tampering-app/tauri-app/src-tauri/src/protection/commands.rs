//! Tauri commands for the protection system
//!
//! These are the safe commands exposed to the untrusted frontend.
//! All validation happens here before delegating to the manager.

use crate::protection::{ProtectionError, Result};
use crate::protection::models::*;
use crate::protection::manager::ProtectionManager;
use crate::protection::scanner::ScanMode;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// Shared state type for Tauri
pub type ProtectionState = Arc<RwLock<ProtectionManager>>;

/// Initialize protection state (call during app setup)
pub fn init_protection_state() -> Result<ProtectionState> {
    let manager = ProtectionManager::init()?;
    Ok(Arc::new(RwLock::new(manager)))
}

// ============================================================================
// Command DTOs (Data Transfer Objects)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPathRequest {
    pub path: String,
    pub display_name: Option<String>,
    pub settings: Option<PathSettings>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub path_id: String,
    #[serde(default)]
    pub mode: String, // "quick" | "full" | "paranoid"
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptChangesRequest {
    pub path_id: String,
    pub scan_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    pub scan_id: String,
    pub path_id: String,
    pub status: String,
    pub totals: ScanTotals,
    pub duration_ms: u64,
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Add a protected path
#[tauri::command]
pub async fn protection_add_path(
    request: AddPathRequest,
    state: State<'_, ProtectionState>,
) -> std::result::Result<ProtectedPath, String> {
    let manager = state.read().await;
    
    manager.add_protected_path(
        &request.path,
        request.display_name.as_deref(),
        request.settings,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Remove a protected path
#[tauri::command]
pub async fn protection_remove_path(
    path_id: String,
    state: State<'_, ProtectionState>,
) -> std::result::Result<(), String> {
    let manager = state.read().await;
    manager.remove_protected_path(&path_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get all protected paths
#[tauri::command]
pub async fn protection_get_paths(
    state: State<'_, ProtectionState>,
) -> std::result::Result<Vec<ProtectedPath>, String> {
    let manager = state.read().await;
    manager.get_all_paths()
        .map_err(|e| e.to_string())
}

/// Get path summary
#[tauri::command]
pub async fn protection_get_path_summary(
    path_id: String,
    state: State<'_, ProtectionState>,
) -> std::result::Result<PathSummary, String> {
    let manager = state.read().await;
    manager.get_path_summary(&path_id)
        .map_err(|e| e.to_string())
}

/// Scan a path
#[tauri::command]
pub async fn protection_scan_path(
    request: ScanRequest,
    state: State<'_, ProtectionState>,
) -> std::result::Result<ScanResponse, String> {
    let mode = match request.mode.as_str() {
        "quick" => ScanMode::Quick,
        "paranoid" => ScanMode::Paranoid,
        _ => ScanMode::Full,
    };
    
    let manager = state.read().await;
    let result = manager.scan_path(&request.path_id, mode, None)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(ScanResponse {
        scan_id: result.scan_id,
        path_id: result.path_id,
        status: result.result_status.as_str().to_string(),
        totals: result.totals.clone(),
        duration_ms: result.totals.duration_ms,
    })
}

/// Scan all paths
#[tauri::command]
pub async fn protection_scan_all(
    mode: Option<String>,
    state: State<'_, ProtectionState>,
) -> std::result::Result<Vec<ScanResponse>, String> {
    let mode = match mode.as_deref() {
        Some("quick") => ScanMode::Quick,
        Some("paranoid") => ScanMode::Paranoid,
        _ => ScanMode::Full,
    };
    
    let manager = state.read().await;
    let results = manager.scan_all(mode)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(results.into_iter().map(|r| ScanResponse {
        scan_id: r.scan_id,
        path_id: r.path_id,
        status: r.result_status.as_str().to_string(),
        totals: r.totals.clone(),
        duration_ms: r.totals.duration_ms,
    }).collect())
}

/// Accept changes and update baseline
#[tauri::command]
pub async fn protection_accept_changes(
    request: AcceptChangesRequest,
    state: State<'_, ProtectionState>,
) -> std::result::Result<i32, String> {
    let manager = state.read().await;
    manager.accept_changes(&request.path_id, &request.scan_id)
        .map_err(|e| e.to_string())
}

/// Get diffs for a scan
#[tauri::command]
pub async fn protection_get_diffs(
    scan_id: String,
    state: State<'_, ProtectionState>,
) -> std::result::Result<Vec<FileDiff>, String> {
    let manager = state.read().await;
    manager.get_diffs(&scan_id)
        .map_err(|e| e.to_string())
}

/// Verify event chain
#[tauri::command]
pub async fn protection_verify_chain(
    state: State<'_, ProtectionState>,
) -> std::result::Result<ChainVerificationResult, String> {
    let manager = state.read().await;
    manager.verify_event_chain()
        .map_err(|e| e.to_string())
}

/// Get recent events
#[tauri::command]
pub async fn protection_get_events(
    limit: Option<u32>,
    state: State<'_, ProtectionState>,
) -> std::result::Result<Vec<ChainEvent>, String> {
    let manager = state.read().await;
    manager.get_recent_events(limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

/// Get overall status
#[tauri::command]
pub async fn protection_get_status(
    state: State<'_, ProtectionState>,
) -> std::result::Result<String, String> {
    let manager = state.read().await;
    let status = manager.get_overall_status().await;
    Ok(status.as_str().to_string())
}

/// Reset baseline for a path
#[tauri::command]
pub async fn protection_reset_baseline(
    path_id: String,
    state: State<'_, ProtectionState>,
) -> std::result::Result<(), String> {
    let manager = state.read().await;
    manager.reset_baseline(&path_id)
        .map_err(|e| e.to_string())
}

/// Clear event chain (danger zone)
#[tauri::command]
pub async fn protection_clear_events(
    state: State<'_, ProtectionState>,
) -> std::result::Result<(), String> {
    let manager = state.read().await;
    manager.clear_event_chain()
        .map_err(|e| e.to_string())
}

/// Export public key for external verification
#[tauri::command]
pub async fn protection_export_public_key(
    state: State<'_, ProtectionState>,
) -> std::result::Result<String, String> {
    let manager = state.read().await;
    manager.export_public_key()
        .map_err(|e| e.to_string())
}

/// Get chain validity status
#[tauri::command]
pub async fn protection_is_chain_valid(
    state: State<'_, ProtectionState>,
) -> std::result::Result<bool, String> {
    let manager = state.read().await;
    Ok(manager.is_chain_valid().await)
}

// ============================================================================
// Command Registration Helper
// ============================================================================

/// Get all protection command handlers for registration
/// Call this in main.rs: .invoke_handler(tauri::generate_handler![...protection_commands()...])
pub fn get_command_handlers() -> Vec<&'static str> {
    vec![
        "protection_add_path",
        "protection_remove_path",
        "protection_get_paths",
        "protection_get_path_summary",
        "protection_scan_path",
        "protection_scan_all",
        "protection_accept_changes",
        "protection_get_diffs",
        "protection_verify_chain",
        "protection_get_events",
        "protection_get_status",
        "protection_reset_baseline",
        "protection_clear_events",
        "protection_export_public_key",
        "protection_is_chain_valid",
    ]
}
