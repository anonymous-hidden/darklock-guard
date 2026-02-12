use serde::{Deserialize, Serialize};

use crate::safe_mode::SafeModeReason;
use crate::vault::SecurityProfile;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RemoteActivityStatus {
    Pending,
    Completed,
    Failed,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteActivity {
    pub command: String,
    pub timestamp: String,
    pub status: RemoteActivityStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub installed_version: String,
    pub channel: UpdateChannel,
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceState {
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_heartbeat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_profile: Option<SecurityProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_activity: Option<RemoteActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates: Option<UpdateState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_mode_reason: Option<SafeModeReason>,
}

impl DeviceState {
    pub fn error(message: &str) -> serde_json::Value {
        serde_json::json!({"error": message})
    }
}
