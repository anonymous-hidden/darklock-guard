use std::sync::{Arc, RwLock};

use guard_core::settings::{GuardSettings, SecurityMode};
use guard_core::storage::{load_settings, save_settings};
use guard_core::vault::Vault;

use crate::service_state::ServiceState;

pub struct Engine {
    settings: Arc<RwLock<GuardSettings>>,
}

impl Engine {
    pub fn load(state: &ServiceState) -> anyhow::Result<Self> {
        let settings = load_settings(&state.vault)?;
        Ok(Self {
            settings: Arc::new(RwLock::new(settings)),
        })
    }

    pub fn load_from_vault(vault: &Vault) -> anyhow::Result<Self> {
        let settings = load_settings(vault)?;
        Ok(Self {
            settings: Arc::new(RwLock::new(settings)),
        })
    }

    pub fn settings(&self) -> GuardSettings {
        self.settings.read().unwrap().clone()
    }

    pub fn update_settings(
        &self,
        vault: &mut Vault,
        new_settings: GuardSettings,
    ) -> anyhow::Result<()> {
        Self::validate(&new_settings)?;
        save_settings(vault, &new_settings)?;
        *self.settings.write().unwrap() = new_settings;
        Ok(())
    }

    fn validate(settings: &GuardSettings) -> anyhow::Result<()> {
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
}
