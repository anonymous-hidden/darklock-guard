use anyhow::{anyhow, Result};
use chrono::Utc;
use fs_extra::dir::{copy as copy_dir, CopyOptions};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupManifest {
    pub created_at: String,
    pub source: String,
    pub files: Vec<String>,
}

pub fn backup_current(install_dir: &str, backup_root: &str) -> Result<PathBuf> {
    let ts = Utc::now().format("%Y%m%dT%H%M%S");
    let backup_dir = Path::new(backup_root).join(format!("backup_{}", ts));
    fs::create_dir_all(&backup_dir)?;
    let mut opts = CopyOptions::new();
    opts.copy_inside = true;
    opts.content_only = false;
    copy_dir(install_dir, &backup_dir, &opts).map_err(|e| anyhow!("backup copy failed: {e}"))?;
    let files = list_files(&backup_dir)?;
    let manifest = BackupManifest {
        created_at: ts.to_string(),
        source: install_dir.to_string(),
        files: files.clone(),
    };
    let manifest_path = backup_dir.join("backup_manifest.json");
    let manifest_json = serde_json::to_vec_pretty(&manifest)?;
    fs::write(&manifest_path, manifest_json)?;
    Ok(manifest_path)
}

pub fn cleanup_old_backups(root: &str, keep: usize) -> Result<()> {
    let mut entries: Vec<PathBuf> = fs::read_dir(root)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    entries.sort();
    if entries.len() <= keep {
        return Ok(());
    }
    let remove = entries.len() - keep;
    for p in entries.iter().take(remove) {
        fs::remove_dir_all(p)?;
    }
    Ok(())
}

pub fn list_files(dir: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(dir) {
        let entry = entry?;
        if entry.file_type().is_file() {
            let rel = entry.path().strip_prefix(dir).unwrap();
            out.push(rel.to_string_lossy().to_string());
        }
    }
    Ok(out)
}
