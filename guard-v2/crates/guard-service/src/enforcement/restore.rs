//! Atomic file restore engine.
//!
//! Implements the restore algorithm from BACKEND_ARCHITECTURE.md §6 exactly:
//!
//! 1. Acquire per-path mutex
//! 2. Validate backup integrity (blob hash == baseline hash)
//! 3. Write staging file in SAME directory as target (same filesystem)
//! 4. fsync file + fsync parent dir (Linux)
//! 5. Atomic rename (POSIX rename / Windows MoveFileExW REPLACE_EXISTING)
//! 6. Restore permissions/ownership from baseline metadata
//! 7. Verify final hash
//! 8. Retry 3× (100ms, 500ms, 2s) then quarantine
//!
//! Restore-loop suppression: A `HashSet<PathBuf>` of paths currently being
//! restored. The watcher pipeline must check this set and skip events for
//! paths undergoing restore.

use anyhow::{anyhow, Context, Result};
use blake3::Hasher;
use guard_core::backup_store::BackupStore;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

use crate::enforcement::quarantine::QuarantineZone;
use crate::integrity::scanner::BaselineEntry;

/// Minimum free space required before writing a restored file (bytes).
const MIN_FREE_SPACE_BYTES: u64 = 10 * 1024 * 1024; // 10 MiB

/// Staging file prefix used so we can clean up orphans on startup.
const STAGING_PREFIX: &str = ".darklock_restore_";

/// Result of a single restore attempt.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum RestoreOutcome {
    Restored,
    AlreadyRestoring,
    BackupCorrupted { path: String },
    Quarantined { quarantine_path: Option<PathBuf> },
    Failed { error: String },
}

/// The restore engine.
pub struct RestoreEngine {
    /// Per-path locks to prevent concurrent restores of the same file.
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// Paths currently undergoing atomic restore — the watcher must skip these.
    pub restoring: Arc<Mutex<HashSet<PathBuf>>>,
    quarantine: QuarantineZone,
}

const MAX_RETRIES: usize = 3;
const RETRY_DELAYS_MS: [u64; MAX_RETRIES] = [100, 500, 2000];

impl RestoreEngine {
    pub fn new(quarantine: QuarantineZone) -> Self {
        Self {
            locks: Mutex::new(HashMap::new()),
            restoring: Arc::new(Mutex::new(HashSet::new())),
            quarantine,
        }
    }

