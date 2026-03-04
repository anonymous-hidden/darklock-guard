use crate::settings::GuardSettings;
use crate::vault::Vault;

const SETTINGS_KEY: &str = "guard.settings";

pub fn load_settings(vault: &Vault) -> anyhow::Result<GuardSettings> {
    if let Some(bytes) = vault.get(SETTINGS_KEY)? {
        Ok(serde_json::from_slice(&bytes)?)
    } else {
        Ok(GuardSettings::default())
    }
}

pub fn save_settings(vault: &mut Vault, settings: &GuardSettings) -> anyhow::Result<()> {
    let data = serde_json::to_vec(settings)?;
    vault.set(SETTINGS_KEY, &data)?;
    Ok(())
}
