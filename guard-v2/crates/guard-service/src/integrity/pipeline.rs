//! Debounced watcher pipeline.
//!
//! Receives raw `FileChange` events from the `FileWatcher` broadcast channel,
//! deduplicates them over a 100ms window, then emits `TamperEvent`s after
//! verifying each changed file against the baseline.
//!
//! **Advanced detection**:
//! - Modified/deleted files checked against BLAKE3 baseline
//! - Unauthorized new files detected (not in baseline)
//! - Suspicious file extensions flagged (.php, .sh, .exe, etc.)
//! - High-entropy files flagged (potential encrypted/packed payloads)
//! - Permission changes detected and reversed
//!
//! **Restore-loop suppression**: Events for paths currently in the
//! `RestoreEngine::restoring` set are silently discarded.

use crate::integrity::scanner::Baseline;
use crate::integrity::watcher::FileChange;
use blake3::Hasher;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tracing::{debug, trace, warn, info};

// ── TamperEvent ─────────────────────────────────────────────────────────────

/// A verified integrity violation ready for enforcement.
#[derive(Debug, Clone)]
pub enum TamperEvent {
    Modified {
        path: PathBuf,
        expected_hash: String,
        actual_hash: String,
    },
    Deleted {
        path: PathBuf,
        expected_hash: String,
    },
    PermissionChanged {
        path: PathBuf,
        expected_perms: u32,
        actual_perms: u32,
    },
    Renamed {
        from: PathBuf,
        to: PathBuf,
    },
    /// New: unauthorized file not in baseline
    UnauthorizedFile {
        path: PathBuf,
        file_hash: String,
        file_size: u64,
        suspicious_reasons: Vec<String>,
    },
}

// ── Suspicious file detection ───────────────────────────────────────────────

/// File extensions that are potentially dangerous
const SUSPICIOUS_EXTENSIONS: &[&str] = &[
    "php", "sh", "bash", "exe", "bat", "cmd", "ps1", "vbs", "js",
    "py", "pl", "rb", "cgi", "asp", "aspx", "jsp", "war",
    "dll", "so", "dylib", "elf", "bin", "msi", "scr", "com",
    "pif", "hta", "wsf", "wsh", "reg", "inf", "lnk",
    "jar", "class", "dex", "apk",
];

/// File names that are suspicious regardless of extension
const SUSPICIOUS_NAMES: &[&str] = &[
    "backdoor", "shell", "payload", "exploit", "rootkit", "keylogger",
    "malware", "trojan", "reverse", "webshell", "c99", "r57",
    ".htaccess", ".env", "wp-login", "eval", "base64_decode",
];

/// Calculate Shannon entropy of file data (0.0 = uniform, 8.0 = max random)
fn calculate_entropy(data: &[u8]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    let mut counts = [0u64; 256];
    for &byte in data {
        counts[byte as usize] += 1;
    }
    let len = data.len() as f64;
    let mut entropy = 0.0;
    for &count in &counts {
        if count > 0 {
            let p = count as f64 / len;
            entropy -= p * p.log2();
        }
    }
    entropy
}

