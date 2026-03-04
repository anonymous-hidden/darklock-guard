use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

pub fn temp_download_path() -> String {
    std::env::temp_dir()
        .join(format!("darklock-update-{}.bin", uuid::Uuid::new_v4()))
        .display()
        .to_string()
}

pub fn download_to_path(url: &str, output: &str) -> Result<std::path::PathBuf> {
    let out_path = std::path::PathBuf::from(output);
    let mut file = File::create(&out_path)?;
    if url.starts_with("file://") {
        let src = url.strip_prefix("file://").unwrap();
        let mut src_file = File::open(src)?;
        std::io::copy(&mut src_file, &mut file)?;
    } else {
        let resp = reqwest::blocking::get(url).map_err(|e| anyhow!("download failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(anyhow!("download status {}", resp.status()));
        }
        let mut body = resp;
        std::io::copy(&mut body, &mut file)?;
    }
    file.flush()?;
    Ok(out_path)
}

pub fn hash_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[allow(dead_code)]
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    let mut f = File::create(path)?;
    let data = serde_json::to_vec_pretty(value)?;
    f.write_all(&data)?;
    Ok(())
}

#[allow(dead_code)]
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let f = File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}
