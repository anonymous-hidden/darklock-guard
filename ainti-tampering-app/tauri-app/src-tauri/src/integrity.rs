//! Integrity module for Darklock Guard
//!
//! Handles:
//! - File system scanning
//! - Hash computation and verification
//! - Merkle tree generation
//! - Change detection

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use chrono::{DateTime, Utc};
use crate::crypto::{hash_file, merkle_root};
use crate::storage::{FileEntry, FileStatus, PathStatus, ProtectedPath};
use crate::error::{DarklockError, Result};

/// Scan configuration
#[derive(Clone, Debug)]
pub struct ScanConfig {
    pub exclude_patterns: Vec<String>,
    pub follow_symlinks: bool,
    pub max_file_size: Option<u64>,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            exclude_patterns: vec![
                "*.tmp".to_string(),
                "*.log".to_string(),
                "node_modules".to_string(),
                ".git".to_string(),
            ],
            follow_symlinks: false,
            max_file_size: Some(100 * 1024 * 1024), // 100MB
        }
    }
}

/// File tree node for UI display
#[derive(Clone, Debug, Serialize)]
pub struct FileTreeNode {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub hash: Option<String>,
    pub status: Option<FileStatus>,
    pub children: Vec<FileTreeNode>,
}

impl FileTreeNode {
    fn new_dir(path: String, name: String) -> Self {
        Self {
            path,
            name,
            is_dir: true,
            size: None,
            hash: None,
            status: None,
            children: Vec::new(),
        }
    }
    
    fn new_file(path: String, name: String, size: u64, hash: String, status: FileStatus) -> Self {
        Self {
            path,
            name,
            is_dir: false,
            size: Some(size),
            hash: Some(hash),
            status: Some(status),
            children: Vec::new(),
        }
    }
}

/// Scan result
#[derive(Clone, Debug, Serialize)]
pub struct ScanResult {
    pub path_id: String,
    pub path: String,
    pub status: PathStatus,
    pub total_files: usize,
    pub verified_files: usize,
    pub modified_files: usize,
    pub new_files: usize,
    pub deleted_files: usize,
    pub merkle_root: Option<String>,
    pub scan_duration_ms: u64,
    pub errors: Vec<String>,
}

/// File integrity scanner
pub struct IntegrityScanner {
    config: ScanConfig,
}

impl IntegrityScanner {
    pub fn new(config: ScanConfig) -> Self {
        Self { config }
    }
    
    /// Check if path should be excluded
    fn should_exclude(&self, path: &Path) -> bool {
        let path_str = path.to_string_lossy();
        
        for pattern in &self.config.exclude_patterns {
            // Simple glob matching
            if pattern.starts_with('*') {
                let suffix = &pattern[1..];
                if path_str.ends_with(suffix) {
                    return true;
                }
            } else if path_str.contains(pattern) {
                return true;
            }
        }
        
        false
    }
    