/// Check if a file has suspicious characteristics
fn analyze_file_suspicion(path: &Path, data: &[u8]) -> Vec<String> {
    let mut reasons = Vec::new();
    
    // Check extension
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext_lower = ext.to_lowercase();
        if SUSPICIOUS_EXTENSIONS.contains(&ext_lower.as_str()) {
            reasons.push(format!("Suspicious extension: .{}", ext_lower));
        }
    }
    
    // Check filename
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        let name_lower = name.to_lowercase();
        for &suspicious in SUSPICIOUS_NAMES {
            if name_lower.contains(suspicious) {
                reasons.push(format!("Suspicious filename pattern: {}", suspicious));
                break;
            }
        }
        
        // Hidden files (starting with dot, common in attacks)
        if name.starts_with('.') && name != ".gitignore" && name != ".gitkeep" {
            reasons.push("Hidden file".to_string());
        }
    }
    
    // Check entropy (high entropy = possible encrypted/packed payload)
    let sample_size = data.len().min(65536); // Analyze first 64KB
    let entropy = calculate_entropy(&data[..sample_size]);
    if entropy > 7.5 && data.len() > 1024 {
        reasons.push(format!("High entropy: {:.2} (possible encrypted/packed content)", entropy));
    }
    
    // Check for script signatures / magic bytes in content
    if data.len() >= 2 {
        // Shebang
        if data.starts_with(b"#!") {
            reasons.push("Contains shebang (executable script)".to_string());
        }
        // PHP opening tag
        if data.starts_with(b"<?php") || data.starts_with(b"<?=") {
            reasons.push("PHP script detected".to_string());
        }
        // ELF binary
        if data.starts_with(b"\x7fELF") {
            reasons.push("ELF binary detected".to_string());
        }
        // PE/Windows executable
        if data.starts_with(b"MZ") {
            reasons.push("Windows executable (PE) detected".to_string());
        }
        // Check for common webshell patterns
        let content_str = String::from_utf8_lossy(&data[..data.len().min(4096)]);
        if content_str.contains("eval(") || content_str.contains("base64_decode") ||
           content_str.contains("system(") || content_str.contains("exec(") ||
           content_str.contains("passthru(") || content_str.contains("shell_exec") {
            reasons.push("Contains dangerous function calls".to_string());
        }
    }
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(path) {
            let mode = meta.permissions().mode();
            // Executable bit set
            if mode & 0o111 != 0 {
                reasons.push(format!("Executable permissions: {:o}", mode & 0o777));
            }
            // World-writable
            if mode & 0o002 != 0 {
                reasons.push("World-writable file".to_string());
            }
        }
    }
    
    reasons
}

// ── spawn_watcher_pipeline ──────────────────────────────────────────────────

