//! File scanning with quick/full/paranoid modes
//!
//! Features:
//! - Quick mode: metadata prefilter, only hash changed files
//! - Full mode: hash all files, compare to baseline
//! - Paranoid mode: always hash everything, ignore metadata
//! - Progress reporting for UI
//! - Exclude pattern support

use crate::protection::{ProtectionError, Result};
use crate::protection::database::Database;
use crate::protection::models::*;
use crate::protection::hasher::{Hasher, HasherConfig, HashResult, metadata_matches};
use crate::protection::baseline::{BaselineManager, compare_baseline};
use chrono::Utc;
use glob::Pattern;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;
use walkdir::WalkDir;

/// Scan mode determines how thorough the scan is
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanMode {
    /// Quick: use metadata prefilter, only hash files with changed size/mtime
    Quick,
    /// Full: hash all files, compare to baseline
    Full,
    /// Paranoid: hash everything, ignore all metadata caching
    Paranoid,
}

/// Progress update during scanning
#[derive(Debug, Clone)]
pub struct ScanProgress {
    pub phase: ScanPhase,
    pub files_processed: u64,
    pub files_total: u64,
    pub bytes_processed: u64,
    pub current_file: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanPhase {
    Discovering,
    Hashing,
    Comparing,
    Finalizing,
}

impl ScanPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Discovering => "discovering",
            Self::Hashing => "hashing",
            Self::Comparing => "comparing",
            Self::Finalizing => "finalizing",
        }
    }
}

/// Scanner for protected paths
pub struct Scanner {
    db: Arc<Database>,
    baseline_mgr: BaselineManager,
}

impl Scanner {
    /// Create a new scanner
    pub fn new(db: Arc<Database>) -> Self {
        let baseline_mgr = BaselineManager::new(db.clone());
        Self { db, baseline_mgr }
    }
    
