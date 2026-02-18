//! Content-addressed backup store for Darklock Guard.
//!
//! Stores immutable blobs addressed by their BLAKE3 hash. An Ed25519-signed
//! manifest maps canonical file paths to blob hashes and metadata. Blobs may be
//! optionally compressed with zstd for files larger than 4 KiB.
//!
//! CHANGELOG (vs previous revision):
//!  - Fixed original_size bug (was overwritten with stored_bytes.len)
//!  - Added `read_blob_verified()` – verifies blob against *expected* baseline hash
//!  - Added `has_entry()`, `entry_for()`, `manifest()` accessors
//!  - Added `ensure_from_bytes()` for programmatic population
//!  - Added `blake3_hex()` public helper

use anyhow::{anyhow, Context, Result};
use blake3::Hasher;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tracing::warn;
use uuid::Uuid;

const MANIFEST_VERSION: u32 = 1;
const COMPRESSION_THRESHOLD: usize = 4 * 1024; // 4 KiB

// ── Errors ──────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum BackupStoreError {
    #[error("manifest signature invalid")]
    InvalidManifestSignature,
    #[error("blob missing for hash {0}")]
    BlobMissing(String),
    #[error("blob corrupted – expected {expected}, got {actual}")]
    BlobCorrupted { expected: String, actual: String },
    #[error("path not found in manifest: {0}")]
    PathNotFound(String),
}

// ── Data Models ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub path: String,
    pub blob_hash: String,
    pub original_size: u64,
    pub stored_size: u64,
    pub permissions: u32,
    pub owner: Option<String>,
    pub compressed: bool,
    pub stored_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: u32,
    pub device_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub entries: HashMap<String, BackupEntry>,
    pub total_size: u64,
    pub signature: String,
}

// ── Store ───────────────────────────────────────────────────────────────────

pub struct BackupStore {
    root: PathBuf,
    manifest_path: PathBuf,
    blobs_root: PathBuf,
    staging_root: PathBuf,
    manifest: BackupManifest,
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
}

impl BackupStore {
    /// Load an existing store or create a new one.
    pub fn load_or_create(
        root: impl AsRef<Path>,
        signing_key: SigningKey,
        device_id: &str,
    ) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        let manifest_path = root.join("store.manifest");
        let blobs_root = root.join("blobs");
        let staging_root = root.join("staging");

        fs::create_dir_all(&blobs_root)?;
        fs::create_dir_all(&staging_root)?;
        Self::restrict_dir_permissions(&root);

        // Clean up orphaned staging files from a previous crash.
        Self::cleanup_staging_dir(&staging_root);

        let verifying_key = signing_key.verifying_key();

        let manifest = if manifest_path.exists() {
            let json = fs::read_to_string(&manifest_path)?;
            let manifest: BackupManifest = serde_json::from_str(&json)?;
            Self::verify_manifest_sig(&manifest, &verifying_key)?;
            if manifest.device_id != device_id {
                return Err(anyhow!("manifest device_id mismatch"));
            }
            manifest
        } else {
            let mut manifest = BackupManifest {
                version: MANIFEST_VERSION,
                device_id: device_id.to_string(),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                entries: HashMap::new(),
                total_size: 0,
                signature: String::new(),
            };
            Self::sign_manifest(&mut manifest, &signing_key)?;
            let json = serde_json::to_string_pretty(&manifest)?;
            fs::write(&manifest_path, json)?;
            manifest
        };

