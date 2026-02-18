//! Orchestrator engine — owns the state machine (Active / Maintenance / SafeMode)
//! and coordinates all subsystems.
//!
//! The orchestrator:
//!  * routes watcher TamperEvents → enforcement engine → event log
//!  * routes periodic scan results  → enforcement engine → event log
//!  * manages maintenance mode (with timeout)
//!  * manages baseline lifecycle (create, archive, rotate: keep last 10)
//!  * fires a daily anchor event every 24 h
//!  * publishes engine state changes over a broadcast channel

use anyhow::{anyhow, Result};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use ed25519_dalek::SigningKey;
use guard_core::backup_store::BackupStore;
use guard_core::event_log::{EventLog, EventSeverity};
use guard_core::settings::{GuardSettings, SecurityMode};
use guard_core::storage::{load_settings, save_settings};
use guard_core::vault::Vault;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch};
use tracing::{error, info, warn};

use crate::enforcement::restore::{RestoreEngine, RestoreOutcome};
use crate::integrity::pipeline::TamperEvent;
use crate::integrity::scanner::{Baseline, IntegrityScanner};

// ── Engine mode ─────────────────────────────────────────────────────────────

/// The three operational modes of the guard engine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode")]
pub enum EngineMode {
    Active,
    Maintenance {
        reason: String,
        entered_at: DateTime<Utc>,
        timeout_at: DateTime<Utc>,
        #[serde(skip)]
        queued_events: usize,
    },
    SafeMode,
}

impl Default for EngineMode {
    fn default() -> Self {
        Self::Active
    }
}

/// Broadcast message for engine state transitions.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum EngineEvent {
    ModeChanged(EngineMode),
    BaselineUpdated { entries: usize },
    RestoreAttempt { path: String, outcome: String },
    ScanCompleted { violations: usize },
}

// ── Settings validation (preserved) ─────────────────────────────────────────

fn validate_settings(settings: &GuardSettings) -> Result<()> {
    if let SecurityMode::Strict = settings.security_mode {
        if !settings.protection.realtime_enabled {
            anyhow::bail!("Realtime protection cannot be disabled in Strict mode");
        }
        if settings.privacy.telemetry_enabled {
            anyhow::bail!("Telemetry forbidden in Strict mode");
        }
    }
    if settings.performance.max_cpu_percent < 10 || settings.performance.max_cpu_percent > 80 {
        anyhow::bail!("Max CPU percent must be between 10 and 80");
    }
    if settings.performance.max_memory_mb < 128 {
        anyhow::bail!("Max memory must be at least 128 MB");
    }
    if settings.updates.channel != "stable" && settings.updates.channel != "beta" {
        anyhow::bail!("Update channel must be 'stable' or 'beta'");
    }
    Ok(())
}

// ── Baseline helpers ────────────────────────────────────────────────────────

const MAX_BASELINE_ARCHIVES: usize = 10;

fn baselines_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("baselines")
}