    /// Scan a directory and compute file hashes
    pub fn scan_directory(&self, dir_path: &Path) -> Result<Vec<FileEntry>> {
        if !dir_path.exists() {
            return Err(DarklockError::PathNotFound(dir_path.to_string_lossy().to_string()));
        }
        
        let mut entries = Vec::new();
        
        let walker = WalkDir::new(dir_path)
            .follow_links(self.config.follow_symlinks)
            .into_iter()
            .filter_entry(|e| !self.should_exclude(e.path()));
        
        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("Walk error: {}", e);
                    continue;
                }
            };
            
            // Skip directories
            if entry.file_type().is_dir() {
                continue;
            }
            
            let path = entry.path();
            
            // Skip if exceeds max size
            if let Some(max_size) = self.config.max_file_size {
                if let Ok(metadata) = fs::metadata(path) {
                    if metadata.len() > max_size {
                        continue;
                    }
                }
            }
            
            // Compute hash
            let hash = match hash_file(path) {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("Hash error for {}: {}", path.display(), e);
                    continue;
                }
            };
            
            // Get metadata
            let metadata = fs::metadata(path)?;
            let modified: DateTime<Utc> = metadata.modified()
                .map(|t| t.into())
                .unwrap_or_else(|_| Utc::now());
            
            // Compute relative path
            let relative_path = path.strip_prefix(dir_path)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            
            entries.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                relative_path,
                hash,
                size: metadata.len(),
                modified,
                status: FileStatus::Unknown,
            });
        }
        
        Ok(entries)
    }
    
    /// Compare current scan with previous manifest
    pub fn compare_with_manifest(
        &self,
        current: &mut [FileEntry],
        previous: &[FileEntry],
    ) -> (usize, usize, usize, usize) {
        // Build lookup map for previous entries
        let prev_map: HashMap<&str, &FileEntry> = previous
            .iter()
            .map(|e| (e.relative_path.as_str(), e))
            .collect();
        
        let mut verified = 0;
        let mut modified = 0;
        let mut new = 0;
        
        // Check current files
        for entry in current.iter_mut() {
            if let Some(prev_entry) = prev_map.get(entry.relative_path.as_str()) {
                if entry.hash == prev_entry.hash {
                    entry.status = FileStatus::Verified;
                    verified += 1;
                } else {
                    entry.status = FileStatus::Modified;
                    modified += 1;
                }
            } else {
                entry.status = FileStatus::New;
                new += 1;
            }
        }
        
        // Check for deleted files
        let current_paths: std::collections::HashSet<&str> = current
            .iter()
            .map(|e| e.relative_path.as_str())
            .collect();
        
        let deleted = previous
            .iter()
            .filter(|e| !current_paths.contains(e.relative_path.as_str()))
            .count();
        
        (verified, modified, new, deleted)
    }
    
    /// Perform full integrity scan
    pub fn full_scan(
        &self,
        protected_path: &ProtectedPath,
        previous_manifest: Option<&[FileEntry]>,
    ) -> Result<ScanResult> {
        let start = std::time::Instant::now();
        let path = Path::new(&protected_path.path);
        
        // Scan directory
        let mut entries = self.scan_directory(path)?;
        let total_files = entries.len();
        
        // Compare with previous
        let (verified, modified, new, deleted) = if let Some(prev) = previous_manifest {
            self.compare_with_manifest(&mut entries, prev)
        } else {
            // First scan - mark all as new
            for entry in &mut entries {
                entry.status = FileStatus::New;
            }
            (0, 0, total_files, 0)
        };
        
        // Compute merkle root
        let hashes: Vec<String> = entries.iter().map(|e| e.hash.clone()).collect();
        let root = merkle_root(&hashes);
        
        // Determine status
        let status = if modified > 0 || deleted > 0 {
            PathStatus::Compromised
        } else {
            PathStatus::Verified
        };
        
        let duration = start.elapsed().as_millis() as u64;
        
        Ok(ScanResult {
            path_id: protected_path.id.clone(),
            path: protected_path.path.clone(),
            status,
            total_files,
            verified_files: verified,
            modified_files: modified,
            new_files: new,
            deleted_files: deleted,
            merkle_root: root,
            scan_duration_ms: duration,
            errors: vec![],
        })
    }
    
    /// Verify a single file
    pub fn verify_file(&self, file_path: &Path, expected_hash: &str) -> Result<bool> {
        let actual_hash = hash_file(file_path)?;
        Ok(actual_hash == expected_hash)
    }
    
    /// Build file tree for UI
    pub fn build_file_tree(&self, entries: &[FileEntry], root_path: &str) -> FileTreeNode {
        let mut root = FileTreeNode::new_dir(root_path.to_string(), root_path.to_string());
        
        for entry in entries {
            let parts: Vec<&str> = entry.relative_path.split(['/', '\\']).collect();
            self.insert_into_tree(&mut root, &parts, entry);
        }
        
        // Sort children
        self.sort_tree(&mut root);
        
        root
    }
    
    fn insert_into_tree(&self, node: &mut FileTreeNode, parts: &[&str], entry: &FileEntry) {
        if parts.is_empty() {
            return;
        }
        
        if parts.len() == 1 {
            // This is a file
            node.children.push(FileTreeNode::new_file(
                entry.path.clone(),
                parts[0].to_string(),
                entry.size,
                entry.hash.clone(),
                entry.status.clone(),
            ));
        } else {
            // This is a directory
            let dir_name = parts[0];
            
            // Find or create directory node
            let dir_node = if let Some(existing) = node.children.iter_mut().find(|c| c.name == dir_name && c.is_dir) {
                existing
            } else {
                let new_dir = FileTreeNode::new_dir(
                    format!("{}/{}", node.path, dir_name),
                    dir_name.to_string(),
                );
                node.children.push(new_dir);
                node.children.last_mut().unwrap()
            };
            
            // Recurse
            self.insert_into_tree(dir_node, &parts[1..], entry);
        }
    }
    
    fn sort_tree(&self, node: &mut FileTreeNode) {
        // Directories first, then files, both alphabetically
        node.children.sort_by(|a, b| {
            match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });
        
        // Recurse into directories
        for child in &mut node.children {
            if child.is_dir {
                self.sort_tree(child);
            }
        }
    }
}

