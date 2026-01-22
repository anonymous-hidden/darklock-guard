//! Protection Manager - Main coordinator for the protection system
//!
//! This is the primary interface used by Tauri commands.
//! It orchestrates all subsystems: database, scanner, event chain, watcher.

use crate::protection::{ProtectionError, Result};
use crate::protection::database::Database;
use crate::protection::models::*;
use crate::protection::scanner::{Scanner, ScanMode, ScanProgress};
use crate::protection::event_chain::EventChain;
use crate::protection::watcher::{FileWatcher, WatcherEvent, create_watcher_channel};
use crate::protection::keystore::KeyStore;
use crate::protection::baseline::BaselineManager;
use chrono::Utc;
use directories::ProjectDirs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

/// Protection manager configuration
#[derive(Debug, Clone)]
pub struct ProtectionConfig {
    /// Data directory for database and keys
    pub data_dir: PathBuf,
    /// Enable file watching
    pub watch_enabled: bool,
    /// Verify event chain on startup
    pub verify_chain_on_startup: bool,
}

impl Default for ProtectionConfig {
    fn default() -> Self {
        let data_dir = ProjectDirs::from("net", "darklock", "DarklockGuard")
            .map(|p| p.data_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from("./data"));
        
        Self {
            data_dir,
            watch_enabled: true,
            verify_chain_on_startup: true,
        }
    }
}

/// Main protection manager
pub struct ProtectionManager {
    db: Arc<Database>,
    keystore: Arc<KeyStore>,
    scanner: Scanner,
    event_chain: EventChain,
    watcher: Option<FileWatcher>,
    watcher_rx: Option<mpsc::Receiver<WatcherEvent>>,
    config: ProtectionConfig,
    chain_valid: Arc<RwLock<bool>>,
}

impl ProtectionManager {
    /// Create a new protection manager
    pub fn new(config: ProtectionConfig) -> Result<Self> {
        // Ensure data directory exists
        std::fs::create_dir_all(&config.data_dir)?;
        
        // Initialize database
        let db_path = config.data_dir.join("protection.db");
        let db = Arc::new(Database::open(&db_path)?);
        
        // Initialize key store
        let keystore = Arc::new(KeyStore::new(&config.data_dir)?);
        
        // Initialize scanner
        let scanner = Scanner::new(db.clone());
        
        // Initialize event chain
        let event_chain = EventChain::new(db.clone(), keystore.clone())?;
        
        // Initialize watcher if enabled
        let (watcher, watcher_rx) = if config.watch_enabled {
            let (tx, rx) = create_watcher_channel();
            (Some(FileWatcher::new(tx)), Some(rx))
        } else {
            (None, None)
        };
        
        let mut manager = Self {
            db,
            keystore,
            scanner,
            event_chain,
            watcher,
            watcher_rx,
            config,
            chain_valid: Arc::new(RwLock::new(true)),
        };
        
        // Verify chain on startup if enabled
        if manager.config.verify_chain_on_startup {
            let result = manager.event_chain.verify()?;
            *manager.chain_valid.blocking_write() = result.valid;
            
            if !result.valid {
                eprintln!("[Protection] Event chain integrity failure: {:?}", result.error_message);
            }
        }
        
        // Log system start
        manager.event_chain.log_system_start()?;
        
        Ok(manager)
    }
    
    /// Initialize with default config
    pub fn init() -> Result<Self> {
        Self::new(ProtectionConfig::default())
    }
    
    // ========================================================================
    // Path Management
    // ========================================================================
    
    /// Add a new protected path
    pub async fn add_protected_path(
        &self,
        path: &str,
        display_name: Option<&str>,
        settings: Option<PathSettings>,
    ) -> Result<ProtectedPath> {
        // Normalize path
        let path = Path::new(path).canonicalize()
            .map_err(|_| ProtectionError::PathNotFound(path.to_string()))?;
        let path_str = path.to_string_lossy().to_string();
        
        // Check if already protected
        if self.db.get_protected_path_by_path(&path_str)?.is_some() {
            return Err(ProtectionError::PathAlreadyProtected(path_str));
        }
        
        // Create path entry
        let protected_path = ProtectedPath {
            id: Uuid::new_v4().to_string(),
            path: path_str.clone(),
            display_name: display_name
                .map(String::from)
                .unwrap_or_else(|| {
                    path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| path_str.clone())
                }),
            created_at: Utc::now(),
            status: PathStatus::NotScanned,
            last_scan_at: None,
            baseline_version: 0,
            settings: settings.unwrap_or_default(),
        };
        
        self.db.insert_protected_path(&protected_path)?;
        