    /// Scan a protected path
    pub async fn scan_path(
        &self,
        path_id: &str,
        mode: ScanMode,
        progress_tx: Option<mpsc::Sender<ScanProgress>>,
    ) -> Result<ScanResult> {
        // Get path info
        let protected_path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        // Check path exists
        let root_path = Path::new(&protected_path.path);
        if !root_path.exists() {
            return Err(ProtectionError::PathNotFound(protected_path.path.clone()));
        }
        
        // Update status to scanning
        self.db.update_path_status(path_id, PathStatus::Scanning, None)?;
        
        // Create scan record
        let scan_id = Uuid::new_v4().to_string();
        let started_at = Utc::now();
        let scan_result = ScanResult {
            scan_id: scan_id.clone(),
            path_id: path_id.to_string(),
            started_at,
            finished_at: None,
            totals: ScanTotals::default(),
            result_status: ScanResultStatus::Clean,
        };
        self.db.insert_scan_result(&scan_result)?;
        
        // Discover files
        if let Some(tx) = &progress_tx {
            let _ = tx.send(ScanProgress {
                phase: ScanPhase::Discovering,
                files_processed: 0,
                files_total: 0,
                bytes_processed: 0,
                current_file: None,
            }).await;
        }
        
        let (files, dir_count) = self.discover_files(root_path, &protected_path.settings)?;
        let file_count = files.len() as u64;
        
        // Get baseline if exists
        let baseline = if protected_path.baseline_version > 0 {
            Some(self.baseline_mgr.get_baseline(path_id)?)
        } else {
            None
        };
        
        // Determine which files need hashing based on mode
        let files_to_hash = match mode {
            ScanMode::Paranoid => files.clone(), // Hash everything
            ScanMode::Full => files.clone(), // Hash everything
            ScanMode::Quick => {
                if let Some(ref baseline) = baseline {
                    self.filter_changed_files(&files, baseline, root_path)
                } else {
                    files.clone() // No baseline, must hash all
                }
            }
        };
        
        // Configure hasher
        let hasher_config = HasherConfig {
            algorithm: protected_path.settings.hash_algorithm,
            large_file_threshold: protected_path.settings.large_file_threshold,
            chunk_size: protected_path.settings.chunk_size,
            ..Default::default()
        };
        let hasher = Hasher::with_config(hasher_config);
        
        // Hash files with progress reporting
        if let Some(tx) = &progress_tx {
            let _ = tx.send(ScanProgress {
                phase: ScanPhase::Hashing,
                files_processed: 0,
                files_total: files_to_hash.len() as u64,
                bytes_processed: 0,
                current_file: None,
            }).await;
        }
        
        let mut hash_results: Vec<(String, HashResult)> = Vec::new();
        let mut bytes_scanned: u64 = 0;
        let mut files_error: u64 = 0;
        
        for (idx, rel_path) in files_to_hash.iter().enumerate() {
            let full_path = root_path.join(rel_path);
            
            if let Some(tx) = &progress_tx {
                let _ = tx.send(ScanProgress {
                    phase: ScanPhase::Hashing,
                    files_processed: idx as u64,
                    files_total: files_to_hash.len() as u64,
                    bytes_processed: bytes_scanned,
                    current_file: Some(rel_path.clone()),
                }).await;
            }
            
            match hasher.hash_file(&full_path) {
                Ok(result) => {
                    bytes_scanned += result.size;
                    hash_results.push((rel_path.clone(), result));
                }
                Err(e) => {
                    eprintln!("[Scanner] Error hashing {}: {}", rel_path, e);
                    files_error += 1;
                }
            }
        }
        
        // For quick mode, copy unchanged files from baseline
        if mode == ScanMode::Quick {
            if let Some(ref baseline) = baseline {
                // Collect hashed paths into an owned set first to avoid borrow conflict
                let hashed_set: HashSet<String> = hash_results.iter()
                    .map(|(p, _)| p.clone())
                    .collect();
                
                for baseline_file in baseline {
                    if !hashed_set.contains(&baseline_file.rel_path) {
                        // Copy from baseline (metadata matched, assumed unchanged)
                        hash_results.push((
                            baseline_file.rel_path.clone(),
                            HashResult {
                                hash: baseline_file.hash_hex.clone(),
                                size: baseline_file.size,
                                mtime: baseline_file.mtime,
                                mode: baseline_file.mode,
                                chunk_size: baseline_file.chunk_size,
                                chunk_hashes: baseline_file.chunk_hashes.clone(),
                            },
                        ));
                    }
                }
            }
        }
        
        // Compare with baseline
        if let Some(tx) = &progress_tx {
            let _ = tx.send(ScanProgress {
                phase: ScanPhase::Comparing,
                files_processed: file_count,
                files_total: file_count,
                bytes_processed: bytes_scanned,
                current_file: None,
            }).await;
        }
        
        let current_baseline = BaselineManager::build_baseline_files(
            path_id,
            hash_results.clone(),
            protected_path.settings.hash_algorithm,
        );
        
        let (diffs, result_status, new_status) = if let Some(ref baseline) = baseline {
            let diffs = compare_baseline(baseline, &current_baseline);
            
            let modified = diffs.iter().filter(|d| d.change_type == ChangeType::Modified).count() as u64;
            let added = diffs.iter().filter(|d| d.change_type == ChangeType::Added).count() as u64;
            let removed = diffs.iter().filter(|d| d.change_type == ChangeType::Removed).count() as u64;
            
            let has_changes = modified > 0 || added > 0 || removed > 0;
            
            let result_status = if has_changes {
                ScanResultStatus::ChangesDetected
            } else {
                ScanResultStatus::Clean
            };
            
            let new_status = if has_changes {
                PathStatus::Changed
            } else {
                PathStatus::Verified
            };
            
            (diffs, result_status, new_status)
        } else {
            // No baseline - create initial baseline
            self.baseline_mgr.create_baseline(path_id, current_baseline)?;
            (Vec::new(), ScanResultStatus::Clean, PathStatus::Verified)
        };
        
        // Save diffs
        if !diffs.is_empty() {
            let diffs_with_scan_id: Vec<FileDiff> = diffs.into_iter()
                .map(|mut d| {
                    d.scan_id = scan_id.clone();
                    d
                })
                .collect();
            self.db.insert_file_diffs(&diffs_with_scan_id)?;
        }
        
        // Finalize
        if let Some(tx) = &progress_tx {
            let _ = tx.send(ScanProgress {
                phase: ScanPhase::Finalizing,
                files_processed: file_count,
                files_total: file_count,
                bytes_processed: bytes_scanned,
                current_file: None,
            }).await;
        }
        
        let finished_at = Utc::now();
        let duration_ms = (finished_at - started_at).num_milliseconds() as u64;
        
        // Count changes
        let diffs = self.db.get_file_diffs(&scan_id)?;
        let files_modified = diffs.iter().filter(|d| d.change_type == ChangeType::Modified).count() as u64;
        let files_added = diffs.iter().filter(|d| d.change_type == ChangeType::Added).count() as u64;
        let files_removed = diffs.iter().filter(|d| d.change_type == ChangeType::Removed).count() as u64;
        
        let totals = ScanTotals {
            files_scanned: file_count,
            directories_scanned: dir_count,
            bytes_scanned,
            files_verified: file_count - files_modified - files_added - files_error,
            files_modified,
            files_added,
            files_removed,
            files_error,
            duration_ms,
        };
        
        // Update scan result
        self.db.update_scan_result(&scan_id, finished_at, &totals, result_status)?;
        
        // Update path status
        self.db.update_path_status(path_id, new_status, Some(finished_at))?;
        
        Ok(ScanResult {
            scan_id,
            path_id: path_id.to_string(),
            started_at,
            finished_at: Some(finished_at),
            totals,
            result_status,
        })
    }
    