    /// Core public entry point.  Attempts to atomically restore `path` from
    /// the backup store, verifying against `baseline_entry`.  Retries up to 3
    /// times on transient failures; quarantines the tampered file on permanent
    /// failure.
    pub fn restore_file(
        &self,
        path: &Path,
        baseline_entry: &BaselineEntry,
        backup_store: &BackupStore,
    ) -> RestoreOutcome {
        // ── Step 1: per-path lock ───────────────────────────────────────
        let path_key = path.display().to_string();
        let lock = {
            let mut locks = self.locks.lock();
            locks
                .entry(path_key.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        let guard = match lock.try_lock() {
            Some(g) => g,
            None => return RestoreOutcome::AlreadyRestoring,
        };

        // Mark as restoring so the watcher suppresses events for this path.
        self.restoring.lock().insert(path.to_path_buf());

        let outcome = self.restore_with_retries(path, baseline_entry, backup_store);

        // Unmark regardless of outcome.
        self.restoring.lock().remove(path);
        drop(guard);

        outcome
    }

    /// Check whether a path is currently being restored (for loop suppression).
    #[allow(dead_code)]
    pub fn is_restoring(&self, path: &Path) -> bool {
        self.restoring.lock().contains(path)
    }

    /// Borrow the quarantine zone (e.g. for logging its root).
    #[allow(dead_code)]
    pub fn quarantine(&self) -> &QuarantineZone {
        &self.quarantine
    }

    /// Clean up any orphaned staging files left by a previous crash.
    /// Call on service startup to ensure crash safety.
    pub fn cleanup_staging(protected_paths: &[PathBuf]) {
        for root in protected_paths {
            let dir = if root.is_file() {
                root.parent().map(|p| p.to_path_buf())
            } else if root.is_dir() {
                Some(root.clone())
            } else {
                None
            };
            if let Some(dir) = dir {
                Self::cleanup_staging_in_dir(&dir);
            }
        }
    }

    fn cleanup_staging_in_dir(dir: &Path) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(STAGING_PREFIX) {
                    warn!(path = %entry.path().display(), "removing orphaned staging file");
                    let _ = fs::remove_file(entry.path());
                }
                // Recurse into subdirectories
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    Self::cleanup_staging_in_dir(&entry.path());
                }
            }
        }
    }

    // ── internals ───────────────────────────────────────────────────────

    fn restore_with_retries(
        &self,
        path: &Path,
        entry: &BaselineEntry,
        store: &BackupStore,
    ) -> RestoreOutcome {
        for attempt in 0..MAX_RETRIES {
            match self.try_restore_once(path, entry, store) {
                Ok(()) => return RestoreOutcome::Restored,
                Err(e) => {
                    let is_corruption = e.to_string().contains("corrupted")
                        || e.to_string().contains("missing");
                    if is_corruption {
                        error!(
                            path = %path.display(),
                            error = %e,
                            "backup corrupted – cannot restore"
                        );
                        return RestoreOutcome::BackupCorrupted {
                            path: path.display().to_string(),
                        };
                    }
                    warn!(
                        path = %path.display(),
                        attempt = attempt + 1,
                        error = %e,
                        "restore attempt failed"
                    );
                    if attempt + 1 < MAX_RETRIES {
                        std::thread::sleep(Duration::from_millis(RETRY_DELAYS_MS[attempt]));
                    }
                }
            }
        }

        // All retries exhausted → quarantine
        error!(
            path = %path.display(),
            "all restore attempts failed – quarantining tampered file"
        );
        let q = self.quarantine.quarantine_file(path);
        RestoreOutcome::Quarantined {
            quarantine_path: q.ok().flatten(),
        }
    }

    fn try_restore_once(
        &self,
        target_path: &Path,
        entry: &BaselineEntry,
        store: &BackupStore,
    ) -> Result<()> {
        // ── Step 0: symlink attack protection ───────────────────────────
        // Ensure the target path doesn't resolve outside its parent via symlinks.
        validate_no_symlink_escape(target_path)?;

        // ── Step 2: validate backup integrity ───────────────────────────
        let blob_data = store
            .read_blob_verified(&entry.path, &entry.hash)
            .context("backup blob verification failed")?;

        // ── Step 2b: disk space preflight ───────────────────────────────
        let parent = target_path
            .parent()
            .ok_or_else(|| anyhow!("no parent dir for {}", target_path.display()))?;
        fs::create_dir_all(parent)?;
        check_disk_space(parent, blob_data.len() as u64)?;

        // ── Step 3: staging file in same directory ──────────────────────
        let staging_name = format!(
            "{}{:08x}",
            STAGING_PREFIX,
            rand::random::<u32>()
        );
        let staging_path = parent.join(&staging_name);

        {
            let mut file = File::create(&staging_path)
                .with_context(|| format!("create staging {}", staging_path.display()))?;
            file.write_all(&blob_data)?;

            // ── Step 4: fsync ───────────────────────────────────────────
            file.sync_all()?;
        }

        #[cfg(unix)]
        {
            // fsync parent directory to ensure the directory entry is durable
            if let Ok(dir) = OpenOptions::new().read(true).open(parent) {
                let _ = dir.sync_all();
            }
        }

        // ── Step 5: atomic replacement ──────────────────────────────────
        atomic_rename(&staging_path, target_path)
            .with_context(|| format!("atomic rename {} -> {}", staging_path.display(), target_path.display()))?;

        // ── Step 6: restore permissions ─────────────────────────────────
        restore_permissions(target_path, entry.permissions)?;

        // ── Step 7: verify final hash ───────────────────────────────────
        let final_hash = hash_file(target_path)?;
        if final_hash != entry.hash {
            return Err(anyhow!(
                "post-restore verification failed: expected {}, got {}",
                entry.hash,
                final_hash
            ));
        }

        info!(
            path = %target_path.display(),
            hash = %entry.hash,
            "file restored successfully"
        );
        Ok(())
    }
}