/// Spawn the debounced watcher pipeline.  Returns a `JoinHandle` and a
/// `broadcast::Receiver<TamperEvent>` the orchestrator subscribes to.
pub fn spawn_watcher_pipeline(
    mut raw_rx: broadcast::Receiver<FileChange>,
    baseline_fn: Arc<dyn Fn() -> Option<Baseline> + Send + Sync>,
    restoring: Arc<parking_lot::Mutex<std::collections::HashSet<PathBuf>>>,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> (
    tokio::task::JoinHandle<()>,
    broadcast::Sender<TamperEvent>,
) {
    let (tamper_tx, _) = broadcast::channel::<TamperEvent>(512);
    let tx = tamper_tx.clone();
    let mut shutdown = shutdown;

    let handle = tokio::spawn(async move {
        let debounce_window = Duration::from_millis(100);
        let mut pending: HashMap<PathBuf, (FileChange, Instant)> = HashMap::new();

        loop {
            tokio::select! {
                result = raw_rx.recv() => {
                    match result {
                        Ok(change) => {
                            let path = change_path(&change);
                            pending.insert(path, (change, Instant::now()));
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!(missed = n, "watcher pipeline lagged; audit loop will catch up");
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            debug!("watcher channel closed, pipeline exiting");
                            return;
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    // Flush debounce window
                }
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { return; }
                }
            }

            // Process entries whose debounce window has elapsed.
            let now = Instant::now();
            let ready: Vec<(PathBuf, FileChange)> = pending
                .iter()
                .filter(|(_, (_, ts))| now.duration_since(*ts) >= debounce_window)
                .map(|(p, (c, _))| (p.clone(), c.clone()))
                .collect();

            for (path, change) in ready {
                pending.remove(&path);

                // Restore-loop suppression
                if restoring.lock().contains(&path) {
                    trace!(path = %path.display(), "suppressed event – path being restored");
                    continue;
                }

                let baseline = match (baseline_fn)() {
                    Some(b) => b,
                    None => continue,
                };

                if let Some(event) = classify_change(&change, &baseline) {
                    let _ = tx.send(event);
                }
            }
        }
    });

    (handle, tamper_tx)
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn change_path(change: &FileChange) -> PathBuf {
    match change {
        FileChange::Modified(p)
        | FileChange::Created(p)
        | FileChange::Removed(p)
        | FileChange::PermissionChanged(p) => p.clone(),
        FileChange::Renamed { from, .. } => from.clone(),
    }
}

fn classify_change(change: &FileChange, baseline: &Baseline) -> Option<TamperEvent> {
    match change {
        FileChange::Modified(path) | FileChange::Created(path) => {
            // Skip directories
            if path.is_dir() {
                return None;
            }
            
            let canonical = path.canonicalize().ok().unwrap_or_else(|| path.clone());
            let key = canonical.display().to_string();
            
            // Check if file is in baseline
            if let Some(entry) = baseline.entries.get(&key) {
                // Known file — check for modification
                match hash_file_quick(&canonical) {
                    Ok(actual_hash) => {
                        if actual_hash != entry.hash {
                            Some(TamperEvent::Modified {
                                path: canonical,
                                expected_hash: entry.hash.clone(),
                                actual_hash,
                            })
                        } else {
                            None // Content matches baseline — no violation
                        }
                    }
                    Err(e) => {
                        warn!(path = %canonical.display(), error = %e, "cannot hash file during classify");
                        None
                    }
                }
            } else {
                // NEW FILE — not in baseline! This is an unauthorized file.
                // Read file data for analysis
                match fs::read(&canonical) {
                    Ok(data) => {
                        let suspicious_reasons = analyze_file_suspicion(&canonical, &data);
                        let file_hash = {
                            let mut hasher = Hasher::new();
                            hasher.update(&data);
                            hasher.finalize().to_hex().to_string()
                        };
                        let file_size = data.len() as u64;
                        
                        info!(
                            path = %canonical.display(),
                            size = file_size,
                            reasons = ?suspicious_reasons,
                            "unauthorized file detected in protected directory"
                        );
                        
                        Some(TamperEvent::UnauthorizedFile {
                            path: canonical,
                            file_hash,
                            file_size,
                            suspicious_reasons,
                        })
                    }
                    Err(e) => {
                        warn!(path = %canonical.display(), error = %e, "cannot read unauthorized file");
                        // Still report it even if we can't read it
                        Some(TamperEvent::UnauthorizedFile {
                            path: canonical,
                            file_hash: "unreadable".to_string(),
                            file_size: 0,
                            suspicious_reasons: vec!["Could not read file for analysis".to_string()],
                        })
                    }
                }
            }
        }
        FileChange::Removed(path) => {
            let key = path.display().to_string();
            // Also try canonical form if path itself is in baseline
            let entry = baseline.entries.get(&key).or_else(|| {
                // Path is gone so we can't canonicalize; try as-is
                baseline.entries.get(&key)
            })?;
            Some(TamperEvent::Deleted {
                path: path.clone(),
                expected_hash: entry.hash.clone(),
            })
        }
        FileChange::PermissionChanged(path) => {
            let canonical = path.canonicalize().ok()?;
            let key = canonical.display().to_string();
            let entry = baseline.entries.get(&key)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = fs::metadata(&canonical) {
                    let actual = meta.permissions().mode();
                    if actual != entry.permissions {
                        return Some(TamperEvent::PermissionChanged {
                            path: canonical,
                            expected_perms: entry.permissions,
                            actual_perms: actual,
                        });
                    }
                }
            }
            None
        }
        FileChange::Renamed { from, to } => {
            let from_key = from.display().to_string();
            if baseline.entries.contains_key(&from_key) {
                Some(TamperEvent::Renamed {
                    from: from.clone(),
                    to: to.clone(),
                })
            } else {
                None
            }
        }
    }
}

fn hash_file_quick(path: &Path) -> anyhow::Result<String> {
    let mut f = fs::File::open(path)?;
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
