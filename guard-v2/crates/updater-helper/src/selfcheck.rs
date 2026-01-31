use crate::manifest::load_version_file;
use crate::util::hash_file;
use anyhow::{anyhow, Result};
use std::path::Path;

pub fn self_integrity_check(version_file: &str) -> Result<()> {
    let vf = load_version_file(Path::new(version_file))?;
    let exe = std::env::current_exe()?;
    let hash = hash_file(&exe)?;
    if hash != vf.updater_sha256 {
        return Err(anyhow!("updater self-hash mismatch"));
    }
    Ok(())
}
