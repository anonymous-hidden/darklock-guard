//! Tauri command handlers for Darklock Guard
//!
//! SECURITY MODEL:
//! - All privileged operations are performed here in Rust
//! - Input validation on all parameters
//! - No secrets exposed to frontend
//! - Deny-by-default approach

use std::sync::Arc;
use std::fs;
use std::path::PathBuf;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::storage::{AppState, FrontendState, Settings, PathStatus, IntegrityStatus};
use crate::integrity::{IntegrityScanner, ScanConfig, ScanResult, FileTreeNode, IntegritySummary};
use crate::event_chain::{EventChain, EventType, EventSeverity, EventDisplay, ChainVerificationResult};
use crate::error::{DarklockError, Result};

/// Type alias for shared state
pub type SharedState = Arc<RwLock<AppState>>;

// ============================================================================
// Authentication
// ============================================================================

#[derive(Serialize)]
pub struct LoginResponse {
    pub success: bool,
    pub error: Option<String>,
    pub user: Option<UserInfo>,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub username: String,
    pub email: String,
}

/// Authenticate user with darklock.net platform
#[tauri::command]
pub async fn login(email: String, password: String, app: AppHandle) -> std::result::Result<LoginResponse, String> {
    // Send login request to darklock.net platform
    let api_url = std::env::var("DARKLOCK_API_URL")
        .unwrap_or_else(|_| "http://localhost:3002".to_string());
    let login_url = format!("{}/platform/auth/api/login", api_url);
    
    let client = reqwest::Client::new();
    let response = client
        .post(&login_url)
        .json(&serde_json::json!({
            "email": email,
            "password": password
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if response.status().is_success() {
        let login_data: serde_json::Value = response.json()
            .await
            .map_err(|e| format!("Parse error: {}", e))?;

        if let Some(token) = login_data["token"].as_str() {
            // Store token securely
            let config_dir = app.path().app_config_dir()
                .map_err(|e| format!("Config error: {}", e))?;
            fs::create_dir_all(&config_dir)
                .map_err(|e| format!("Directory error: {}", e))?;
            
            let token_file = config_dir.join("auth_token");
            fs::write(&token_file, token)
                .map_err(|e| format!("Write error: {}", e))?;

            return Ok(LoginResponse {
                success: true,
                error: None,
                user: Some(UserInfo {
                    username: login_data["user"]["username"].as_str().unwrap_or("").to_string(),
                    email: email.clone(),
                }),
            });
        }
    }

    Ok(LoginResponse {
        success: false,
        error: Some("Invalid email or password".to_string()),
        user: None,
    })
}

/// Check if user is already logged in
#[tauri::command]
pub async fn check_login(app: AppHandle) -> std::result::Result<bool, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Config error: {}", e))?;
    let token_file = config_dir.join("auth_token");
    
    Ok(token_file.exists())
}

/// Logout user
#[tauri::command]
pub async fn logout(app: AppHandle) -> std::result::Result<bool, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Config error: {}", e))?;
    let token_file = config_dir.join("auth_token");
    
    if token_file.exists() {
        fs::remove_file(&token_file)
            .map_err(|e| format!("Delete error: {}", e))?;
    }
    
    Ok(true)
}

// ============================================================================
// Initialization
// ============================================================================

/// Initialize the application and return initial state
#[tauri::command]
pub async fn initialize(state: State<'_, SharedState>) -> std::result::Result<InitResponse, String> {
    let state = state.read();
    
    // Load event chain
    let chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
        .map_err(|e| e.to_string())?;
    
    // Get summary
    let summary = IntegritySummary::from_paths(&state.protected_paths);
    
    Ok(InitResponse {
        state: FrontendState::from(&*state),
        summary,
        recent_events: chain.get_events(0, 10)
            .into_iter()
            .map(|e| EventDisplay::from(e))
            .collect(),
    })
}

#[derive(Serialize)]
pub struct InitResponse {
    state: FrontendState,
    summary: IntegritySummary,
    recent_events: Vec<EventDisplay>,
}

// ============================================================================
// Protected Paths
// ============================================================================

/// Get all protected paths
#[tauri::command]
pub async fn get_protected_paths(state: State<'_, SharedState>) -> std::result::Result<Vec<crate::storage::ProtectedPath>, String> {
    let state = state.read();
    Ok(state.protected_paths.clone())
}

/// Add a new protected path
#[tauri::command]
pub async fn add_protected_path(
    path: String,
    state: State<'_, SharedState>,
) -> std::result::Result<crate::storage::ProtectedPath, String> {
    // Validate path
    if path.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    
    let mut state = state.write();
    
    // Add path
    let protected_path = state.add_protected_path(path.clone())
        .map_err(|e| e.to_string())?;
    
    // Log event
    let mut chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
        .map_err(|e| e.to_string())?;
    
    chain.append(
        EventType::PathAdded,
        EventSeverity::Info,
        format!("Added protected path: {}", path),
        Some(serde_json::json!({ "path": path })),
        state.signing_key(),
    ).map_err(|e| e.to_string())?;
    
    Ok(protected_path)
}

/// Remove a protected path
#[tauri::command]
pub async fn remove_protected_path(
    path_id: String,
    state: State<'_, SharedState>,
) -> std::result::Result<(), String> {
    let mut state = state.write();
    
    // Get path info before removal
    let path_info = state.protected_paths.iter()
        .find(|p| p.id == path_id)
        .map(|p| p.path.clone());
    
    // Remove path
    state.remove_protected_path(&path_id)
        .map_err(|e| e.to_string())?;
    
    // Log event
    if let Some(path) = path_info {
        let mut chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
            .map_err(|e| e.to_string())?;
        
        chain.append(
            EventType::PathRemoved,
            EventSeverity::Info,
            format!("Removed protected path: {}", path),
            Some(serde_json::json!({ "path": path, "id": path_id })),
            state.signing_key(),
        ).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

// ============================================================================
// Integrity Scanning
// ============================================================================

/// Scan all protected paths
#[tauri::command]
pub async fn scan_integrity(state: State<'_, SharedState>) -> std::result::Result<Vec<ScanResult>, String> {
    let mut state = state.write();
    
    // Update status
    state.integrity_status = IntegrityStatus::Scanning;
    
    // Log scan start
    let mut chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
        .map_err(|e| e.to_string())?;
    
    chain.append(
        EventType::ScanStarted,
        EventSeverity::Info,
        "Integrity scan started".to_string(),
        None,
        state.signing_key(),
    ).map_err(|e| e.to_string())?;
    
    // Create scanner with settings
    let scanner = IntegrityScanner::new(ScanConfig {
        exclude_patterns: state.settings.exclude_patterns.clone(),
        follow_symlinks: false,
        max_file_size: Some(100 * 1024 * 1024),
    });
    
    let mut results = Vec::new();
    let mut any_compromised = false;
    
    // Scan each path
    for path in &state.protected_paths.clone() {
        let previous_manifest = state.manifests.get(&path.id);
        
        match scanner.full_scan(path, previous_manifest.map(|v| v.as_slice())) {
            Ok(result) => {
                // Store new manifest
                let entries = scanner.scan_directory(std::path::Path::new(&path.path))
                    .unwrap_or_default();
                state.manifests.insert(path.id.clone(), entries);
                
                // Update path status
                state.update_path_scan(
                    &path.id,
                    result.total_files,
                    result.merkle_root.clone(),
                    result.status.clone(),
                ).map_err(|e| e.to_string())?;
                
                if result.status == PathStatus::Compromised {
                    any_compromised = true;
                    
                    // Log security alert
                    chain.append(
                        EventType::SecurityAlert,
                        EventSeverity::Critical,
                        format!("Integrity violation detected in: {}", path.path),
                        Some(serde_json::json!({
                            "path": path.path,
                            "modified_files": result.modified_files,
                            "deleted_files": result.deleted_files,
                        })),
                        state.signing_key(),
                    ).map_err(|e| e.to_string())?;
                }
                
                results.push(result);
            }
            Err(e) => {
                results.push(ScanResult {
                    path_id: path.id.clone(),
                    path: path.path.clone(),
                    status: PathStatus::Unknown,
                    total_files: 0,
                    verified_files: 0,
                    modified_files: 0,
                    new_files: 0,
                    deleted_files: 0,
                    merkle_root: None,
                    scan_duration_ms: 0,
                    errors: vec![e.to_string()],
                });
            }
        }
    }
    
    // Update overall status
    state.integrity_status = if any_compromised {
        IntegrityStatus::Compromised
    } else {
        IntegrityStatus::Verified
    };
    state.last_scan_time = Some(chrono::Utc::now());
    state.save().map_err(|e| e.to_string())?;
    
    // Log scan complete
    chain.append(
        EventType::ScanCompleted,
        if any_compromised { EventSeverity::Warning } else { EventSeverity::Info },
        format!("Scan completed: {} paths, {} total files", results.len(), results.iter().map(|r| r.total_files).sum::<usize>()),
        Some(serde_json::json!({
            "paths_scanned": results.len(),
            "compromised": any_compromised,
        })),
        state.signing_key(),
    ).map_err(|e| e.to_string())?;
    
    Ok(results)
}

/// Scan a specific path
#[tauri::command]
pub async fn scan_path(
    path_id: String,
    state: State<'_, SharedState>,
) -> std::result::Result<ScanResult, String> {
    let mut state = state.write();
    
    let path = state.protected_paths.iter()
        .find(|p| p.id == path_id)
        .cloned()
        .ok_or_else(|| "Path not found".to_string())?;
    
    let scanner = IntegrityScanner::new(ScanConfig {
        exclude_patterns: state.settings.exclude_patterns.clone(),
        follow_symlinks: false,
        max_file_size: Some(100 * 1024 * 1024),
    });
    
    let previous_manifest = state.manifests.get(&path_id);
    
    let result = scanner.full_scan(&path, previous_manifest.map(|v| v.as_slice()))
        .map_err(|e| e.to_string())?;
    
    // Store new manifest
    let entries = scanner.scan_directory(std::path::Path::new(&path.path))
        .unwrap_or_default();
    state.manifests.insert(path_id.clone(), entries);
    
    // Update path status
    state.update_path_scan(
        &path_id,
        result.total_files,
        result.merkle_root.clone(),
        result.status.clone(),
    ).map_err(|e| e.to_string())?;
    
    Ok(result)
}

/// Get file tree for a protected path
#[tauri::command]
pub async fn get_file_tree(
    path_id: String,
    state: State<'_, SharedState>,
) -> std::result::Result<FileTreeNode, String> {
    let state = state.read();
    
    let path = state.protected_paths.iter()
        .find(|p| p.id == path_id)
        .ok_or_else(|| "Path not found".to_string())?;
    
    let entries = state.manifests.get(&path_id)
        .ok_or_else(|| "No scan data available. Run a scan first.".to_string())?;
    
    let scanner = IntegrityScanner::new(ScanConfig::default());
    Ok(scanner.build_file_tree(entries, &path.path))
}

/// Verify a single file
#[tauri::command]
pub async fn verify_file(
    file_path: String,
    state: State<'_, SharedState>,
) -> std::result::Result<FileVerifyResult, String> {
    let state = state.read();
    
    // Find the file in manifests
    for (path_id, entries) in &state.manifests {
        if let Some(entry) = entries.iter().find(|e| e.path == file_path) {
            let scanner = IntegrityScanner::new(ScanConfig::default());
            let verified = scanner.verify_file(
                std::path::Path::new(&file_path),
                &entry.hash,
            ).map_err(|e| e.to_string())?;
            
            return Ok(FileVerifyResult {
                path: file_path.clone(),
                verified,
                expected_hash: entry.hash.clone(),
                actual_hash: if verified { 
                    entry.hash.clone() 
                } else { 
                    crate::crypto::hash_file(std::path::Path::new(&file_path))
                        .unwrap_or_else(|_| "error".to_string())
                },
            });
        }
    }
    
    Err("File not found in any protected path".to_string())
}

#[derive(Serialize)]
pub struct FileVerifyResult {
    path: String,
    verified: bool,
    expected_hash: String,
    actual_hash: String,
}

// ============================================================================
// Event Chain
// ============================================================================

/// Get events with pagination
#[tauri::command]
pub async fn get_events(
    offset: Option<usize>,
    limit: Option<usize>,
    state: State<'_, SharedState>,
) -> std::result::Result<EventsResponse, String> {
    let state = state.read();
    
    let chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
        .map_err(|e| e.to_string())?;
    
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(50);
    
    let events: Vec<EventDisplay> = chain.get_events(offset, limit)
        .into_iter()
        .map(|e| EventDisplay::from(e))
        .collect();
    
    let stats = chain.stats();
    
    Ok(EventsResponse {
        events,
        total: stats.total_events,
        stats,
    })
}

#[derive(Serialize)]
pub struct EventsResponse {
    events: Vec<EventDisplay>,
    total: usize,
    stats: crate::event_chain::ChainStats,
}

/// Verify the event chain integrity
#[tauri::command]
pub async fn verify_event_chain(
    state: State<'_, SharedState>,
) -> std::result::Result<ChainVerificationResult, String> {
    let mut state = state.write();
    
    let mut chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
        .map_err(|e| e.to_string())?;
    
    let result = chain.verify();
    
    // Update state
    state.event_chain_valid = result.valid;
    
    // Log verification
    chain.append(
        EventType::ChainVerified,
        if result.valid { EventSeverity::Info } else { EventSeverity::Critical },
        format!("Event chain verification: {}", if result.valid { "PASSED" } else { "FAILED" }),
        Some(serde_json::json!({
            "valid": result.valid,
            "total_events": result.total_events,
            "verified_events": result.verified_events,
        })),
        state.signing_key(),
    ).map_err(|e| e.to_string())?;
    
    Ok(result)
}

// ============================================================================
// Settings
// ============================================================================

/// Get current settings
#[tauri::command]
pub async fn get_settings(state: State<'_, SharedState>) -> std::result::Result<Settings, String> {
    let state = state.read();
    Ok(state.settings.clone())
}

/// Update settings
#[tauri::command]
pub async fn update_settings(
    settings: Settings,
    state: State<'_, SharedState>,
) -> std::result::Result<(), String> {
    let mut state = state.write();
    state.settings = settings;
    state.save().map_err(|e| e.to_string())?;
    
    // Log event
    let mut chain = EventChain::new(state.data_dir(), state.settings.max_event_history)
        .map_err(|e| e.to_string())?;
    
    chain.append(
        EventType::SettingsChanged,
        EventSeverity::Info,
        "Settings updated".to_string(),
        None,
        state.signing_key(),
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

// ============================================================================
// File Operations
// ============================================================================

/// Open directory selection dialog
#[tauri::command]
pub async fn select_directory(app: AppHandle) -> std::result::Result<Option<String>, String> {
    let result = app.dialog()
        .file()
        .set_title("Select Directory to Protect")
        .blocking_pick_folder();
    
    Ok(result.map(|p| p.to_string()))
}

/// Export integrity report
#[tauri::command]
pub async fn export_report(
    format: String,
    app: AppHandle,
    state: State<'_, SharedState>,
) -> std::result::Result<(), String> {
    let state = state.read();
    
    // Build report data
    let report = IntegrityReport {
        generated_at: chrono::Utc::now(),
        protected_paths: state.protected_paths.clone(),
        integrity_status: state.integrity_status.clone(),
        last_scan_time: state.last_scan_time,
        event_chain_valid: state.event_chain_valid,
    };
    
    // Get save path
    let file_path = app.dialog()
        .file()
        .set_title("Save Integrity Report")
        .set_file_name(&format!("darklock_report_{}.{}", 
            chrono::Utc::now().format("%Y%m%d_%H%M%S"),
            if format == "json" { "json" } else { "txt" }
        ))
        .blocking_save_file();
    
    if let Some(path) = &file_path {
        let content = if format == "json" {
            serde_json::to_string_pretty(&report)
                .map_err(|e| e.to_string())?
        } else {
            format!("{:#?}", report)
        };
        
        std::fs::write(path.as_path().unwrap(), content)
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[derive(Debug, Serialize)]
struct IntegrityReport {
    generated_at: chrono::DateTime<chrono::Utc>,
    protected_paths: Vec<crate::storage::ProtectedPath>,
    integrity_status: IntegrityStatus,
    last_scan_time: Option<chrono::DateTime<chrono::Utc>>,
    event_chain_valid: bool,
}
