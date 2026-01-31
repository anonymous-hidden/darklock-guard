use anyhow::{anyhow, Result};
use keyring::Entry;

const SERVICE_NAME: &str = "DarklockGuard";
const TOKEN_KEY: &str = "device_token";

pub fn store_device_token(device_id: &str, token: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:{}", TOKEN_KEY, device_id))
        .map_err(|e| anyhow!("keyring init: {e}"))?;
    entry
        .set_password(token)
        .map_err(|e| anyhow!("store token: {e}"))?;
    Ok(())
}

pub fn get_device_token(device_id: &str) -> Result<String> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:{}", TOKEN_KEY, device_id))
        .map_err(|e| anyhow!("keyring init: {e}"))?;
    let token = entry
        .get_password()
        .map_err(|e| anyhow!("load token: {e}"))?;
    Ok(token)
}

pub fn delete_device_token(device_id: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:{}", TOKEN_KEY, device_id))
        .map_err(|e| anyhow!("keyring init: {e}"))?;
    entry
        .delete_password()
        .map_err(|e| anyhow!("delete token: {e}"))?;
    Ok(())
}
