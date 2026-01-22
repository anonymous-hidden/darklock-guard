//! Baseline management for protected paths
//!
//! Handles:
//! - Baseline creation on first scan
//! - Version management (incremental updates)
//! - Rollback attack prevention
//! - Old version pruning

use crate::protection::{ProtectionError, Result};
use crate::protection::database::Database;
use crate::protection::models::*;
use std::sync::Arc;

/// Number of baseline versions to retain
const DEFAULT_KEEP_VERSIONS: i32 = 5;

/// Baseline manager for a protected path
pub struct BaselineManager {
    db: Arc<Database>,
    keep_versions: i32,
}

impl BaselineManager {
    /// Create a new baseline manager
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            keep_versions: DEFAULT_KEEP_VERSIONS,
        }
    }
    
    /// Set number of versions to keep
    pub fn with_keep_versions(mut self, count: i32) -> Self {
        self.keep_versions = count;
        self
    }
    
    /// Check if a path has any baseline
    pub fn has_baseline(&self, path_id: &str) -> Result<bool> {
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        Ok(path.baseline_version > 0)
    }
    
    /// Get current baseline version for a path
    pub fn get_current_version(&self, path_id: &str) -> Result<i32> {
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        Ok(path.baseline_version)
    }
    
    /// Get baseline files for current version
    pub fn get_baseline(&self, path_id: &str) -> Result<Vec<BaselineFile>> {
        let version = self.get_current_version(path_id)?;
        if version == 0 {
            return Err(ProtectionError::NoBaseline(path_id.to_string()));
        }
        
        self.db.get_baseline_files(path_id, version)
    }
    
    /// Get baseline files for a specific version
    pub fn get_baseline_version(&self, path_id: &str, version: i32) -> Result<Vec<BaselineFile>> {
        self.db.get_baseline_files(path_id, version)
    }
    
    /// Create initial baseline (version 1)
    pub fn create_baseline(&self, path_id: &str, files: Vec<BaselineFile>) -> Result<i32> {
        // Verify path exists and has no baseline
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        if path.baseline_version > 0 {
            return Err(ProtectionError::InvalidOperation(
                "Baseline already exists. Use update_baseline to create new version.".to_string()
            ));
        }
        
        // Increment version to 1
        let version = self.db.increment_baseline_version(path_id)?;
        
        // Convert files to have correct version
        let files_with_version: Vec<BaselineFile> = files.into_iter()
            .map(|mut f| {
                f.baseline_version = version;
                f
            })
            .collect();
        
        // Insert baseline files
        self.db.insert_baseline_files(&files_with_version)?;
        
        // Update path status
        self.db.update_path_status(path_id, PathStatus::Verified, Some(chrono::Utc::now()))?;
        
        Ok(version)
    }
    
    /// Update baseline (creates new version)
    /// Used when user accepts detected changes
    pub fn update_baseline(&self, path_id: &str, files: Vec<BaselineFile>) -> Result<i32> {
        // Verify path has existing baseline
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        if path.baseline_version == 0 {
            return Err(ProtectionError::NoBaseline(path_id.to_string()));
        }
        
        // Increment version
        let version = self.db.increment_baseline_version(path_id)?;
        
        // Convert files to have correct version
        let files_with_version: Vec<BaselineFile> = files.into_iter()
            .map(|mut f| {
                f.baseline_version = version;
                f
            })
            .collect();
        
        // Insert new baseline files
        self.db.insert_baseline_files(&files_with_version)?;
        
        // Prune old versions
        self.db.prune_old_baselines(path_id, self.keep_versions)?;
        
        // Update path status
        self.db.update_path_status(path_id, PathStatus::Verified, Some(chrono::Utc::now()))?;
        
        Ok(version)
    }
    
    /// Reset baseline (delete all versions, start fresh)
    /// Dangerous - requires explicit user confirmation
    pub fn reset_baseline(&self, path_id: &str) -> Result<()> {
        // Delete all baseline files for this path
        // This happens automatically via CASCADE when we reset version to 0
        
        // We can't actually reset version to 0 easily, so we'll just 
        // delete the path and recreate it
        let path = self.db.get_protected_path(path_id)?
            .ok_or_else(|| ProtectionError::PathNotFound(path_id.to_string()))?;
        
        // Delete and recreate
        self.db.delete_protected_path(path_id)?;
        
        let new_path = ProtectedPath {
            id: path.id,
            path: path.path,
            display_name: path.display_name,
            created_at: chrono::Utc::now(),
            status: PathStatus::NotScanned,
            last_scan_at: None,
            baseline_version: 0,
            settings: path.settings,
        };
        
        self.db.insert_protected_path(&new_path)?;
        
        Ok(())
    }
    
    /// Get baseline statistics
    pub fn get_baseline_stats(&self, path_id: &str) -> Result<(u64, u64)> {
        let version = self.get_current_version(path_id)?;
        if version == 0 {
            return Ok((0, 0));
        }
        
        let file_count = self.db.get_baseline_file_count(path_id, version)?;
        let total_size = self.db.get_baseline_total_size(path_id, version)?;
        
        Ok((file_count, total_size))
    }
    
    /// Verify baseline version is monotonically increasing
    /// Used to detect rollback attacks
    pub fn verify_version_monotonic(&self, path_id: &str, expected_min_version: i32) -> Result<bool> {
        let current_version = self.get_current_version(path_id)?;
        Ok(current_version >= expected_min_version)
    }
    
    /// Build baseline files from hash results
    pub fn build_baseline_files(
        path_id: &str,
        hash_results: Vec<(String, crate::protection::hasher::HashResult)>,
        algorithm: HashAlgorithm,
    ) -> Vec<BaselineFile> {
        hash_results.into_iter()
            .map(|(rel_path, result)| {
                BaselineFile {
                    path_id: path_id.to_string(),
                    rel_path,
                    size: result.size,
                    mtime: result.mtime,
                    mode: result.mode,
                    hash_algo: algorithm.as_str().to_string(),
                    hash_hex: result.hash,
                    chunk_size: result.chunk_size,
                    chunk_hashes: result.chunk_hashes,
                    baseline_version: 0, // Will be set when saving
                }
            })
            .collect()
    }
}

