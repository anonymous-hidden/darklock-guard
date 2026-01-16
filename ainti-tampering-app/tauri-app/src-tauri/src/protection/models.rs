//! Data models for the protection system
//!
//! All structs are serializable and map to SQLite tables.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Enums
// ============================================================================

/// Status of a protected path
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PathStatus {
    /// Never scanned
    NotScanned,
    /// Currently scanning
    Scanning,
    /// All files match baseline
    Verified,
    /// Changes detected since last baseline
    Changed,
    /// Scan encountered errors
    Error,
    /// Monitoring paused by user
    Paused,
}

impl PathStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotScanned => "not_scanned",
            Self::Scanning => "scanning",
            Self::Verified => "verified",
            Self::Changed => "changed",
            Self::Error => "error",
            Self::Paused => "paused",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s {
            "not_scanned" => Self::NotScanned,
            "scanning" => Self::Scanning,
            "verified" => Self::Verified,
            "changed" => Self::Changed,
            "error" => Self::Error,
            "paused" => Self::Paused,
            _ => Self::NotScanned,
        }
    }
}

/// Type of file change detected
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    /// File content was modified
    Modified,
    /// New file added
    Added,
    /// File was removed
    Removed,
    /// Only metadata changed (size/mtime but same hash)
    MetadataOnly,
}

impl ChangeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Modified => "modified",
            Self::Added => "added",
            Self::Removed => "removed",
            Self::MetadataOnly => "metadata_only",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s {
            "modified" => Self::Modified,
            "added" => Self::Added,
            "removed" => Self::Removed,
            "metadata_only" => Self::MetadataOnly,
            _ => Self::Modified,
        }
    }
}

/// Scan result status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanResultStatus {
    /// All files verified
    Clean,
    /// Changes detected
    ChangesDetected,
    /// Scan failed
    Failed,
    /// Scan was cancelled
    Cancelled,
}

impl ScanResultStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Clean => "clean",
            Self::ChangesDetected => "changes_detected",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s {
            "clean" => Self::Clean,
            "changes_detected" => Self::ChangesDetected,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Failed,
        }
    }
}

/// Event types for the tamper-evident log
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// System started
    SystemStart,
    /// Path added to protection
    PathAdded,
    /// Path removed from protection
    PathRemoved,
    /// Scan started
    ScanStarted,
    /// Scan completed
    ScanCompleted,
    /// Changes detected
    ChangesDetected,
    /// Baseline created
    BaselineCreated,
    /// Baseline updated (user accepted changes)
    BaselineUpdated,
    /// Settings changed
    SettingsChanged,
    /// Event chain verified
    ChainVerified,
    /// Integrity violation detected
    IntegrityViolation,
    /// File watcher event
    WatcherEvent,
    /// Error occurred
    Error,
}

impl EventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SystemStart => "system_start",
            Self::PathAdded => "path_added",
            Self::PathRemoved => "path_removed",
            Self::ScanStarted => "scan_started",
            Self::ScanCompleted => "scan_completed",
            Self::ChangesDetected => "changes_detected",
            Self::BaselineCreated => "baseline_created",
            Self::BaselineUpdated => "baseline_updated",
            Self::SettingsChanged => "settings_changed",
            Self::ChainVerified => "chain_verified",
            Self::IntegrityViolation => "integrity_violation",
            Self::WatcherEvent => "watcher_event",
            Self::Error => "error",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s {
            "system_start" => Self::SystemStart,
            "path_added" => Self::PathAdded,
            "path_removed" => Self::PathRemoved,
            "scan_started" => Self::ScanStarted,
            "scan_completed" => Self::ScanCompleted,
            "changes_detected" => Self::ChangesDetected,
            "baseline_created" => Self::BaselineCreated,
            "baseline_updated" => Self::BaselineUpdated,
            "settings_changed" => Self::SettingsChanged,
            "chain_verified" => Self::ChainVerified,
            "integrity_violation" => Self::IntegrityViolation,
            "watcher_event" => Self::WatcherEvent,
            "error" => Self::Error,
            _ => Self::Error,
        }
    }
}

