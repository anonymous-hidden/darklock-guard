//! BLAKE3-based integrity scanner with Ed25519 signed baselines.
//!
//! The scanner walks a set of protected paths, hashes every file with BLAKE3,
//! and produces a baseline manifest. The manifest is signed with the device's
//! Ed25519 key so attackers cannot forge a clean baseline.

use anyhow::{Context, Result};
use blake3::Hasher;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey, Verifier, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tracing::{info, warn, error, debug};
use walkdir::WalkDir;

/// A single file entry in the baseline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineEntry {
    pub path: String,
    pub hash: String,       // BLAKE3 hex
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub permissions: u32,
}

/// The full integrity baseline manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Baseline {
    pub version: u32,
    pub created_at: DateTime<Utc>,
    pub device_id: String,
    pub entries: HashMap<String, BaselineEntry>,
    pub signature: String,  // Ed25519 signature over the canonical entry data
}

/// Result of comparing current state against baseline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub scanned_at: DateTime<Utc>,
    pub total_files: usize,
    pub modified: Vec<ModifiedFile>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub errors: Vec<ScanError>,
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModifiedFile {
    pub path: String,
    pub expected_hash: String,
    pub actual_hash: String,
    pub expected_size: u64,
    pub actual_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanError {
    pub path: String,
    pub error: String,
}

#[derive(Clone)]
pub struct IntegrityScanner {
    protected_paths: Vec<PathBuf>,
    device_id: String,
}

impl IntegrityScanner {
    pub fn new(protected_paths: Vec<PathBuf>, device_id: String) -> Self {
        Self {
            protected_paths,
            device_id,
        }
    }

    /// Hash a single file using BLAKE3
    fn hash_file(path: &Path) -> Result<(String, u64)> {
        let mut file = fs::File::open(path)
            .with_context(|| format!("Failed to open {}", path.display()))?;
        let metadata = file.metadata()?;
        let size = metadata.len();

        let mut hasher = Hasher::new();
        let mut buffer = vec![0u8; 64 * 1024]; // 64KB buffer
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
        }

        Ok((hasher.finalize().to_hex().to_string(), size))
    }

    /// Walk all protected paths and collect file entries
    fn collect_entries(&self) -> (HashMap<String, BaselineEntry>, Vec<ScanError>) {
        let mut entries = HashMap::new();
        let mut errors = Vec::new();

        for root in &self.protected_paths {
            if !root.exists() {
                warn!("Protected path does not exist: {}", root.display());
                continue;
            }

            let walker = if root.is_file() {
                WalkDir::new(root).max_depth(0)
            } else {
                WalkDir::new(root).follow_links(false)
            };

            for entry in walker.into_iter() {
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        errors.push(ScanError {
                            path: format!("{}", root.display()),
                            error: e.to_string(),
                        });
                        continue;
                    }
                };

                if !entry.file_type().is_file() {
                    continue;
                }

                let path = entry.path();
                let canonical = match path.canonicalize() {
                    Ok(c) => c,
                    Err(e) => {
                        errors.push(ScanError {
                            path: path.display().to_string(),
                            error: e.to_string(),
                        });
                        continue;
                    }
                };

                match Self::hash_file(&canonical) {
                    Ok((hash, size)) => {
                        let modified = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .map(DateTime::<Utc>::from)
                            .unwrap_or_else(Utc::now);

                        #[cfg(unix)]
                        let permissions = {
                            use std::os::unix::fs::PermissionsExt;
                            entry.metadata().map(|m| m.permissions().mode()).unwrap_or(0)
                        };
                        #[cfg(not(unix))]
                        let permissions = 0u32;

                        let key = canonical.display().to_string();
                        entries.insert(key.clone(), BaselineEntry {
                            path: key,
                            hash,
                            size,
                            modified,
                            permissions,
                        });
                    }
                    Err(e) => {
                        errors.push(ScanError {
                            path: canonical.display().to_string(),
                            error: e.to_string(),
                        });
                    }
                }
            }
        }

        (entries, errors)
    }

    /// Create a canonical bytes representation of entries for signing
    fn canonical_bytes(entries: &HashMap<String, BaselineEntry>) -> Vec<u8> {
        let mut keys: Vec<&String> = entries.keys().collect();
        keys.sort();

        let mut hasher = Sha256::new();
        for key in keys {
            let entry = &entries[key];
            hasher.update(entry.path.as_bytes());
            hasher.update(b":");
            hasher.update(entry.hash.as_bytes());
            hasher.update(b":");
            hasher.update(entry.size.to_le_bytes());
            hasher.update(b"\n");
        }
        hasher.finalize().to_vec()
    }

    /// Generate a new baseline, signed with the device's Ed25519 key
    pub fn generate_baseline(&self, signing_key: &SigningKey) -> Result<Baseline> {
        info!("Generating integrity baseline for {} protected paths", self.protected_paths.len());
        let (entries, errors) = self.collect_entries();

        if !errors.is_empty() {
            warn!("{} errors during baseline generation", errors.len());
            for err in &errors {
                warn!("  {} — {}", err.path, err.error);
            }
        }

        let canonical = Self::canonical_bytes(&entries);
        let signature = signing_key.sign(&canonical);

        info!("Baseline generated: {} files", entries.len());

        Ok(Baseline {
            version: 1,
            created_at: Utc::now(),
            device_id: self.device_id.clone(),
            entries,
            signature: hex::encode(signature.to_bytes()),
        })
    }

    /// Verify a baseline's signature
    pub fn verify_baseline_signature(baseline: &Baseline, verifying_key: &VerifyingKey) -> Result<bool> {
        let canonical = Self::canonical_bytes(&baseline.entries);
        let sig_bytes = hex::decode(&baseline.signature)
            .context("Invalid baseline signature hex")?;
        let signature = Signature::from_bytes(
            sig_bytes.as_slice().try_into().map_err(|_| anyhow::anyhow!("Invalid signature length"))?
        );

        match verifying_key.verify(&canonical, &signature) {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// Scan current state and compare against a baseline
    pub fn scan_against_baseline(&self, baseline: &Baseline) -> ScanResult {
        info!("Running integrity scan against baseline ({} entries)", baseline.entries.len());
        let (current_entries, errors) = self.collect_entries();

        let mut modified = Vec::new();
        let mut added = Vec::new();
        let mut removed = Vec::new();

        // Check for modified and removed files
        for (path, expected) in &baseline.entries {
            match current_entries.get(path) {
                Some(actual) => {
                    if actual.hash != expected.hash {
                        modified.push(ModifiedFile {
                            path: path.clone(),
                            expected_hash: expected.hash.clone(),
                            actual_hash: actual.hash.clone(),
                            expected_size: expected.size,
                            actual_size: actual.size,
                        });
                    }
                }
                None => {
                    removed.push(path.clone());
                }
            }
        }

        // Check for added files
        for path in current_entries.keys() {
            if !baseline.entries.contains_key(path) {
                added.push(path.clone());
            }
        }

        let valid = modified.is_empty() && removed.is_empty();
        let total_files = current_entries.len();

        if valid {
            info!("Integrity scan passed: {} files verified", total_files);
        } else {
            error!(
                "INTEGRITY VIOLATION: {} modified, {} removed, {} added",
                modified.len(), removed.len(), added.len()
            );
        }

        ScanResult {
            scanned_at: Utc::now(),
            total_files,
            modified,
            added,
            removed,
            errors,
            valid,
        }
    }

    /// Save baseline to disk as JSON
    pub fn save_baseline(baseline: &Baseline, path: &Path) -> Result<()> {
        let json = serde_json::to_string_pretty(baseline)?;
        fs::write(path, json)?;
        debug!("Baseline saved to {}", path.display());
        Ok(())
    }

    /// Load baseline from disk
    pub fn load_baseline(path: &Path) -> Result<Baseline> {
        let json = fs::read_to_string(path)?;
        let baseline: Baseline = serde_json::from_str(&json)?;
        debug!("Baseline loaded from {} ({} entries)", path.display(), baseline.entries.len());
        Ok(baseline)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_hash_file() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.txt");
        File::create(&file_path).unwrap().write_all(b"hello world").unwrap();

        let (hash, size) = IntegrityScanner::hash_file(&file_path).unwrap();
        assert_eq!(size, 11);
        assert!(!hash.is_empty());
    }

    #[test]
    fn test_baseline_roundtrip() {
        let dir = tempdir().unwrap();
        // Create test files
        File::create(dir.path().join("a.txt")).unwrap().write_all(b"aaa").unwrap();
        File::create(dir.path().join("b.txt")).unwrap().write_all(b"bbb").unwrap();

        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        let scanner = IntegrityScanner::new(vec![dir.path().to_path_buf()], "test-device".into());
        let baseline = scanner.generate_baseline(&signing_key).unwrap();

        assert_eq!(baseline.entries.len(), 2);
        assert!(IntegrityScanner::verify_baseline_signature(&baseline, &verifying_key).unwrap());

        // Scan should be clean
        let result = scanner.scan_against_baseline(&baseline);
        assert!(result.valid);
        assert!(result.modified.is_empty());
        assert!(result.removed.is_empty());

        // Modify a file
        File::create(dir.path().join("a.txt")).unwrap().write_all(b"MODIFIED").unwrap();
        let result = scanner.scan_against_baseline(&baseline);
        assert!(!result.valid);
        assert_eq!(result.modified.len(), 1);
    }
}