// ── Platform helpers ────────────────────────────────────────────────────────

fn atomic_rename(from: &Path, to: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        fs::rename(from, to)?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide_from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let wide_to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        let ret = unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                wide_from.as_ptr(),
                wide_to.as_ptr(),
                windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
                    | windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH,
            )
        };
        if ret == 0 {
            return Err(anyhow!("MoveFileExW failed: {}", std::io::Error::last_os_error()));
        }
    }
    Ok(())
}

fn restore_permissions(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if mode != 0 {
            fs::set_permissions(path, fs::Permissions::from_mode(mode))
                .with_context(|| format!("chmod {} on {}", mode, path.display()))?;
        }
    }
    #[cfg(windows)]
    {
        // On Windows we don't store Unix mode bits; ACL restore is future work.
        let _ = (path, mode);
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut hasher = Hasher::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

// ── Symlink attack protection ───────────────────────────────────────────────

/// Ensure the target path doesn't escape its parent directory via symlinks.
/// The parent directory must exist and the canonical parent of target must
/// match the canonical form of target's lexical parent.
fn validate_no_symlink_escape(target: &Path) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("no parent directory for {}", target.display()))?;

    // If parent doesn't exist yet, we'll create it in the caller — no symlink risk.
    if !parent.exists() {
        return Ok(());
    }

    let canonical_parent = parent
        .canonicalize()
        .with_context(|| format!("canonicalize parent {}", parent.display()))?;

    // If the target file exists, canonicalize it and verify its parent matches.
    if target.exists() {
        let canonical_target = target
            .canonicalize()
            .with_context(|| format!("canonicalize {}", target.display()))?;
        let resolved_parent = canonical_target
            .parent()
            .ok_or_else(|| anyhow!("no parent for canonical target"))?;
        if resolved_parent != canonical_parent {
            return Err(anyhow!(
                "symlink escape detected: {} resolves outside expected parent {}",
                target.display(),
                canonical_parent.display()
            ));
        }
    }

    // Also verify the parent itself isn't a symlink pointing elsewhere.
    if parent.is_symlink() {
        return Err(anyhow!(
            "parent directory {} is a symlink — refusing restore to prevent escape",
            parent.display()
        ));
    }

    Ok(())
}

// ── Disk space preflight ────────────────────────────────────────────────────

/// Check that the filesystem containing `dir` has at least `needed` bytes plus
/// a safety margin (`MIN_FREE_SPACE_BYTES`) of free space.
fn check_disk_space(dir: &Path, needed: u64) -> Result<()> {
    #[cfg(unix)]
    {
        use std::mem::MaybeUninit;
        let c_path = std::ffi::CString::new(dir.to_string_lossy().as_bytes())
            .map_err(|_| anyhow!("invalid path for statvfs"))?;
        let mut stat = MaybeUninit::<libc::statvfs>::uninit();
        let ret = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
        if ret == 0 {
            let stat = unsafe { stat.assume_init() };
            let available = stat.f_bavail as u64 * stat.f_frsize as u64;
            let required = needed + MIN_FREE_SPACE_BYTES;
            if available < required {
                return Err(anyhow!(
                    "insufficient disk space: need {} bytes, only {} available in {}",
                    required,
                    available,
                    dir.display()
                ));
            }
        } else {
            warn!(dir = %dir.display(), "statvfs failed; skipping space check");
        }
    }
    #[cfg(not(unix))]
    {
        // On Windows, GetDiskFreeSpaceExW would go here; for now skip.
        let _ = (dir, needed);
    }
    Ok(())
}