/// Compare baseline with current scan results to detect changes
pub fn compare_baseline(
    baseline: &[BaselineFile],
    current: &[BaselineFile],
) -> Vec<FileDiff> {
    use std::collections::HashMap;
    
    let baseline_map: HashMap<&str, &BaselineFile> = baseline.iter()
        .map(|f| (f.rel_path.as_str(), f))
        .collect();
    
    let current_map: HashMap<&str, &BaselineFile> = current.iter()
        .map(|f| (f.rel_path.as_str(), f))
        .collect();
    
    let mut diffs = Vec::new();
    
    // Check for modified and removed files
    for (rel_path, baseline_file) in &baseline_map {
        match current_map.get(rel_path) {
            Some(current_file) => {
                // File exists in both - check if modified
                if baseline_file.hash_hex != current_file.hash_hex {
                    diffs.push(FileDiff {
                        scan_id: String::new(), // Will be set later
                        rel_path: rel_path.to_string(),
                        change_type: ChangeType::Modified,
                        old_hash: Some(baseline_file.hash_hex.clone()),
                        new_hash: Some(current_file.hash_hex.clone()),
                        old_size: Some(baseline_file.size),
                        new_size: Some(current_file.size),
                        details: std::collections::HashMap::new(),
                    });
                } else if baseline_file.size != current_file.size 
                    || baseline_file.mtime != current_file.mtime {
                    // Same hash but different metadata
                    diffs.push(FileDiff {
                        scan_id: String::new(),
                        rel_path: rel_path.to_string(),
                        change_type: ChangeType::MetadataOnly,
                        old_hash: Some(baseline_file.hash_hex.clone()),
                        new_hash: Some(current_file.hash_hex.clone()),
                        old_size: Some(baseline_file.size),
                        new_size: Some(current_file.size),
                        details: std::collections::HashMap::new(),
                    });
                }
            }
            None => {
                // File was removed
                diffs.push(FileDiff {
                    scan_id: String::new(),
                    rel_path: rel_path.to_string(),
                    change_type: ChangeType::Removed,
                    old_hash: Some(baseline_file.hash_hex.clone()),
                    new_hash: None,
                    old_size: Some(baseline_file.size),
                    new_size: None,
                    details: std::collections::HashMap::new(),
                });
            }
        }
    }
    
    // Check for added files
    for (rel_path, current_file) in &current_map {
        if !baseline_map.contains_key(rel_path) {
            diffs.push(FileDiff {
                scan_id: String::new(),
                rel_path: rel_path.to_string(),
                change_type: ChangeType::Added,
                old_hash: None,
                new_hash: Some(current_file.hash_hex.clone()),
                old_size: None,
                new_size: Some(current_file.size),
                details: std::collections::HashMap::new(),
            });
        }
    }
    
    diffs
}
