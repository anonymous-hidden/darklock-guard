//! Quarantine zone – moves tampered files that cannot be restored to a safe
//! holding area for later forensic inspection. Files are **never deleted**,
//! only moved.
//!
//! Layout: {data_dir}/quarantine/{timestamp}_{original_filename}

use anyhow::{Context, Result};
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

pub struct QuarantineZone {
    root: PathBuf,
}

impl QuarantineZone {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).with_context(|| format!("create quarantine dir {}", root.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&root, fs::Permissions::from_mode(0o700));
        }
        Ok(Self { root })
    }

    /// Move a tampered file into quarantine. Returns the quarantine destination
    /// path, or `None` if the source doesn't exist (already deleted).
    pub fn quarantine_file(&self, source: &Path) -> Result<Option<PathBuf>> {
        if !source.exists() {
            info!(path = %source.display(), "quarantine: source already gone, nothing to move");
            return Ok(None);
        }

        let filename = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let ts = Utc::now().format("%Y%m%dT%H%M%S%.3f");
        let dest_name = format!("{}_{}", ts, filename);
        let dest = self.root.join(&dest_name);

        match fs::rename(source, &dest) {
            Ok(()) => {
                info!(
                    from = %source.display(),
                    to = %dest.display(),
                    "file quarantined (moved)"
                );
                Ok(Some(dest))
            }
            Err(rename_err) => {
                // Cross-filesystem rename fails; fall back to copy-then-delete.
                warn!(
                    error = %rename_err,
                    "rename to quarantine failed, trying copy"
                );
                fs::copy(source, &dest)
                    .with_context(|| format!("copy {} to quarantine", source.display()))?;
                // Best-effort delete of original.
                let _ = fs::remove_file(source);
                info!(
                    from = %source.display(),
                    to = %dest.display(),
                    "file quarantined (copied)"
                );
                Ok(Some(dest))
            }
        }
    }

    #[allow(dead_code)]
    pub fn root(&self) -> &Path {
        &self.root
    }
}
