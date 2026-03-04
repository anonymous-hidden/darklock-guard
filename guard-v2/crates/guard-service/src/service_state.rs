use chrono::{DateTime, Utc};
use ed25519_dalek::SigningKey;
use guard_core::backup_store::BackupStore;
use guard_core::device_state::RemoteActivityStatus;
use guard_core::event_log::EventLog;
use guard_core::safe_mode::SafeModeState;
use guard_core::vault::Vault;
use parking_lot::Mutex as ParkMutex;
use std::path::PathBuf;
use std::sync::Arc;
use zeroize::Zeroizing;

use crate::enforcement::restore::RestoreEngine;
use crate::engine::Engine;
use crate::integrity::audit_loop::AuditLoopHandle;
use crate::integrity::scanner::IntegrityScanner;

// All fields are accessed through `Arc<Mutex<ServiceState>>` in the IPC handler
// and connected module. The dead_code lint cannot see through the Mutex.
#[allow(dead_code)]
pub(crate) struct ServiceState {
    pub(crate) vault_path: PathBuf,
    pub(crate) vault: Vault,
    pub(crate) engine: Arc<Engine>,
    pub(crate) event_log: Arc<EventLog>,
    pub(crate) safe_mode: SafeModeState,
    pub(crate) password: Zeroizing<String>,
    pub(crate) connected: bool,
    pub(crate) last_heartbeat: Option<DateTime<Utc>>,
    pub(crate) last_remote_command: Option<RemoteCommandRecord>,
    pub(crate) update_available: bool,
    pub(crate) _crash_tracker: CrashTracker,
    pub(crate) scanner: Option<IntegrityScanner>,
    pub(crate) signing_key: SigningKey,
    pub(crate) baseline_path: PathBuf,
    pub(crate) data_dir: PathBuf,
    pub(crate) backup_store: Arc<ParkMutex<BackupStore>>,
    pub(crate) restore_engine: Arc<RestoreEngine>,
    pub(crate) audit_loop_handle: Option<AuditLoopHandle>,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct RemoteCommandRecord {
    pub command: String,
    pub timestamp: DateTime<Utc>,
    pub status: RemoteActivityStatus,
}

#[allow(dead_code)]
pub(crate) struct CrashTracker {
    path: PathBuf,
}

#[allow(dead_code)]
impl CrashTracker {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn record_start(&self) -> anyhow::Result<usize> {
        let mut entries: Vec<DateTime<Utc>> = if self.path.exists() {
            let data = std::fs::read_to_string(&self.path)?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            vec![]
        };
        let now = Utc::now();
        let window = chrono::Duration::minutes(5);
        entries.retain(|t| *t > now - window);
        entries.push(now);
        let count = entries.len();
        let data = serde_json::to_string(&entries)?;
        std::fs::write(&self.path, data)?;
        Ok(count)
    }
}
