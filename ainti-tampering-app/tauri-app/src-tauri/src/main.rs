//! Darklock Guard - Main Application Entry
//!
//! Security-first file integrity monitoring using Tauri 2.0
//! 
//! SECURITY MODEL:
//! - Frontend is UNTRUSTED
//! - All privileged operations occur in Rust
//! - Secrets never leave the backend
//! - Deny-by-default permissions

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod integrity;
mod storage;
mod event_chain;
mod crypto;
mod error;
mod protection;

use commands::{
    initialize, get_protected_paths, add_protected_path, remove_protected_path,
    scan_integrity, scan_path, get_file_tree, verify_file,
    get_events, verify_event_chain,
    get_settings, update_settings,
    select_directory, export_report,
    login, check_login, logout,
    SharedState,
};
use protection::commands::{
    protection_add_path, protection_remove_path, protection_get_paths,
    protection_get_path_summary, protection_scan_path, protection_scan_all,
    protection_accept_changes, protection_get_diffs, protection_verify_chain,
    protection_get_events, protection_get_status, protection_reset_baseline,
    protection_clear_events, protection_export_public_key, protection_is_chain_valid,
    init_protection_state,
};
use storage::AppState;
use event_chain::{EventChain, EventType, EventSeverity};
use std::sync::Arc;
use parking_lot::RwLock;

fn main() {
    // Initialize application state
    let app_state = AppState::new().expect("Failed to initialize app state");
    let data_dir = app_state.data_dir().to_path_buf();
    let max_events = app_state.settings.max_event_history;
    let signing_key = app_state.signing_key().cloned();
    
    let state: SharedState = Arc::new(RwLock::new(app_state));
    
    // Initialize protection state (new EDR-lite system)
    let protection_state = init_protection_state()
        .expect("Failed to initialize protection system");

    // Log application start
    if let Ok(mut chain) = EventChain::new(&data_dir, max_events) {
        let _ = chain.append(
            EventType::AppStart,
            EventSeverity::Info,
            "Darklock Guard started".to_string(),
            Some(serde_json::json!({ "version": "1.0.0" })),
            signing_key.as_ref(),
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .manage(protection_state)
        .invoke_handler(tauri::generate_handler![
            // Authentication
            login,
            check_login,
            logout,
            
            // Initialization
            initialize,
            
            // Protected paths (legacy)
            get_protected_paths,
            add_protected_path,
            remove_protected_path,
            
            // Integrity scanning (legacy)
            scan_integrity,
            scan_path,
            get_file_tree,
            verify_file,
            
            // Event chain (legacy)
            get_events,
            verify_event_chain,
            
            // Settings
            get_settings,
            update_settings,
            
            // File operations
            select_directory,
            export_report,
            
            // === New Protection System (EDR-lite) ===
            protection_add_path,
            protection_remove_path,
            protection_get_paths,
            protection_get_path_summary,
            protection_scan_path,
            protection_scan_all,
            protection_accept_changes,
            protection_get_diffs,
            protection_verify_chain,
            protection_get_events,
            protection_get_status,
            protection_reset_baseline,
            protection_clear_events,
            protection_export_public_key,
            protection_is_chain_valid,
        ])
        .run(tauri::generate_context!())
        .expect("Error running Darklock Guard");
}