/// Summary of all protected paths
#[derive(Clone, Debug, Serialize)]
pub struct IntegritySummary {
    pub total_paths: usize,
    pub total_files: usize,
    pub verified_paths: usize,
    pub compromised_paths: usize,
    pub unknown_paths: usize,
    pub overall_status: PathStatus,
}

impl IntegritySummary {
    pub fn from_paths(paths: &[ProtectedPath]) -> Self {
        let total_paths = paths.len();
        let total_files: usize = paths.iter().map(|p| p.file_count).sum();
        
        let verified_paths = paths.iter().filter(|p| p.status == PathStatus::Verified).count();
        let compromised_paths = paths.iter().filter(|p| p.status == PathStatus::Compromised).count();
        let unknown_paths = paths.iter().filter(|p| p.status == PathStatus::Unknown).count();
        
        let overall_status = if compromised_paths > 0 {
            PathStatus::Compromised
        } else if unknown_paths == total_paths {
            PathStatus::Unknown
        } else {
            PathStatus::Verified
        };
        
        Self {
            total_paths,
            total_files,
            verified_paths,
            compromised_paths,
            unknown_paths,
            overall_status,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::io::Write;
    
    #[test]
    fn test_scan_directory() {
        let temp_dir = TempDir::new().unwrap();
        
        // Create test files
        let file1 = temp_dir.path().join("test1.txt");
        let mut f = fs::File::create(&file1).unwrap();
        f.write_all(b"Hello World").unwrap();
        
        let file2 = temp_dir.path().join("test2.txt");
        let mut f = fs::File::create(&file2).unwrap();
        f.write_all(b"Test content").unwrap();
        
        let scanner = IntegrityScanner::new(ScanConfig::default());
        let entries = scanner.scan_directory(temp_dir.path()).unwrap();
        
        assert_eq!(entries.len(), 2);
    }
    
    #[test]
    fn test_change_detection() {
        let scanner = IntegrityScanner::new(ScanConfig::default());
        
        let previous = vec![
            FileEntry {
                path: "/test/file1.txt".to_string(),
                relative_path: "file1.txt".to_string(),
                hash: "abc123".to_string(),
                size: 100,
                modified: Utc::now(),
                status: FileStatus::Verified,
            },
        ];
        
        let mut current = vec![
            FileEntry {
                path: "/test/file1.txt".to_string(),
                relative_path: "file1.txt".to_string(),
                hash: "def456".to_string(), // Changed!
                size: 100,
                modified: Utc::now(),
                status: FileStatus::Unknown,
            },
        ];
        
        let (verified, modified, new, deleted) = scanner.compare_with_manifest(&mut current, &previous);
        
        assert_eq!(verified, 0);
        assert_eq!(modified, 1);
        assert_eq!(new, 0);
        assert_eq!(deleted, 0);
    }
}