/// Hash algorithm selection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum HashAlgorithm {
    #[default]
    Blake3,
    Sha256,
}

impl HashAlgorithm {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Blake3 => "blake3",
            Self::Sha256 => "sha256",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "blake3" => Self::Blake3,
            "sha256" | "sha-256" => Self::Sha256,
            _ => Self::Blake3,
        }
    }
}

// ============================================================================
// Database Models
// ============================================================================

/// A protected path entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedPath {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
    pub status: PathStatus,
    pub last_scan_at: Option<DateTime<Utc>>,
    pub baseline_version: i32,
    pub settings: PathSettings,
}

/// Per-path settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PathSettings {
    /// Hash algorithm to use
    #[serde(default)]
    pub hash_algorithm: HashAlgorithm,
    
    /// Enable paranoid mode (always hash, ignore mtime)
    #[serde(default)]
    pub paranoid_mode: bool,
    
    /// Enable file watcher for this path
    #[serde(default = "default_true")]
    pub watch_enabled: bool,
    
    /// Patterns to exclude (glob patterns)
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    
    /// Large file threshold in bytes (default 64MB)
    #[serde(default = "default_large_file_threshold")]
    pub large_file_threshold: u64,
    
    /// Chunk size for large files (default 4MB)
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
    
    /// Response action on changes
    #[serde(default)]
    pub response_action: ResponseAction,
}

fn default_true() -> bool { true }
fn default_large_file_threshold() -> u64 { 64 * 1024 * 1024 } // 64MB
fn default_chunk_size() -> u64 { 4 * 1024 * 1024 } // 4MB

/// Response action when changes detected
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResponseAction {
    /// Just alert (default, safe)
    #[default]
    AlertOnly,
    /// Copy modified files to quarantine
    QuarantineCopy,
}

/// Baseline file entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineFile {
    pub path_id: String,
    pub rel_path: String,
    pub size: u64,
    pub mtime: i64,
    pub mode: u32,
    pub hash_algo: String,
    pub hash_hex: String,
    pub chunk_size: Option<u64>,
    pub chunk_hashes: Option<Vec<String>>,
    pub baseline_version: i32,
}

/// Scan result record
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub scan_id: String,
    pub path_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub totals: ScanTotals,
    pub result_status: ScanResultStatus,
}

/// Scan statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanTotals {
    pub files_scanned: u64,
    pub directories_scanned: u64,
    pub bytes_scanned: u64,
    pub files_verified: u64,
    pub files_modified: u64,
    pub files_added: u64,
    pub files_removed: u64,
    pub files_error: u64,
    pub duration_ms: u64,
}

/// Individual file difference
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub scan_id: String,
    pub rel_path: String,
    pub change_type: ChangeType,
    pub old_hash: Option<String>,
    pub new_hash: Option<String>,
    pub old_size: Option<u64>,
    pub new_size: Option<u64>,
    pub details: HashMap<String, serde_json::Value>,
}

/// Event chain entry (tamper-evident log)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainEvent {
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub event_type: EventType,
    pub path_id: Option<String>,
    pub payload: serde_json::Value,
    pub prev_hash_hex: String,
    pub event_hash_hex: String,
    pub signature_hex: String,
}

// ============================================================================
// API Response Models (for frontend)
// ============================================================================

/// Summary of a protected path for UI display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSummary {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub status: PathStatus,
    pub last_scan_at: Option<DateTime<Utc>>,
    pub baseline_version: i32,
    pub file_count: u64,
    pub total_size: u64,
    pub changes_pending: u64,
}

/// Scan progress update for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressUpdate {
    pub path_id: String,
    pub scan_id: String,
    pub phase: String,
    pub files_processed: u64,
    pub files_total: u64,
    pub bytes_processed: u64,
    pub current_file: Option<String>,
}

/// Event chain verification result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerificationResult {
    pub valid: bool,
    pub events_verified: u64,
    pub first_invalid_event: Option<String>,
    pub error_message: Option<String>,
}
