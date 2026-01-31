use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseManifest {
    pub version: String,
    pub download_url: String,
    pub sha256: String,
    pub signature: String,
    pub revoked: Option<bool>,
}

pub fn load_manifest(path: &str) -> Result<ReleaseManifest> {
    let file = std::fs::File::open(path)?;
    let manifest: ReleaseManifest = serde_json::from_reader(file)?;
    Ok(manifest)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionFile {
    pub version: String,
    pub updater_sha256: String,
    pub release_pubkey: Option<String>,
}

pub fn load_version_file(path: &Path) -> Result<VersionFile> {
    let f = std::fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}
