use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use keyring::Entry;

const SERVICE_NAME: &str = "DarklockGuard";
const TOKEN_KEY: &str = "device_token";
const IPC_SECRET_KEY: &str = "ipc_secret";

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

pub fn store_ipc_secret(device_id: &str, secret: &[u8]) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:{}", IPC_SECRET_KEY, device_id))
        .map_err(|e| anyhow!("keyring init: {e}"))?;
    let encoded = general_purpose::STANDARD.encode(secret);
    entry
        .set_password(&encoded)
        .map_err(|e| anyhow!("store ipc secret: {e}"))?;
    Ok(())
}

pub fn get_ipc_secret(device_id: &str) -> Result<Vec<u8>> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:{}", IPC_SECRET_KEY, device_id))
        .map_err(|e| anyhow!("keyring init: {e}"))?;
    let encoded = entry
        .get_password()
        .map_err(|e| anyhow!("load ipc secret: {e}"))?;
    let decoded = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| anyhow!("decode ipc secret: {e}"))?;
    Ok(decoded)
}

pub fn delete_ipc_secret(device_id: &str) -> Result<()> {
    let entry = Entry::new(SERVICE_NAME, &format!("{}:{}", IPC_SECRET_KEY, device_id))
        .map_err(|e| anyhow!("keyring init: {e}"))?;
    entry
        .delete_password()
        .map_err(|e| anyhow!("delete ipc secret: {e}"))?;
    Ok(())
}
