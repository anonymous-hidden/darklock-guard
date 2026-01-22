//! Storage module for Darklock Guard
//!
//! Handles:
//! - Application state management
//! - Protected paths persistence
//! - Settings storage
//! - File manifest caching

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use directories::ProjectDirs;
use crate::error::{DarklockError, Result};
use crate::crypto::{SigningKeyPair, hash_file, merkle_root};

/// Protected path entry
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedPath {
    pub id: String,
    pub path: String,
    pub added_at: DateTime<Utc>,
    pub last_scan: Option<DateTime<Utc>>,
    pub file_count: usize,
    pub status: PathStatus,
    pub merkle_root: Option<String>,
}

impl ProtectedPath {
    pub fn new(path: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            path,
            added_at: Utc::now(),
            last_scan: None,
            file_count: 0,
            status: PathStatus::Unknown,
            merkle_root: None,
        }
    }
}

/// Path integrity status
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PathStatus {
    Verified,
    Compromised,
    Unknown,
    Scanning,
}

/// File entry with integrity info
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub relative_path: String,
    pub hash: String,
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub status: FileStatus,
}

/// File integrity status
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Verified,
    Modified,
    New,
    Deleted,
    Unknown,
}

/// Application settings
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub auto_scan: bool,
    pub scan_interval_minutes: u32,
    pub notify_on_change: bool,
    pub notify_on_scan_complete: bool,
    pub exclude_patterns: Vec<String>,
    pub hash_algorithm: String,
    pub preserve_event_chain: bool,
    pub max_event_history: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_scan: false,
            scan_interval_minutes: 60,
            notify_on_change: true,
            notify_on_scan_complete: true,
            exclude_patterns: vec![
                "*.tmp".to_string(),
                "*.log".to_string(),
                "*.bak".to_string(),
                "node_modules".to_string(),
                ".git".to_string(),
                "__pycache__".to_string(),
                "*.pyc".to_string(),
            ],
            hash_algorithm: "sha256".to_string(),
            preserve_event_chain: true,
            max_event_history: 10000,
        }
    }
}

/// Overall integrity status
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum IntegrityStatus {
    Verified,
    Compromised,
    Unknown,
    Scanning,
}

/// Application state
pub struct AppState {
    /// Protected paths
    pub protected_paths: Vec<ProtectedPath>,
    
    /// File manifests by path ID
    pub manifests: HashMap<String, Vec<FileEntry>>,
    
    /// Application settings
    pub settings: Settings,
    
    /// Overall integrity status
    pub integrity_status: IntegrityStatus,
    
    /// Last scan time
    pub last_scan_time: Option<DateTime<Utc>>,
    
    /// Event chain validity
    pub event_chain_valid: bool,
    
    /// Signing key pair for manifests
    signing_key: Option<SigningKeyPair>,
    
    /// Data directory
    data_dir: PathBuf,
}

impl AppState {
    /// Create new application state
    pub fn new() -> Result<Self> {
        let data_dir = Self::get_data_dir()?;
        
        // Ensure data directory exists
        fs::create_dir_all(&data_dir)?;
        
        let mut state = Self {
            protected_paths: Vec::new(),
            manifests: HashMap::new(),
            settings: Settings::default(),
            integrity_status: IntegrityStatus::Unknown,
            last_scan_time: None,
            event_chain_valid: true,
            signing_key: None,
            data_dir,
        };
        
        // Load persisted state
        state.load()?;
        
        // Initialize or load signing key
        state.init_signing_key()?;
        
        Ok(state)
    }
    
    /// Get application data directory
    fn get_data_dir() -> Result<PathBuf> {
        ProjectDirs::from("net", "darklock", "DarklockGuard")
            .map(|dirs| dirs.data_dir().to_path_buf())
            .ok_or_else(|| DarklockError::Storage("Failed to determine data directory".to_string()))
    }
    
    /// Initialize or load signing key
    fn init_signing_key(&mut self) -> Result<()> {
        let key_path = self.data_dir.join("signing_key.bin");
        
        if key_path.exists() {
            // Load existing key
            let protected_key = fs::read(&key_path)?;
            
            #[cfg(windows)]
            {
                use crate::crypto::secure_storage;
                let key_bytes = secure_storage::unprotect(&protected_key)?;
                if key_bytes.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&key_bytes);
                    self.signing_key = Some(SigningKeyPair::from_secret_bytes(&arr)?);
                }
            }
            