fn archive_baseline(data_dir: &Path, current_path: &Path) -> Result<()> {
    let dir = baselines_dir(data_dir);
    std::fs::create_dir_all(&dir)?;

    let ts = Utc::now().format("%Y%m%dT%H%M%S");
    let dest = dir.join(format!("baseline_{ts}.json"));
    std::fs::copy(current_path, &dest)?;
    info!(path = %dest.display(), "baseline archived");

    // Prune old archives (keep newest 10).
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().starts_with("baseline_"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort();
    while entries.len() > MAX_BASELINE_ARCHIVES {
        if let Some(oldest) = entries.first().cloned() {
            let _ = std::fs::remove_file(&oldest);
            entries.remove(0);
        }
    }
    Ok(())
}

// ── Engine ──────────────────────────────────────────────────────────────────

pub struct Engine {
    settings: Arc<RwLock<GuardSettings>>,
    mode: Arc<RwLock<EngineMode>>,
    queued_events: Arc<Mutex<VecDeque<TamperEvent>>>,
    event_tx: broadcast::Sender<EngineEvent>,
    last_daily_anchor: Arc<Mutex<DateTime<Utc>>>,
}

impl Engine {
    /// Load settings from the vault, start in Active mode.
    pub fn load_from_vault(vault: &Vault) -> Result<Self> {
        let settings = load_settings(vault)?;
        let (event_tx, _) = broadcast::channel(256);
        Ok(Self {
            settings: Arc::new(RwLock::new(settings)),
            mode: Arc::new(RwLock::new(EngineMode::Active)),
            queued_events: Arc::new(Mutex::new(VecDeque::new())),
            event_tx,
            last_daily_anchor: Arc::new(Mutex::new(Utc::now())),
        })
    }

    // ── Settings ────────────────────────────────────────────────────────

    pub fn settings(&self) -> GuardSettings {
        self.settings.read().clone()
    }

    pub fn update_settings(
        &self,
        vault: &mut Vault,
        new_settings: GuardSettings,
    ) -> Result<()> {
        validate_settings(&new_settings)?;
        save_settings(vault, &new_settings)?;
        *self.settings.write() = new_settings;
        Ok(())
    }

    // ── Mode queries ────────────────────────────────────────────────────

    pub fn mode(&self) -> EngineMode {
        self.mode.read().clone()
    }

    pub fn is_active(&self) -> bool {
        matches!(*self.mode.read(), EngineMode::Active)
    }

    pub fn is_maintenance(&self) -> bool {
        matches!(*self.mode.read(), EngineMode::Maintenance { .. })
    }

    #[allow(dead_code)]
    pub fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.event_tx.subscribe()
    }

    // ── Maintenance mode transitions ────────────────────────────────────

    pub fn enter_maintenance(
        &self,
        reason: String,
        timeout_secs: u64,
        event_log: &EventLog,
    ) -> Result<()> {
        if !self.is_active() {
            return Err(anyhow!("can only enter maintenance from Active mode"));
        }
        let now = Utc::now();
        let timeout_at = now + ChronoDuration::seconds(timeout_secs as i64);
        let mode = EngineMode::Maintenance {
            reason: reason.clone(),
            entered_at: now,
            timeout_at,
            queued_events: 0,
        };
        *self.mode.write() = mode.clone();
        self.queued_events.lock().clear();

        event_log.append(
            "MAINTENANCE_ENTER",
            EventSeverity::Info,
            serde_json::json!({
                "reason": reason,
                "timeout_secs": timeout_secs,
                "timeout_at": timeout_at.to_rfc3339(),
            }),
        )?;
        let _ = self.event_tx.send(EngineEvent::ModeChanged(mode));
        info!(reason = %reason, timeout_secs, "entered maintenance mode");
        Ok(())
    }

    pub fn exit_maintenance(
        &self,
        rebaseline: bool,
        scanner: Option<&IntegrityScanner>,
        signing_key: &SigningKey,
        baseline_path: &Path,
        backup_store: &mut BackupStore,
        event_log: &EventLog,
        data_dir: &Path,
    ) -> Result<Option<Baseline>> {
        if !self.is_maintenance() {
            return Err(anyhow!("not in maintenance mode"));
        }
        let drained = self.queued_events.lock().len();
        self.queued_events.lock().clear();

        let new_baseline = if rebaseline {
            if let Some(scanner) = scanner {
                // Archive current baseline before overwriting.
                if baseline_path.exists() {
                    archive_baseline(data_dir, baseline_path)?;
                }
                let baseline = scanner.generate_baseline(signing_key)?;
                IntegrityScanner::save_baseline(&baseline, baseline_path)?;

                // Update backup store for all files in new baseline.
                for (_key, entry) in &baseline.entries {
                    let p = PathBuf::from(&entry.path);
                    if p.exists() {
                        let perms = entry.permissions;
                        if let Err(e) =
                            backup_store.ensure_from_disk(&p, &entry.hash, perms, None)
                        {
                            warn!(path = %entry.path, error = %e, "backup update failed during rebaseline");
                        }
                    }
                }

                event_log.append(
                    "BASELINE_UPDATED",
                    EventSeverity::Info,
                    serde_json::json!({
                        "entries": baseline.entries.len(),
                        "drained_events": drained,
                    }),
                )?;
                let _ = self.event_tx.send(EngineEvent::BaselineUpdated {
                    entries: baseline.entries.len(),
                });
                Some(baseline)
            } else {
                None
            }
        } else {
            None
        };

        *self.mode.write() = EngineMode::Active;
        event_log.append(
            "MAINTENANCE_EXIT",
            EventSeverity::Info,
            serde_json::json!({
                "rebaselined": rebaseline,
                "drained_events": drained,
            }),
        )?;
        let _ = self
            .event_tx
            .send(EngineEvent::ModeChanged(EngineMode::Active));
        info!(rebaselined = rebaseline, drained = drained, "exited maintenance mode");
        Ok(new_baseline)
    }

    /// Force-exit maintenance after timeout — NO rebaseline.
    pub fn maintenance_timeout(&self, event_log: &EventLog) -> Result<()> {
        if !self.is_maintenance() {
            return Ok(());
        }
        self.queued_events.lock().clear();
        *self.mode.write() = EngineMode::Active;
        event_log.append(
            "MAINTENANCE_TIMEOUT",
            EventSeverity::Warn,
            serde_json::json!({}),
        )?;
        let _ = self
            .event_tx
            .send(EngineEvent::ModeChanged(EngineMode::Active));
        warn!("maintenance mode timed out – resuming enforcement without rebaseline");
        Ok(())
    }

    /// Enter safe mode.
    pub fn enter_safe_mode(&self) {
        *self.mode.write() = EngineMode::SafeMode;
        let _ = self
            .event_tx
            .send(EngineEvent::ModeChanged(EngineMode::SafeMode));
    }

    /// Exit safe mode → Active.
    pub fn exit_safe_mode(&self) {
        *self.mode.write() = EngineMode::Active;
        let _ = self
            .event_tx
            .send(EngineEvent::ModeChanged(EngineMode::Active));
    }

    // ── Event routing ───────────────────────────────────────────────────

    /// Process a `TamperEvent` from the watcher pipeline.
    /// In Active mode → enforce immediately.
    /// In Maintenance mode → queue (don't enforce).
    /// In SafeMode → drop.
    pub fn handle_tamper_event(
        &self,
        event: &TamperEvent,
        restore_engine: &RestoreEngine,
        backup_store: &BackupStore,
        baseline: &Baseline,
        event_log: &EventLog,
    ) {
        match *self.mode.read() {
            EngineMode::Active => {
                self.enforce_tamper(event, restore_engine, backup_store, baseline, event_log);
            }
            EngineMode::Maintenance { .. } => {
                self.queued_events.lock().push_back(event.clone());
            }
            EngineMode::SafeMode => {
                // Drop silently — safe mode means enforcement is paused.
            }
        }
    }

    /// Process scan results from the audit loop.
    pub fn handle_scan_result(
        &self,
        result: &crate::integrity::scanner::ScanResult,
        restore_engine: &RestoreEngine,
        backup_store: &BackupStore,
        baseline: &Baseline,
        event_log: &EventLog,
    ) {
        if !self.is_active() {
            return;
        }

        let violations = result.modified.len() + result.removed.len();
        if violations > 0 {
            // Log scan event
            let _ = event_log.append(
                "INTEGRITY_VIOLATION",
                EventSeverity::Critical,
                serde_json::json!({
                    "source": "audit_loop",
                    "modified": result.modified.len(),
                    "removed": result.removed.len(),
                    "added": result.added.len(),
                }),
            );

            // Enforce each violation
            for mf in &result.modified {
                let path = PathBuf::from(&mf.path);
                if let Some(entry) = baseline.entries.get(&mf.path) {
                    let outcome = restore_engine.restore_file(&path, entry, backup_store);
                    self.log_restore(&mf.path, &outcome, event_log);
                }
            }
            for removed_path in &result.removed {
                if let Some(entry) = baseline.entries.get(removed_path) {
                    let path = PathBuf::from(removed_path);
                    let outcome = restore_engine.restore_file(&path, entry, backup_store);
                    self.log_restore(removed_path, &outcome, event_log);
                }
            }
        }

        let _ = self
            .event_tx
            .send(EngineEvent::ScanCompleted { violations });
    }

    /// Check if daily anchor is due and fire it.
    pub fn maybe_daily_anchor(&self, event_log: &EventLog, data_dir: &Path) {
        let now = Utc::now();
        let mut last = self.last_daily_anchor.lock();
        if now.signed_duration_since(*last) >= ChronoDuration::hours(24) {
            let anchor_path = data_dir.join("daily_anchor.json");
            match event_log.anchor_daily(&anchor_path) {
                Ok(anchor) => {
                    let _ = event_log.append(
                        "DAILY_ANCHOR",
                        EventSeverity::Info,
                        serde_json::json!({
                            "date": anchor.date,
                            "hash": anchor.hash,
                        }),
                    );
                    *last = now;
                    info!(date = %anchor.date, "daily anchor written");
                }
                Err(e) => {
                    error!(error = %e, "failed to write daily anchor");
                }
            }
        }
    }

    /// Check if maintenance has timed out.
    pub fn check_maintenance_timeout(&self, event_log: &EventLog) {
        if let EngineMode::Maintenance { timeout_at, .. } = &*self.mode.read() {
            if Utc::now() >= *timeout_at {
                let _ = self.maintenance_timeout(event_log);
            }
        }
    }

    // ── Private enforcement ─────────────────────────────────────────────

    fn enforce_tamper(
        &self,
        event: &TamperEvent,
        restore_engine: &RestoreEngine,
        backup_store: &BackupStore,
        baseline: &Baseline,
        event_log: &EventLog,
    ) {
        match event {
            TamperEvent::Modified {
                path,
                expected_hash,
                actual_hash,
            } => {
                let _ = event_log.append(
                    "TAMPER_DETECTED",
                    EventSeverity::Critical,
                    serde_json::json!({
                        "path": path.display().to_string(),
                        "kind": "modified",
                        "expected_hash": expected_hash,
                        "actual_hash": actual_hash,
                    }),
                );
                let key = path.display().to_string();
                if let Some(entry) = baseline.entries.get(&key) {
                    let outcome = restore_engine.restore_file(path, entry, backup_store);
                    self.log_restore(&key, &outcome, event_log);
                }
            }
            TamperEvent::Deleted {
                path,
                expected_hash,
            } => {
                let _ = event_log.append(
                    "TAMPER_DETECTED",
                    EventSeverity::Critical,
                    serde_json::json!({
                        "path": path.display().to_string(),
                        "kind": "deleted",
                        "expected_hash": expected_hash,
                    }),
                );
                let key = path.display().to_string();
                if let Some(entry) = baseline.entries.get(&key) {
                    let outcome = restore_engine.restore_file(path, entry, backup_store);
                    self.log_restore(&key, &outcome, event_log);
                }
            }
            TamperEvent::PermissionChanged {
                path,
                expected_perms,
                actual_perms,
            } => {
                let _ = event_log.append(
                    "TAMPER_DETECTED",
                    EventSeverity::Warn,
                    serde_json::json!({
                        "path": path.display().to_string(),
                        "kind": "permission_changed",
                        "expected": expected_perms,
                        "actual": actual_perms,
                    }),
                );
                // Restore permissions directly
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Err(e) = std::fs::set_permissions(
                        path,
                        std::fs::Permissions::from_mode(*expected_perms),
                    ) {
                        error!(path = %path.display(), error = %e, "failed to restore permissions");
                    } else {
                        let _ = event_log.append(
                            "PERMISSIONS_RESTORED",
                            EventSeverity::Warn,
                            serde_json::json!({
                                "path": path.display().to_string(),
                                "restored_perms": expected_perms,
                            }),
                        );
                    }
                }
            }
            TamperEvent::Renamed { from, to } => {
                let _ = event_log.append(
                    "TAMPER_DETECTED",
                    EventSeverity::Critical,
                    serde_json::json!({
                        "path": from.display().to_string(),
                        "kind": "renamed",
                        "new_path": to.display().to_string(),
                    }),
                );
                // Try to reverse the rename.
                if to.exists() && !from.exists() {
                    if std::fs::rename(to, from).is_ok() {
                        let _ = event_log.append(
                            "RENAME_REVERSED",
                            EventSeverity::Warn,
                            serde_json::json!({
                                "from": to.display().to_string(),
                                "to": from.display().to_string(),
                            }),
                        );
                    } else {
                        // Fall back to restoring from backup.
                        let key = from.display().to_string();
                        if let Some(entry) = baseline.entries.get(&key) {
                            let outcome = restore_engine.restore_file(from, entry, backup_store);
                            self.log_restore(&key, &outcome, event_log);
                        }
                    }
                }
            }
            TamperEvent::UnauthorizedFile {
                path,
                file_hash,
                file_size,
                suspicious_reasons,
            } => {
                let is_suspicious = !suspicious_reasons.is_empty();
                let severity = if is_suspicious {
                    EventSeverity::Critical
                } else {
                    EventSeverity::Warn
                };
                
                let _ = event_log.append(
                    "UNAUTHORIZED_FILE",
                    severity,
                    serde_json::json!({
                        "path": path.display().to_string(),
                        "kind": "unauthorized_new_file",
                        "file_hash": file_hash,
                        "file_size": file_size,
                        "suspicious": is_suspicious,
                        "reasons": suspicious_reasons,
                    }),
                );
                
                // Quarantine suspicious files automatically
                if is_suspicious && path.exists() {
                    let quarantine_dir = backup_store.root().join("../quarantine");
                    let _ = std::fs::create_dir_all(&quarantine_dir);
                    
                    let quarantine_name = format!(
                        "{}_{}",
                        chrono::Utc::now().format("%Y%m%d_%H%M%S"),
                        path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "unknown".to_string())
                    );
                    let quarantine_path = quarantine_dir.join(&quarantine_name);
                    
                    match std::fs::rename(path, &quarantine_path) {
                        Ok(_) => {
                            let _ = event_log.append(
                                "FILE_QUARANTINED",
                                EventSeverity::Warn,
                                serde_json::json!({
                                    "original_path": path.display().to_string(),
                                    "quarantine_path": quarantine_path.display().to_string(),
                                    "reasons": suspicious_reasons,
                                }),
                            );
                            info!(
                                path = %path.display(),
                                quarantine = %quarantine_path.display(),
                                "suspicious file quarantined"
                            );
                        }
                        Err(e) => {
                            // Try delete as fallback
                            if std::fs::remove_file(path).is_ok() {
                                let _ = event_log.append(
                                    "FILE_REMOVED",
                                    EventSeverity::Warn,
                                    serde_json::json!({
                                        "path": path.display().to_string(),
                                        "reason": "quarantine failed, file removed",
                                        "error": e.to_string(),
                                    }),
                                );
                            } else {
                                let _ = event_log.append(
                                    "QUARANTINE_FAILED",
                                    EventSeverity::Critical,
                                    serde_json::json!({
                                        "path": path.display().to_string(),
                                        "error": e.to_string(),
                                    }),
                                );
                            }
                        }
                    }
                } else if !is_suspicious {
                    // Non-suspicious unauthorized file — just log warning, don't quarantine
                    info!(
                        path = %path.display(),
                        "non-suspicious unauthorized file detected (not quarantined)"
                    );
                }
            }
        }
    }

    fn log_restore(&self, path: &str, outcome: &RestoreOutcome, event_log: &EventLog) {
        match outcome {
            RestoreOutcome::Restored => {
                let _ = event_log.append(
                    "RESTORE_SUCCESS",
                    EventSeverity::Warn,
                    serde_json::json!({"path": path}),
                );
                let _ = self.event_tx.send(EngineEvent::RestoreAttempt {
                    path: path.to_string(),
                    outcome: "restored".into(),
                });
            }
            RestoreOutcome::AlreadyRestoring => {
                // silently skip
            }
            RestoreOutcome::BackupCorrupted { path: p } => {
                let _ = event_log.append(
                    "BACKUP_STORE_CORRUPTION",
                    EventSeverity::Critical,
                    serde_json::json!({"path": p}),
                );
            }
            RestoreOutcome::Quarantined { quarantine_path } => {
                let _ = event_log.append(
                    "RESTORE_FAILURE",
                    EventSeverity::Critical,
                    serde_json::json!({
                        "path": path,
                        "quarantined": quarantine_path.as_ref().map(|p| p.display().to_string()),
                    }),
                );
            }
            RestoreOutcome::Failed { error } => {
                let _ = event_log.append(
                    "RESTORE_FAILURE",
                    EventSeverity::Critical,
                    serde_json::json!({"path": path, "error": error}),
                );
            }
        }
    }
}

// ── Maintenance timeout watcher task ────────────────────────────────────────

/// Spawns a tokio task that checks for maintenance timeout every 15 s.
pub fn spawn_maintenance_watcher(
    engine: Arc<Engine>,
    event_log: Arc<EventLog>,
    mut shutdown: watch::Receiver<bool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(15)) => {
                    engine.check_maintenance_timeout(&event_log);
                }
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { return; }
                }
            }
        }
    })
}

/// Spawns a tokio task that fires the daily anchor check every hour.
pub fn spawn_daily_anchor(
    engine: Arc<Engine>,
    event_log: Arc<EventLog>,
    data_dir: PathBuf,
    mut shutdown: watch::Receiver<bool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(3600)) => {
                    engine.maybe_daily_anchor(&event_log, &data_dir);
                }
                _ = shutdown.changed() => {
                    if *shutdown.borrow() { return; }
                }
            }
        }
    })
}
