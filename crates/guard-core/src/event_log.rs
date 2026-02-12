use crate::crypto::sign_bytes;
use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::SigningKey;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

const MAX_ROTATIONS: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventSeverity {
    Info,
    Warn,
    Error,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEntry {
    pub seq: u64,
    pub timestamp: DateTime<Utc>,
    pub event_type: String,
    pub severity: EventSeverity,
    pub data: serde_json::Value,
    pub prev_hash: String,
    pub hash: String,
    pub signature: String,
}

pub struct EventLog {
    path: PathBuf,
    signer: SigningKey,
    inner: Mutex<LogState>,
    max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogAnchor {
    pub date: String,
    pub hash: String,
}

#[derive(Debug)]
struct LogState {
    last_seq: u64,
    last_hash: String,
}

impl EventLog {
    pub fn new<P: AsRef<Path>>(path: P, signer: SigningKey, max_bytes: u64) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let (last_seq, last_hash) = Self::load_state(&path)?;
        Ok(Self {
            path,
            signer,
            inner: Mutex::new(LogState {
                last_seq,
                last_hash,
            }),
            max_bytes,
        })
    }

    fn load_state(path: &Path) -> Result<(u64, String)> {
        if !path.exists() {
            return Ok((0, "CHAIN_START".to_string()));
        }
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let mut last_seq = 0;
        let mut last_hash = "CHAIN_START".to_string();
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let entry: EventEntry = serde_json::from_str(&line)?;
            last_seq = entry.seq;
            last_hash = entry.hash;
        }
        Ok((last_seq, last_hash))
    }

    fn compute_hash(entry_without_sig: &serde_json::Value) -> Result<String> {
        let mut hasher = Sha256::new();
        hasher.update(entry_without_sig.to_string().as_bytes());
        Ok(hex::encode(hasher.finalize()))
    }

    pub fn append(
        &self,
        event_type: &str,
        severity: EventSeverity,
        data: serde_json::Value,
    ) -> Result<EventEntry> {
        self.rotate_if_needed()?;
        let mut state = self.inner.lock();
        let seq = state.last_seq + 1;
        let prev_hash = state.last_hash.clone();
        let mut entry_value = serde_json::json!({
            "seq": seq,
            "timestamp": Utc::now(),
            "event_type": event_type,
            "severity": severity,
            "data": data,
            "prev_hash": prev_hash,
        });
        let hash = Self::compute_hash(&entry_value)?;
        entry_value["hash"] = serde_json::Value::String(hash.clone());
        let sig = sign_bytes(&self.signer, entry_value.to_string().as_bytes());
        let signature = general_purpose::STANDARD.encode(sig.to_bytes());
        entry_value["signature"] = serde_json::Value::String(signature.clone());

        let entry: EventEntry = serde_json::from_value(entry_value.clone())?;
        self.write_entry(&entry)?;
        state.last_seq = seq;
        state.last_hash = hash;
        Ok(entry)
    }

    fn write_entry(&self, entry: &EventEntry) -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let line = serde_json::to_string(entry)?;
        writeln!(file, "{}", line)?;
        file.flush()?;
        Ok(())
    }

    fn rotate_if_needed(&self) -> Result<()> {
        let mut state = self.inner.lock();
        if let Ok(metadata) = fs::metadata(&self.path) {
            if metadata.len() < self.max_bytes {
                drop(state);
                return Ok(());
            }
        }
        // rotate existing files
        for i in (1..=MAX_ROTATIONS).rev() {
            let rotated = self.path_with_suffix(i);
            if rotated.exists() {
                if i == MAX_ROTATIONS {
                    fs::remove_file(&rotated)?;
                } else {
                    let next = self.path_with_suffix(i + 1);
                    fs::rename(&rotated, next)?;
                }
            }
        }
        if self.path.exists() {
            fs::rename(&self.path, self.path_with_suffix(1))?;
        }
        // reset chain on new file
        state.last_hash = "CHAIN_START".to_string();
        // keep sequence monotonic across rotations
        Ok(())
    }

    pub fn anchor_daily<P: AsRef<Path>>(&self, anchor_path: P) -> Result<LogAnchor> {
        let date = chrono::Utc::now().date_naive().to_string();
        let mut hasher = Sha256::new();
        if self.path.exists() {
            let file = File::open(&self.path)?;
            let mut reader = BufReader::new(file);
            let mut buf = String::new();
            while reader.read_line(&mut buf)? != 0 {
                hasher.update(buf.as_bytes());
                buf.clear();
            }
        }
        let hash = hex::encode(hasher.finalize());
        let anchor = LogAnchor { date, hash };
        let anchor_json = serde_json::to_string_pretty(&anchor)?;
        fs::write(anchor_path, anchor_json)?;
        Ok(anchor)
    }

    /// Read recent events, optionally filtering by `since` timestamp and limiting count.
    pub fn read_recent(
        &self,
        since: Option<DateTime<Utc>>,
        limit: Option<usize>,
    ) -> Result<Vec<EventEntry>> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let file = File::open(&self.path)?;
        let reader = BufReader::new(file);
        let mut entries = Vec::new();
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let entry: EventEntry = serde_json::from_str(&line)?;
            if let Some(since_ts) = &since {
                if entry.timestamp < *since_ts {
                    continue;
                }
            }
            entries.push(entry);
        }
        // Return most recent first
        entries.reverse();
        if let Some(lim) = limit {
            entries.truncate(lim);
        }
        Ok(entries)
    }

    fn path_with_suffix(&self, index: usize) -> PathBuf {
        let mut p = self.path.clone();
        let filename = p.file_name().unwrap().to_string_lossy().to_string();
        let rotated = format!("{}.{}", filename, index);
        p.set_file_name(rotated);
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_event_log_chain_and_rotation() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("events.log");
        let signer = SigningKey::generate(&mut rand::rngs::OsRng);
        let log = EventLog::new(path.clone(), signer, 512).unwrap();
        for i in 0..50 {
            let e = log
                .append("TEST", EventSeverity::Info, serde_json::json!({"i": i}))
                .unwrap();
            assert!(e.hash.len() > 0);
            assert_eq!(e.seq as usize, i + 1);
        }
        // after many writes rotation should have happened at least once
        let rotated = path.with_file_name("events.log.1");
        assert!(rotated.exists());
    }

    #[test]
    fn anchor_file_written() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("events.log");
        let signer = SigningKey::generate(&mut rand::rngs::OsRng);
        let log = EventLog::new(path.clone(), signer, 4096).unwrap();
        log.append("TEST", EventSeverity::Info, serde_json::json!({"x":1}))
            .unwrap();
        let anchor_path = dir.path().join("anchor.json");
        let anchor = log.anchor_daily(&anchor_path).unwrap();
        assert!(anchor_path.exists());
        assert!(!anchor.hash.is_empty());
    }
}