            #[cfg(not(windows))]
            {
                use crate::crypto::secure_storage;
                let key_bytes = secure_storage::unprotect(&protected_key)?;
                if key_bytes.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&key_bytes);
                    self.signing_key = Some(SigningKeyPair::from_secret_bytes(&arr)?);
                }
            }
        } else {
            // Generate new key
            let keypair = SigningKeyPair::generate();
            let secret = keypair.secret_bytes();
            
            #[cfg(windows)]
            {
                use crate::crypto::secure_storage;
                let protected = secure_storage::protect(&secret)?;
                fs::write(&key_path, protected)?;
            }
            
            #[cfg(not(windows))]
            {
                use crate::crypto::secure_storage;
                let protected = secure_storage::protect(&secret)?;
                fs::write(&key_path, protected)?;
            }
            
            self.signing_key = Some(keypair);
        }
        
        Ok(())
    }
    
    /// Get signing key reference
    pub fn signing_key(&self) -> Option<&SigningKeyPair> {
        self.signing_key.as_ref()
    }
    
    /// Load state from disk
    fn load(&mut self) -> Result<()> {
        // Load protected paths
        let paths_file = self.data_dir.join("protected_paths.json");
        if paths_file.exists() {
            let data = fs::read_to_string(&paths_file)?;
            self.protected_paths = serde_json::from_str(&data)?;
        }
        
        // Load settings
        let settings_file = self.data_dir.join("settings.json");
        if settings_file.exists() {
            let data = fs::read_to_string(&settings_file)?;
            self.settings = serde_json::from_str(&data)?;
        }
        
        // Load manifests
        let manifests_dir = self.data_dir.join("manifests");
        if manifests_dir.exists() {
            for entry in fs::read_dir(&manifests_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Some(stem) = path.file_stem() {
                        let id = stem.to_string_lossy().to_string();
                        let data = fs::read_to_string(&path)?;
                        let entries: Vec<FileEntry> = serde_json::from_str(&data)?;
                        self.manifests.insert(id, entries);
                    }
                }
            }
        }
        
        Ok(())
    }
    
    /// Save state to disk
    pub fn save(&self) -> Result<()> {
        // Save protected paths
        let paths_file = self.data_dir.join("protected_paths.json");
        let data = serde_json::to_string_pretty(&self.protected_paths)?;
        fs::write(&paths_file, data)?;
        
        // Save settings
        let settings_file = self.data_dir.join("settings.json");
        let data = serde_json::to_string_pretty(&self.settings)?;
        fs::write(&settings_file, data)?;
        
        // Save manifests
        let manifests_dir = self.data_dir.join("manifests");
        fs::create_dir_all(&manifests_dir)?;
        for (id, entries) in &self.manifests {
            let manifest_file = manifests_dir.join(format!("{}.json", id));
            let data = serde_json::to_string_pretty(entries)?;
            fs::write(&manifest_file, data)?;
        }
        
        Ok(())
    }
    
    /// Add a protected path
    pub fn add_protected_path(&mut self, path: String) -> Result<ProtectedPath> {
        // Verify path exists
        if !Path::new(&path).exists() {
            return Err(DarklockError::PathNotFound(path));
        }
        
        // Check if already protected
        if self.protected_paths.iter().any(|p| p.path == path) {
            return Err(DarklockError::InvalidOperation(
                "Path already protected".to_string()
            ));
        }
        
        let protected_path = ProtectedPath::new(path);
        self.protected_paths.push(protected_path.clone());
        self.save()?;
        
        Ok(protected_path)
    }
    
    /// Remove a protected path
    pub fn remove_protected_path(&mut self, id: &str) -> Result<()> {
        let initial_len = self.protected_paths.len();
        self.protected_paths.retain(|p| p.id != id);
        
        if self.protected_paths.len() == initial_len {
            return Err(DarklockError::PathNotFound(id.to_string()));
        }
        
        // Remove associated manifest
        self.manifests.remove(id);
        
        self.save()?;
        Ok(())
    }
    
    /// Update protected path after scan
    pub fn update_path_scan(&mut self, id: &str, file_count: usize, merkle_root: Option<String>, status: PathStatus) -> Result<()> {
        if let Some(path) = self.protected_paths.iter_mut().find(|p| p.id == id) {
            path.last_scan = Some(Utc::now());
            path.file_count = file_count;
            path.merkle_root = merkle_root;
            path.status = status;
            self.save()?;
        }
        Ok(())
    }
    
    /// Get data directory path
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

/// Serializable state for frontend
#[derive(Clone, Debug, Serialize)]
pub struct FrontendState {
    pub protected_paths: Vec<ProtectedPath>,
    pub settings: Settings,
    pub integrity_status: IntegrityStatus,
    pub last_scan_time: Option<DateTime<Utc>>,
    pub event_chain_valid: bool,
}

impl From<&AppState> for FrontendState {
    fn from(state: &AppState) -> Self {
        Self {
            protected_paths: state.protected_paths.clone(),
            settings: state.settings.clone(),
            integrity_status: state.integrity_status.clone(),
            last_scan_time: state.last_scan_time,
            event_chain_valid: state.event_chain_valid,
        }
    }
}
