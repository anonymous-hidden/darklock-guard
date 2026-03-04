use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SecurityMode {
    Normal,
    Strict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceLimits {
    pub max_cpu_percent: u8,
    pub max_memory_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectionSettings {
    pub realtime_enabled: bool,
    pub baseline_locked: bool,
    #[serde(default)]
    pub protected_paths: Vec<String>,
    #[serde(default)]
    pub quarantine_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSettings {
    pub channel: String,
    pub auto_update: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacySettings {
    pub telemetry_enabled: bool,
    #[serde(default)]
    pub crash_reports: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardSettings {
    pub security_mode: SecurityMode,
    pub protection: ProtectionSettings,
    pub performance: PerformanceLimits,
    pub updates: UpdateSettings,
    pub privacy: PrivacySettings,
}

impl Default for GuardSettings {
    fn default() -> Self {
        Self {
            security_mode: SecurityMode::Strict,
            protection: ProtectionSettings {
                realtime_enabled: true,
                baseline_locked: true,
                protected_paths: vec![],
                quarantine_enabled: true,
            },
            performance: PerformanceLimits {
                max_cpu_percent: 30,
                max_memory_mb: 512,
            },
            updates: UpdateSettings {
                channel: "stable".into(),
                auto_update: true,
            },
            privacy: PrivacySettings {
                telemetry_enabled: false,
                crash_reports: true,
            },
        }
    }
}