    /// Discover all files in a path (respecting exclude patterns)
    fn discover_files(&self, root: &Path, settings: &PathSettings) -> Result<(Vec<String>, u64)> {
        let exclude_patterns: Vec<Pattern> = settings.exclude_patterns.iter()
            .filter_map(|p| Pattern::new(p).ok())
            .collect();
        
        let mut files = Vec::new();
        let mut dir_count = 0u64;
        
        for entry in WalkDir::new(root).follow_links(false) {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            
            // Get relative path
            let rel_path = match entry.path().strip_prefix(root) {
                Ok(p) => p.to_string_lossy().to_string(),
                Err(_) => continue,
            };
            
            // Skip if matches exclude pattern
            if exclude_patterns.iter().any(|p| p.matches(&rel_path)) {
                continue;
            }
            
            if entry.file_type().is_file() {
                files.push(rel_path);
            } else if entry.file_type().is_dir() {
                dir_count += 1;
            }
        }
        
        Ok((files, dir_count))
    }
    
    /// Filter to only files that may have changed (based on metadata)
    fn filter_changed_files(
        &self,
        files: &[String],
        baseline: &[BaselineFile],
        root: &Path,
    ) -> Vec<String> {
        use std::collections::HashMap;
        
        let baseline_map: HashMap<&str, &BaselineFile> = baseline.iter()
            .map(|f| (f.rel_path.as_str(), f))
            .collect();
        
        let mut changed = Vec::new();
        
        for rel_path in files {
            let full_path = root.join(rel_path);
            
            match baseline_map.get(rel_path.as_str()) {
                Some(baseline_file) => {
                    // File exists in baseline - check if metadata matches
                    if !metadata_matches(&full_path, baseline_file.size, baseline_file.mtime) {
                        changed.push(rel_path.clone());
                    }
                }
                None => {
                    // New file - needs hashing
                    changed.push(rel_path.clone());
                }
            }
        }
        
        // Also check for removed files
        let current_set: HashSet<&str> = files.iter().map(|s| s.as_str()).collect();
        for baseline_file in baseline {
            if !current_set.contains(baseline_file.rel_path.as_str()) {
                changed.push(baseline_file.rel_path.clone());
            }
        }
        
        changed
    }
    
    /// Accept changes and update baseline
    pub fn accept_changes(&self, path_id: &str, scan_id: &str) -> Result<i32> {
        // Verify the scan exists and has changes
        let scan = self.db.get_latest_scan_result(path_id)?
            .ok_or_else(|| ProtectionError::InvalidOperation("No scan found".to_string()))?;
        
        if scan.scan_id != scan_id {
            return Err(ProtectionError::InvalidOperation(
                "Provided scan_id does not match latest scan".to_string()
            ));
        }
        
        // Get current file state
        let protected_path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        let root_path = Path::new(&protected_path.path);
        let (files, _) = self.discover_files(root_path, &protected_path.settings)?;
        
        // Hash all current files for new baseline
        let hasher = Hasher::with_config(HasherConfig {
            algorithm: protected_path.settings.hash_algorithm,
            large_file_threshold: protected_path.settings.large_file_threshold,
            chunk_size: protected_path.settings.chunk_size,
            ..Default::default()
        });
        
        let mut hash_results = Vec::new();
        for rel_path in files {
            let full_path = root_path.join(&rel_path);
            if let Ok(result) = hasher.hash_file(&full_path) {
                hash_results.push((rel_path, result));
            }
        }
        
        let baseline_files = BaselineManager::build_baseline_files(
            path_id,
            hash_results,
            protected_path.settings.hash_algorithm,
        );
        
        // Update baseline
        self.baseline_mgr.update_baseline(path_id, baseline_files)
    }
    
    /// Get diffs for a scan
    pub fn get_scan_diffs(&self, scan_id: &str) -> Result<Vec<FileDiff>> {
        self.db.get_file_diffs(scan_id)
    }
}
