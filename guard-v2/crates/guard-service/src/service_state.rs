use chrono::{DateTime, Utc};
use guard_core::device_state::RemoteActivityStatus;
use guard_core::event_log::EventLog;
use guard_core::safe_mode::SafeModeState;
use guard_core::vault::Vault;
use std::path::PathBuf;
use zeroize::Zeroizing;

use crate::engine::Engine;

pub(crate) struct ServiceState {
    pub(crate) vault_path: PathBuf,
    pub(crate) vault: Vault,
    pub(crate) engine: Engine,
    pub(crate) event_log: EventLog,
    pub(crate) safe_mode: SafeModeState,
    pub(crate) password: Zeroizing<String>,
    pub(crate) connected: bool,
    pub(crate) last_heartbeat: Option<DateTime<Utc>>,
    pub(crate) last_remote_command: Option<RemoteCommandRecord>,
    pub(crate) update_available: bool,
    pub(crate) _crash_tracker: CrashTracker,
}

#[derive(Debug, Clone)]
pub(crate) struct RemoteCommandRecord {
    pub command: String,
    pub timestamp: DateTime<Utc>,
    pub status: RemoteActivityStatus,
}

pub(crate) struct CrashTracker {
    path: PathBuf,
}

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