        // Log event
        self.event_chain.log_path_added(&protected_path.id, &path_str)?;
        
        // Start watching if enabled
        if let Some(ref watcher) = self.watcher {
            if protected_path.settings.watch_enabled {
                watcher.watch(protected_path.id.clone(), &path).await?;
            }
        }
        
        Ok(protected_path)
    }
    
    /// Remove a protected path
    pub async fn remove_protected_path(&self, path_id: &str) -> Result<()> {
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        // Stop watching
        if let Some(ref watcher) = self.watcher {
            watcher.unwatch(path_id).await?;
        }
        
        // Delete from database (cascades to baselines, scans, diffs)
        self.db.delete_protected_path(path_id)?;
        
        // Log event
        self.event_chain.log_path_removed(path_id, &path.path)?;
        
        Ok(())
    }
    
    /// Get all protected paths
    pub fn get_all_paths(&self) -> Result<Vec<ProtectedPath>> {
        self.db.get_all_protected_paths()
    }
    
    /// Get path summary for UI
    pub fn get_path_summary(&self, path_id: &str) -> Result<PathSummary> {
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        let baseline_mgr = BaselineManager::new(self.db.clone());
        let (file_count, total_size) = baseline_mgr.get_baseline_stats(path_id)?;
        
        // Get pending changes count
        let changes_pending = if let Some(scan) = self.db.get_latest_scan_result(path_id)? {
            if scan.result_status == ScanResultStatus::ChangesDetected {
                let diffs = self.db.get_file_diffs(&scan.scan_id)?;
                diffs.len() as u64
            } else {
                0
            }
        } else {
            0
        };
        
        Ok(PathSummary {
            id: path.id,
            path: path.path,
            display_name: path.display_name,
            status: path.status,
            last_scan_at: path.last_scan_at,
            baseline_version: path.baseline_version,
            file_count,
            total_size,
            changes_pending,
        })
    }
    
    // ========================================================================
    // Scanning
    // ========================================================================
    
    /// Scan a path
    pub async fn scan_path(
        &self,
        path_id: &str,
        mode: ScanMode,
        progress_tx: Option<mpsc::Sender<ScanProgressUpdate>>,
    ) -> Result<ScanResult> {
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        // Log scan started
        let scan_id = Uuid::new_v4().to_string();
        let mode_str = match mode {
            ScanMode::Quick => "quick",
            ScanMode::Full => "full",
            ScanMode::Paranoid => "paranoid",
        };
        self.event_chain.log_scan_started(path_id, &scan_id, mode_str)?;
        
        // Create progress adapter
        let (internal_tx, mut internal_rx) = mpsc::channel::<ScanProgress>(100);
        let path_id_clone = path_id.to_string();
        let scan_id_clone = scan_id.clone();
        
        if let Some(progress_tx) = progress_tx {
            tokio::spawn(async move {
                while let Some(progress) = internal_rx.recv().await {
                    let update = ScanProgressUpdate {
                        path_id: path_id_clone.clone(),
                        scan_id: scan_id_clone.clone(),
                        phase: progress.phase.as_str().to_string(),
                        files_processed: progress.files_processed,
                        files_total: progress.files_total,
                        bytes_processed: progress.bytes_processed,
                        current_file: progress.current_file,
                    };
                    let _ = progress_tx.send(update).await;
                }
            });
        }
        
        // Run scan
        let result = self.scanner.scan_path(path_id, mode, Some(internal_tx)).await?;
        
        // Log scan completed
        self.event_chain.log_scan_completed(path_id, &result.scan_id, &result.totals)?;
        
        // Log changes if detected
        let total_changes = result.totals.files_modified + result.totals.files_added + result.totals.files_removed;
        if total_changes > 0 {
            self.event_chain.log_changes_detected(path_id, &result.scan_id, total_changes)?;
        }
        
        Ok(result)
    }
    
    /// Scan all paths
    pub async fn scan_all(&self, mode: ScanMode) -> Result<Vec<ScanResult>> {
        let paths = self.get_all_paths()?;
        let mut results = Vec::new();
        
        for path in paths {
            if path.status == PathStatus::Paused {
                continue;
            }
            
            match self.scan_path(&path.id, mode, None).await {
                Ok(result) => results.push(result),
                Err(e) => {
                    eprintln!("[Protection] Error scanning {}: {}", path.path, e);
                    let _ = self.event_chain.log_error(Some(&path.id), &e.to_string());
                }
            }
        }
        
        Ok(results)
    }
    
    /// Accept changes and update baseline
    pub fn accept_changes(&self, path_id: &str, scan_id: &str) -> Result<i32> {
        let version = self.scanner.accept_changes(path_id, scan_id)?;
        
        // Get file count for logging
        let baseline_mgr = BaselineManager::new(self.db.clone());
        let (file_count, _) = baseline_mgr.get_baseline_stats(path_id)?;
        
        self.event_chain.log_baseline_updated(path_id, version, file_count)?;
        
        Ok(version)
    }
    
    /// Get diffs for a scan
    pub fn get_diffs(&self, scan_id: &str) -> Result<Vec<FileDiff>> {
        self.scanner.get_scan_diffs(scan_id)
    }
    
    // ========================================================================
    // Event Chain
    // ========================================================================
    
    /// Verify the event chain
    pub fn verify_event_chain(&self) -> Result<ChainVerificationResult> {
        let result = self.event_chain.verify()?;
        
        // Update chain valid status
        *self.chain_valid.blocking_write() = result.valid;
        
        // Log verification
        self.event_chain.log_chain_verified(&result)?;
        
        Ok(result)
    }
    
    /// Check if chain is valid
    pub async fn is_chain_valid(&self) -> bool {
        *self.chain_valid.read().await
    }
    
    /// Get recent events
    pub fn get_recent_events(&self, limit: u32) -> Result<Vec<ChainEvent>> {
        self.event_chain.get_recent_events(limit)
    }
    
    /// Get event count
    pub fn get_event_count(&self) -> Result<u64> {
        self.event_chain.get_event_count()
    }
    
    /// Clear event chain (danger zone)
    pub fn clear_event_chain(&self) -> Result<()> {
        self.event_chain.clear()
    }
    
    // ========================================================================
    // Baseline Management
    // ========================================================================
    
    /// Reset baseline for a path
    pub fn reset_baseline(&self, path_id: &str) -> Result<()> {
        let baseline_mgr = BaselineManager::new(self.db.clone());
        baseline_mgr.reset_baseline(path_id)?;
        
        // Log event
        self.event_chain.log_baseline_created(path_id, 0, 0)?;
        
        Ok(())
    }
    
    // ========================================================================
    // Watcher
    // ========================================================================
    
    /// Process watcher events (call periodically or in background task)
    pub async fn process_watcher_events(&mut self) -> Result<Vec<WatcherEvent>> {
        let mut events = Vec::new();
        
        if let Some(ref mut rx) = self.watcher_rx {
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
        }
        
        Ok(events)
    }
    
    /// Start watching all enabled paths
    pub async fn start_all_watchers(&self) -> Result<()> {
        if let Some(ref watcher) = self.watcher {
            let paths = self.get_all_paths()?;
            
            for path in paths {
                if path.settings.watch_enabled && path.status != PathStatus::Paused {
                    let path_buf = PathBuf::from(&path.path);
                    if path_buf.exists() {
                        watcher.watch(path.id, &path_buf).await?;
                    }
                }
            }
        }
        
        Ok(())
    }
    
    /// Stop all watchers
    pub async fn stop_all_watchers(&self) {
        if let Some(ref watcher) = self.watcher {
            watcher.stop_all().await;
        }
    }
    
    // ========================================================================
    // Utility
    // ========================================================================
    
    /// Get data directory
    pub fn data_dir(&self) -> &Path {
        &self.config.data_dir
    }
    
    /// Export public key for external verification
    pub fn export_public_key(&self) -> Result<String> {
        self.keystore.export_public_key()
    }
    
    /// Get overall status
    pub async fn get_overall_status(&self) -> PathStatus {
        let paths = match self.get_all_paths() {
            Ok(p) => p,
            Err(_) => return PathStatus::Error,
        };
        
        if paths.is_empty() {
            return PathStatus::NotScanned;
        }
        
        // Check chain validity
        if !self.is_chain_valid().await {
            return PathStatus::Error;
        }
        
        // Aggregate path statuses
        let mut has_scanning = false;
        let mut has_changed = false;
        let mut has_error = false;
        let mut has_not_scanned = false;
        
        for path in paths {
            match path.status {
                PathStatus::Scanning => has_scanning = true,
                PathStatus::Changed => has_changed = true,
                PathStatus::Error => has_error = true,
                PathStatus::NotScanned => has_not_scanned = true,
                _ => {}
            }
        }
        
        if has_scanning {
            PathStatus::Scanning
        } else if has_error {
            PathStatus::Error
        } else if has_changed {
            PathStatus::Changed
        } else if has_not_scanned {
            PathStatus::NotScanned
        } else {
            PathStatus::Verified
        }
    }
}