        Ok(Self {
            root,
            manifest_path,
            blobs_root,
            staging_root,
            manifest,
            signing_key,
            verifying_key,
        })
    }

    // ── Public accessors ────────────────────────────────────────────────────

    pub fn has_entry(&self, path: &str) -> bool {
        self.manifest.entries.contains_key(path)
    }

    pub fn entry_for(&self, path: &str) -> Option<&BackupEntry> {
        self.manifest.entries.get(path)
    }

    pub fn manifest(&self) -> &BackupManifest {
        &self.manifest
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    // ── Ingest ──────────────────────────────────────────────────────────────

    /// Read a file from disk, verify it matches `expected_hash`, store blob.
    pub fn ensure_from_disk(
        &mut self,
        canonical_path: &Path,
        expected_hash: &str,
        permissions: u32,
        owner: Option<String>,
    ) -> Result<BackupEntry> {
        let mut file =
            File::open(canonical_path).with_context(|| format!("open {}", canonical_path.display()))?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;

        let hash = blake3_hex(&data);
        if hash != expected_hash {
            return Err(anyhow!(
                "hash mismatch for {} (expected {}, got {})",
                canonical_path.display(),
                expected_hash,
                hash
            ));
        }

        self.store_blob_and_record(
            canonical_path.display().to_string(),
            &data,
            &hash,
            permissions,
            owner,
        )
    }

    /// Store arbitrary bytes as a blob keyed to `canonical_path_str`.
    pub fn ensure_from_bytes(
        &mut self,
        canonical_path_str: String,
        data: &[u8],
        permissions: u32,
        owner: Option<String>,
    ) -> Result<BackupEntry> {
        let hash = blake3_hex(data);
        self.store_blob_and_record(canonical_path_str, data, &hash, permissions, owner)
    }

    // ── Retrieval ───────────────────────────────────────────────────────────

    /// Read the blob for a path, decompress if needed, verify vs manifest.
    pub fn read_path(&self, path: &str) -> Result<Vec<u8>> {
        let entry = self
            .manifest
            .entries
            .get(path)
            .ok_or_else(|| BackupStoreError::PathNotFound(path.to_string()))?;
        self.read_blob_by_entry(entry)
    }

    /// Same as `read_path` but additionally asserts the blob hash equals
    /// `expected_baseline_hash` and re-verifies the manifest signature.
    /// Use before restoring.
    pub fn read_blob_verified(&self, path: &str, expected_baseline_hash: &str) -> Result<Vec<u8>> {
        // Re-verify manifest signature to detect in-place tampering.
        self.verify_manifest_integrity()
            .context("manifest signature check failed before restore")?;

        let entry = self
            .manifest
            .entries
            .get(path)
            .ok_or_else(|| BackupStoreError::PathNotFound(path.to_string()))?;

        if entry.blob_hash != expected_baseline_hash {
            return Err(anyhow!(BackupStoreError::BlobCorrupted {
                expected: expected_baseline_hash.to_string(),
                actual: entry.blob_hash.clone(),
            }));
        }

        let data = self.read_blob_by_entry(entry)?;
        let actual = blake3_hex(&data);
        if actual != expected_baseline_hash {
            return Err(anyhow!(BackupStoreError::BlobCorrupted {
                expected: expected_baseline_hash.to_string(),
                actual,
            }));
        }
        Ok(data)
    }

    // ── Verification ────────────────────────────────────────────────────────

    /// Re-verify the manifest signature using the stored verifying key.
    /// Call this before any restore to ensure the manifest hasn't been tampered with.
    pub fn verify_manifest_integrity(&self) -> Result<()> {
        Self::verify_manifest_sig(&self.manifest, &self.verifying_key)
    }

    pub fn verify_all(&self) -> Result<()> {
        self.verify_manifest_integrity()?;
        for (path, entry) in &self.manifest.entries {
            let data = self
                .read_blob_by_entry(entry)
                .with_context(|| format!("verifying blob for {path}"))?;
            let actual = blake3_hex(&data);
            if actual != entry.blob_hash {
                return Err(anyhow!(BackupStoreError::BlobCorrupted {
                    expected: entry.blob_hash.clone(),
                    actual,
                }));
            }
        }
        Ok(())
    }

    // ── Removal ─────────────────────────────────────────────────────────────

    pub fn remove_entry(&mut self, path: &str) {
        if let Some(entry) = self.manifest.entries.remove(path) {
            self.manifest.total_size = self.manifest.total_size.saturating_sub(entry.stored_size);
            self.manifest.updated_at = Utc::now();
            let _ = Self::sign_manifest(&mut self.manifest, &self.signing_key);
            let _ = self.persist_manifest();
        }
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    fn store_blob_and_record(
        &mut self,
        canonical_path_str: String,
        data: &[u8],
        hash: &str,
        permissions: u32,
        owner: Option<String>,
    ) -> Result<BackupEntry> {
        let original_size = data.len() as u64;
        let compressed = data.len() > COMPRESSION_THRESHOLD;
        let stored_bytes = if compressed {
            zstd::encode_all(&data[..], 3)?
        } else {
            data.to_vec()
        };
        let stored_size = stored_bytes.len() as u64;

        let blob_path = self.blob_path(hash);
        if !blob_path.exists() {
            self.write_blob_atomic(&blob_path, &stored_bytes)?;
        }

        let entry = BackupEntry {
            path: canonical_path_str.clone(),
            blob_hash: hash.to_string(),
            original_size,
            stored_size,
            permissions,
            owner,
            compressed,
            stored_at: Utc::now(),
        };

        if let Some(existing) = self.manifest.entries.get(&canonical_path_str) {
            self.manifest.total_size = self.manifest.total_size.saturating_sub(existing.stored_size);
        }
        self.manifest.total_size = self.manifest.total_size.saturating_add(stored_size);
        self.manifest
            .entries
            .insert(canonical_path_str, entry.clone());
        self.manifest.updated_at = Utc::now();
        Self::sign_manifest(&mut self.manifest, &self.signing_key)?;
        self.persist_manifest()?;
        Ok(entry)
    }

    fn read_blob_by_entry(&self, entry: &BackupEntry) -> Result<Vec<u8>> {
        let blob_path = self.blob_path(&entry.blob_hash);
        if !blob_path.exists() {
            return Err(anyhow!(BackupStoreError::BlobMissing(
                entry.blob_hash.clone()
            )));
        }
        let mut file = File::open(&blob_path)?;
        let mut raw = Vec::new();
        file.read_to_end(&mut raw)?;
        if entry.compressed {
            Ok(zstd::decode_all(&raw[..])?)
        } else {
            Ok(raw)
        }
    }

    fn blob_path(&self, hash: &str) -> PathBuf {
        let prefix = &hash[0..2.min(hash.len())];
        self.blobs_root.join(prefix).join(format!("{}.blob", hash))
    }

    fn write_blob_atomic(&self, dest: &Path, bytes: &[u8]) -> Result<()> {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        let staging_name = format!("{}.staging", Uuid::new_v4());
        let staging_path = self.staging_root.join(staging_name);
        {
            let mut file = File::create(&staging_path)?;
            file.write_all(bytes)?;
            file.sync_all()?;
        }
        Self::fsync_dir(&self.staging_root)?;
        fs::rename(&staging_path, dest)?;
        if let Some(parent) = dest.parent() {
            Self::fsync_dir(parent)?;
        }
        Ok(())
    }

    fn sign_manifest(manifest: &mut BackupManifest, signing_key: &SigningKey) -> Result<()> {
        let canonical = Self::canonical_manifest_bytes(&manifest.entries);
        let signature = signing_key.sign(&canonical);
        manifest.signature = hex::encode(signature.to_bytes());
        Ok(())
    }

    fn verify_manifest_sig(manifest: &BackupManifest, verifying_key: &VerifyingKey) -> Result<()> {
        let canonical = Self::canonical_manifest_bytes(&manifest.entries);
        let sig_bytes =
            hex::decode(&manifest.signature).context("decode manifest signature hex")?;
        let signature = Signature::from_bytes(
            sig_bytes
                .as_slice()
                .try_into()
                .map_err(|_| anyhow!("invalid signature length"))?,
        );
        verifying_key
            .verify(&canonical, &signature)
            .map_err(|_| anyhow!(BackupStoreError::InvalidManifestSignature))
    }

    fn canonical_manifest_bytes(entries: &HashMap<String, BackupEntry>) -> Vec<u8> {
        let mut keys: Vec<&String> = entries.keys().collect();
        keys.sort();
        let mut hasher = Sha256::new();
        for key in keys {
            let entry = &entries[key];
            hasher.update(entry.path.as_bytes());
            hasher.update(b"|");
            hasher.update(entry.blob_hash.as_bytes());
            hasher.update(b"|");
            hasher.update(entry.original_size.to_le_bytes());
            hasher.update(entry.stored_size.to_le_bytes());
            hasher.update(entry.permissions.to_le_bytes());
            hasher.update(b"\n");
        }
        hasher.finalize().to_vec()
    }

    fn persist_manifest(&self) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.manifest)?;
        fs::write(&self.manifest_path, json)?;
        Ok(())
    }

    fn restrict_dir_permissions(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) = fs::set_permissions(path, fs::Permissions::from_mode(0o700)) {
                warn!("cannot restrict permissions on {}: {}", path.display(), e);
            }
        }
    }

    /// Remove any leftover `.staging` files from a previous crash.
    fn cleanup_staging_dir(staging_root: &Path) {
        if let Ok(entries) = fs::read_dir(staging_root) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name.to_string_lossy().ends_with(".staging") {
                    warn!(path = %entry.path().display(), "removing orphaned backup staging file");
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    fn fsync_dir(path: &Path) -> Result<()> {
        #[cfg(unix)]
        {
            let dir = OpenOptions::new().read(true).open(path)?;
            dir.sync_all()?;
        }
        Ok(())
    }
}

// ── Utility ────────────────────────────────────────────────────────────────

/// Compute the BLAKE3 hex digest of `data`.
pub fn blake3_hex(data: &[u8]) -> String {
    let mut hasher = Hasher::new();
    hasher.update(data);
    hasher.finalize().to_hex().to_string()
}
