//! Security check — collects risk signals before allowing session decryption.
//!
//! This runs on every launch *after* successful authentication.
//! A risk score is computed; if high, the user must re-enter their password
//! and optionally enter High-Security Mode.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecurityMode {
    Normal,
    /// Message padding + batching + reduced metadata
    Privacy,
    /// Require password re-entry, block clipboard export, disable history export, padding
    HighSecurity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskSignal {
    pub name: String,
    pub severity: RiskLevel,
    pub description: String,
    pub score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityCheckResult {
    pub passed: bool,
    pub total_score: u32,
    pub risk_level: RiskLevel,
    pub recommended_mode: SecurityMode,
    pub signals: Vec<RiskSignal>,
    pub require_reauth: bool,
}

/// Run all available security checks and return a result.
pub fn run_security_check() -> SecurityCheckResult {
    let mut signals = Vec::new();
    let mut total_score = 0u32;

    // ── Check 1: Debug / developer mode ─────────────────────────────────────
    #[cfg(debug_assertions)]
    {
        let s = RiskSignal {
            name: "debug_build".into(),
            severity: RiskLevel::Medium,
            description: "Application is running as a debug build".into(),
            score: 20,
        };
        total_score += s.score;
        signals.push(s);
    }

    // ── Check 2: Writable install directory ─────────────────────────────────
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if is_world_writable(dir) {
                let s = RiskSignal {
                    name: "writable_install_dir".into(),
                    severity: RiskLevel::High,
                    description: "Install directory is world-writable — possible binary hijack".into(),
                    score: 40,
                };
                total_score += s.score;
                signals.push(s);
            }
        }
    }

    // ── Check 3: System time consistency ────────────────────────────────────
    // Detect large skew between system time and external reference.
    // In v1 we only check if the system time is very far in the past (rollback).
    let now = chrono::Utc::now();
    if now.timestamp() < 1_700_000_000 {
        let s = RiskSignal {
            name: "time_rollback".into(),
            severity: RiskLevel::High,
            description: "System time appears to be rolled back — key expiry bypass risk".into(),
            score: 50,
        };
        total_score += s.score;
        signals.push(s);
    }

    // ── Check 4: Environment variables that suggest debugging ────────────────
    for var in &["DYLD_INSERT_LIBRARIES", "LD_PRELOAD", "FRIDA_SESSION_ID"] {
        if std::env::var(var).is_ok() {
            let s = RiskSignal {
                name: format!("env_{}", var.to_lowercase()),
                severity: RiskLevel::Critical,
                description: format!("Suspicious env var detected: {var}"),
                score: 80,
            };
            total_score += s.score;
            signals.push(s);
        }
    }

    // ── Check 5: Running as root / SYSTEM ────────────────────────────────────
    #[cfg(unix)]
    if unsafe { libc::getuid() } == 0 {
        let s = RiskSignal {
            name: "running_as_root".into(),
            severity: RiskLevel::High,
            description: "Application is running as root — elevated privilege risk".into(),
            score: 35,
        };
        total_score += s.score;
        signals.push(s);
    }

    // ── Check 6: Suspicious processes (best-effort, Linux) ───────────────────
    #[cfg(target_os = "linux")]
    {
        let suspicious = ["gdb", "lldb", "strace", "ltrace", "radare2", "x64dbg", "frida"];
        if let Ok(proc_entries) = std::fs::read_dir("/proc") {
            for entry in proc_entries.flatten() {
                if let Ok(comm_path) = entry.path().join("comm").canonicalize() {
                    if let Ok(comm) = std::fs::read_to_string(comm_path) {
                        let comm = comm.trim();
                        if suspicious.iter().any(|s| comm.contains(s)) {
                            let sig = RiskSignal {
                                name: format!("suspicious_process_{comm}"),
                                severity: RiskLevel::Critical,
                                description: format!("Suspicious process detected: {comm}"),
                                score: 70,
                            };
                            total_score += sig.score;
                            signals.push(sig);
                            break; // one is enough to warn
                        }
                    }
                }
            }
        }
    }

    // ── Compute risk level and recommended mode ───────────────────────────────
    let (risk_level, recommended_mode, require_reauth) = if total_score >= 80 {
        (RiskLevel::Critical, SecurityMode::HighSecurity, true)
    } else if total_score >= 50 {
        (RiskLevel::High, SecurityMode::HighSecurity, true)
    } else if total_score >= 20 {
        (RiskLevel::Medium, SecurityMode::Privacy, false)
    } else {
        (RiskLevel::Low, SecurityMode::Normal, false)
    };

    SecurityCheckResult {
        passed: total_score < 80,
        total_score,
        risk_level,
        recommended_mode,
        signals,
        require_reauth,
    }
}

fn is_world_writable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.mode() & 0o002 != 0;
        }
    }
    false
}
