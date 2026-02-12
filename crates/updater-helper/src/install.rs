use crate::backup::BackupManifest;
use anyhow::{anyhow, Result};
use flate2::read::GzDecoder;
use fs_extra::dir::{copy as copy_dir, CopyOptions};
use std::fs;
use std::path::Path;
use std::process::Command;
use tar::Archive;

pub fn stop_service(cmd: Option<String>) -> Result<()> {
    if let Some(c) = cmd {
        run_cmd(&c)?;
    }
    Ok(())
}

pub fn start_service(cmd: Option<String>) -> Result<()> {
    if let Some(c) = cmd {
        run_cmd(&c)?;
    }
    Ok(())
}

fn run_cmd(cmdline: &str) -> Result<()> {
    let mut parts = cmdline.split_whitespace();
    let prog = parts.next().ok_or_else(|| anyhow!("empty command"))?;
    let args: Vec<&str> = parts.collect();
    let status = Command::new(prog).args(args).status()?;
    if !status.success() {
        return Err(anyhow!("command failed: {}", cmdline));
    }
    Ok(())
}

pub fn install_package(package: &str, install_dir: &str) -> Result<()> {
    fs::create_dir_all(install_dir)?;
    let file = fs::File::open(package)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    archive.unpack(install_dir)?;
    Ok(())
}

pub fn rollback_from_manifest(manifest_path: &str, install_dir: &str) -> Result<()> {
    let data = fs::read(manifest_path)?;
    let manifest: BackupManifest = serde_json::from_slice(&data)?;
    let backup_dir = Path::new(manifest_path)
        .parent()
        .ok_or_else(|| anyhow!("bad manifest path"))?;
    // The backup contains install/ subdirectory, we need to restore from there
    let source = backup_dir.join(
        Path::new(&manifest.source)
            .file_name()
            .ok_or_else(|| anyhow!("no filename in source"))?,
    );
    if !source.exists() {
        return Err(anyhow!("backup source not found: {:?}", source));
    }
    // wipe install dir then copy back from backup install copy
    if Path::new(install_dir).exists() {
        fs::remove_dir_all(install_dir)?;
    }
    fs::create_dir_all(install_dir)?;
    // Copy contents of the backed-up install dir into install_dir
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let src = entry.path();
        let dest = Path::new(install_dir).join(entry.file_name());
        if src.is_dir() {
            let mut opts = CopyOptions::new();
            opts.copy_inside = true;
            copy_dir(&src, &dest, &opts).map_err(|e| anyhow!("rollback copy: {e}"))?;
        } else {
            fs::copy(&src, dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn install_and_rollback_cycle() {
        let dir = tempdir().unwrap();
        let install = dir.path().join("install");
        let backup = dir.path().join("backup");
        fs::create_dir_all(&install).unwrap();
        fs::create_dir_all(&backup).unwrap();
        // create tar.gz package
        let pkg_path = dir.path().join("pkg.tar.gz");
        let file_path = dir.path().join("file.txt");
        fs::write(&file_path, b"hello").unwrap();
        create_tar_gz(&pkg_path, &file_path).unwrap();
        install_package(pkg_path.to_str().unwrap(), install.to_str().unwrap()).unwrap();
        assert!(install.join("file.txt").exists());
        let manifest =
            crate::backup::backup_current(install.to_str().unwrap(), backup.to_str().unwrap())
                .unwrap();
        fs::remove_file(install.join("file.txt")).unwrap();
        rollback_from_manifest(manifest.to_str().unwrap(), install.to_str().unwrap()).unwrap();
        assert!(install.join("file.txt").exists());
    }

    fn create_tar_gz(out: &Path, file: &Path) -> Result<()> {
        let tar_gz = fs::File::create(out)?;
        let enc = flate2::write::GzEncoder::new(tar_gz, flate2::Compression::default());
        let mut tar = tar::Builder::new(enc);
        tar.append_path_with_name(file, "file.txt")?;
        tar.finish()?;
        Ok(())
    }
}
