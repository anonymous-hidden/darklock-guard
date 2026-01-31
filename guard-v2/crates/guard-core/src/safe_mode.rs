use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SafeModeReason {
    Manual,
    VaultCorrupt,
    CryptoError,
    ServiceCrashLoop,
    IntegrityFailure,
    IpcFailure,
    RemoteCommand,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SafeModeState {
    pub active: bool,
    pub reason: Option<SafeModeReason>,
    pub entered_at: Option<DateTime<Utc>>,
}

impl Default for SafeModeState {
    fn default() -> Self {
        Self {
            active: false,
            reason: None,
            entered_at: None,
        }
    }
}

impl SafeModeState {
    pub fn enter(&mut self, reason: SafeModeReason) {
        self.active = true;
        self.reason = Some(reason);
        self.entered_at = Some(Utc::now());
    }

    pub fn exit(&mut self) {
        self.active = false;
        self.reason = None;
        self.entered_at = None;
    }
}
