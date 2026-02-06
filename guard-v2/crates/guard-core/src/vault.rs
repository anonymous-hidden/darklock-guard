use crate::crypto::*;
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use chrono::{DateTime, Utc};
use ed25519_dalek::{SigningKey, VerifyingKey};
use parking_lot::RwLock;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const VAULT_MAGIC: &[u8] = b"DLOCK02\0";
pub const VAULT_VERSION: u32 = 2;
pub const HEADER_SIZE: usize = 128;
pub const CURRENT_CONFIG_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Mode {
    Local,
    Connected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SecurityProfile {
    Normal,
    ZeroTrust,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedPath {
    pub path: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConnection {
    pub user_id: Option<String>,
    pub linked_at: Option<DateTime<Utc>>,
    pub server_public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NonceCacheEntry {
    pub value: String,
    pub expires: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub protected_paths: Vec<ProtectedPath>,
    pub notification_level: String,
    pub update_channel: String,
    pub auto_update: bool,
    pub telemetry_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultState {
    pub safe_mode: bool,
    pub safe_mode_reason: Option<String>,
    pub tour_completed: bool,
    pub last_update_check: Option<DateTime<Utc>>,
    pub installed_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultPayload {
    pub vault_id: String,
    pub created_at: DateTime<Utc>,
    pub last_modified: DateTime<Utc>,
    pub config_version: u32,

    pub device_id: String,
    pub device_private_key: String,
    pub device_public_key: String,

    #[serde(default = "default_mode")]
    pub mode: Mode,
    #[serde(default = "default_security_profile")]
    pub security_profile: SecurityProfile,
    #[serde(default = "default_connection")]
    pub connection: VaultConnection,

    #[serde(default = "default_config")]
    pub config: VaultConfig,
    #[serde(default = "default_state")]
    pub state: VaultState,

    #[serde(default = "Vec::new")]
    pub nonce_cache: Vec<NonceCacheEntry>,
    #[serde(default = "random_secret")]
    pub ipc_shared_secret: String,
    #[serde(default)]
    pub kv: HashMap<String, String>,
}

#[derive(Debug)]
pub struct Vault {
    pub header: VaultHeader,
    pub payload: VaultPayload,
    path: PathBuf,
    key: Zeroizing<Vec<u8>>,
    kv: RwLock<HashMap<String, String>>,
}

impl Clone for Vault {
    fn clone(&self) -> Self {
        Self {
            header: self.header.clone(),
            payload: self.payload.clone(),
            path: self.path.clone(),
            key: self.key.clone(),
            kv: RwLock::new(self.kv.read().clone()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct VaultHeader {
    pub vault_version: u32,
    pub config_version: u32,
    pub kdf_time_cost: u32,
    pub kdf_memory_cost: u32,
    pub kdf_parallelism: u32,
    pub salt: [u8; 32],
    pub nonce: [u8; 24],
}

impl Vault {
    pub fn create_new<P: AsRef<Path>>(path: P, password: &str) -> Result<Self> {
        if Path::new(path.as_ref()).exists() {
            return Err(anyhow!("vault already exists"));
        }
        let salt = generate_salt();
        let nonce = generate_nonce();
        let key = derive_key(password, &salt)?;
        let signing_key = generate_signing_key();
        let verifying_key: VerifyingKey = signing_key.verifying_key();
        let device_id = device_id_from_public_key(&verifying_key);
        let ipc_secret = random_secret();

        let payload = VaultPayload {
            vault_id: Uuid::new_v4().to_string(),
            created_at: Utc::now(),
            last_modified: Utc::now(),
            config_version: CURRENT_CONFIG_VERSION,
            device_id,
            device_private_key: general_purpose::STANDARD.encode(signing_key.to_bytes()),
            device_public_key: general_purpose::STANDARD.encode(verifying_key.to_bytes()),
            mode: Mode::Local,
            security_profile: SecurityProfile::Normal,
            connection: VaultConnection {
                user_id: None,
                linked_at: None,
                server_public_key: None,
            },
            config: VaultConfig {
                protected_paths: vec![],
                notification_level: "all".to_string(),
                update_channel: "stable".to_string(),
                auto_update: true,
                telemetry_enabled: true,
            },
            state: VaultState {
                safe_mode: false,
                safe_mode_reason: None,
                tour_completed: false,
                last_update_check: None,
                installed_version: "0.0.0".to_string(),
            },
            nonce_cache: vec![],
            ipc_shared_secret: ipc_secret,
            kv: HashMap::new(),
        };

        let header = VaultHeader {
            vault_version: VAULT_VERSION,
            config_version: CURRENT_CONFIG_VERSION,
            kdf_time_cost: KDF_TIME_COST,
            kdf_memory_cost: KDF_MEMORY_COST,
            kdf_parallelism: KDF_PARALLELISM,
            salt,
            nonce,
        };

        let mut vault = Vault {
            header,
            payload,
            path: path.as_ref().to_path_buf(),
            key: key.clone(),
            kv: RwLock::new(HashMap::new()),
        };
        vault.save(password)?;
        Ok(vault)
    }

    pub fn open<P: AsRef<Path>>(path: P, password: &str) -> Result<Self> {
        let mut file = File::open(path.as_ref()).map_err(|e| anyhow!("open vault: {e}"))?;
        let mut header_buf = [0u8; HEADER_SIZE];
        file.read_exact(&mut header_buf)?;
        let header = VaultHeader::from_bytes(&header_buf)?;
        let mut ciphertext = Vec::new();
        file.read_to_end(&mut ciphertext)?;

        let key = derive_key(password, &header.salt)?;
        let plaintext =
            decrypt(&key, &header.nonce, &ciphertext).map_err(|e| anyhow!("decrypt vault: {e}"))?;
        let mut payload: VaultPayload =
            serde_json::from_slice(&plaintext).map_err(|e| anyhow!("parse vault: {e}"))?;
        migrate_payload(&mut payload)?;
        let kv = payload.kv.clone();
        let vault = Vault {
            header: VaultHeader {
                config_version: payload.config_version,
                ..header
            },
            payload,
            path: path.as_ref().to_path_buf(),
            key: key.clone(),
            kv: RwLock::new(kv),
        };
        Ok(vault)
    }

    pub fn save(&mut self, password: &str) -> Result<()> {
        self.payload.last_modified = Utc::now();
        self.payload.config_version = CURRENT_CONFIG_VERSION;
        let mut payload = self.payload.clone();
        payload.kv = self.kv.read().clone();
        let plaintext = serde_json::to_vec(&payload)?;
        let key = derive_key(password, &self.header.salt)?;
        self.key = key.clone();
        // Generate fresh nonce for every save to prevent XChaCha20-Poly1305 nonce reuse
        let new_nonce = generate_nonce();
        self.header.nonce = new_nonce;
        let ciphertext = encrypt(&key, &self.header.nonce, &plaintext)?;
        let mut file = File::create(&self.path)?;
        file.write_all(&VaultHeader::to_bytes(&self.header)?)?;
        file.write_all(&ciphertext)?;
        file.flush()?;
        Ok(())
    }

    pub fn save_with_key(&mut self) -> Result<()> {
        let mut payload = self.payload.clone();
        payload.last_modified = Utc::now();
        payload.config_version = CURRENT_CONFIG_VERSION;
        payload.kv = self.kv.read().clone();
        let plaintext = serde_json::to_vec(&payload)?;
        // Generate fresh nonce for every save to prevent XChaCha20-Poly1305 nonce reuse
        let new_nonce = generate_nonce();
        self.header.nonce = new_nonce;
        let ciphertext = encrypt(&self.key, &self.header.nonce, &plaintext)?;
        let mut file = File::create(&self.path)?;
        file.write_all(&VaultHeader::to_bytes(&self.header)?)?;
        file.write_all(&ciphertext)?;
        file.flush()?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let guard = self.kv.read();
        if let Some(value) = guard.get(key) {
            let decoded = general_purpose::STANDARD
                .decode(value)
                .map_err(|e| anyhow!("decode kv value: {e}"))?;
            Ok(Some(decoded))
        } else {
            Ok(None)
        }
    }

    pub fn set(&mut self, key: &str, value: &[u8]) -> Result<()> {
        let mut guard = self.kv.write();
        let encoded = general_purpose::STANDARD.encode(value);
        guard.insert(key.to_string(), encoded);
        drop(guard);
        self.save_with_key()?;
        Ok(())
    }

    pub fn signing_key(&self, _password: &str) -> Result<SigningKey> {
        let key_bytes = general_purpose::STANDARD
            .decode(&self.payload.device_private_key)
            .map_err(|e| anyhow!("decode private key: {e}"))?;
        let key_bytes: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| anyhow!("private key length invalid"))?;
        Ok(SigningKey::from_bytes(&key_bytes))
    }

    pub fn verifying_key(&self) -> Result<VerifyingKey> {
        let key_bytes = general_purpose::STANDARD
            .decode(&self.payload.device_public_key)
            .map_err(|e| anyhow!("decode public key: {e}"))?;
        let key_bytes: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| anyhow!("public key length invalid"))?;
        Ok(VerifyingKey::from_bytes(&key_bytes).map_err(|e| anyhow!("load verifying key: {e}"))?)
    }

    pub fn ipc_shared_secret(&self) -> Result<Vec<u8>> {
        general_purpose::STANDARD
            .decode(&self.payload.ipc_shared_secret)
            .map_err(|e| anyhow!("decode ipc secret: {e}"))
    }
}

impl VaultHeader {
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; HEADER_SIZE];
        if VAULT_MAGIC.len() > 8 {
            return Err(anyhow!("magic length invalid"));
        }
        buf[..VAULT_MAGIC.len()].copy_from_slice(VAULT_MAGIC);
        buf[8..12].copy_from_slice(&self.vault_version.to_le_bytes());
        buf[12..16].copy_from_slice(&self.config_version.to_le_bytes());
        buf[16..20].copy_from_slice(&self.kdf_time_cost.to_le_bytes());
        buf[20..24].copy_from_slice(&self.kdf_memory_cost.to_le_bytes());
        buf[24..28].copy_from_slice(&self.kdf_parallelism.to_le_bytes());
        buf[28..60].copy_from_slice(&self.salt);
        buf[60..84].copy_from_slice(&self.nonce);
        // remaining bytes stay zero
        Ok(buf)
    }

    pub fn from_bytes(buf: &[u8]) -> Result<Self> {
        if buf.len() != HEADER_SIZE {
            return Err(anyhow!("invalid header size"));
        }
        if &buf[..VAULT_MAGIC.len()] != VAULT_MAGIC {
            return Err(anyhow!("invalid magic"));
        }
        let vault_version = u32::from_le_bytes(buf[8..12].try_into().unwrap());
        if vault_version != VAULT_VERSION {
            return Err(anyhow!("vault version mismatch"));
        }
        Ok(Self {
            vault_version,
            config_version: u32::from_le_bytes(buf[12..16].try_into().unwrap()),
            kdf_time_cost: u32::from_le_bytes(buf[16..20].try_into().unwrap()),
            kdf_memory_cost: u32::from_le_bytes(buf[20..24].try_into().unwrap()),
            kdf_parallelism: u32::from_le_bytes(buf[24..28].try_into().unwrap()),
            salt: buf[28..60].try_into().unwrap(),
            nonce: buf[60..84].try_into().unwrap(),
        })
    }
}

fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    general_purpose::STANDARD.encode(bytes)
}

fn default_security_profile() -> SecurityProfile {
    SecurityProfile::Normal
}

fn default_mode() -> Mode {
    Mode::Local
}

fn default_connection() -> VaultConnection {
    VaultConnection {
        user_id: None,
        linked_at: None,
        server_public_key: None,
    }
}

fn default_config() -> VaultConfig {
    VaultConfig {
        protected_paths: vec![],
        notification_level: "all".to_string(),
        update_channel: "stable".to_string(),
        auto_update: true,
        telemetry_enabled: true,
    }
}

fn default_state() -> VaultState {
    VaultState {
        safe_mode: false,
        safe_mode_reason: None,
        tour_completed: false,
        last_update_check: None,
        installed_version: "0.0.0".to_string(),
    }
}

fn migrate_payload(payload: &mut VaultPayload) -> Result<()> {
    if payload.config_version < 2 {
        // Add security_profile and nonce_cache and ipc_shared_secret if missing
        if payload.security_profile != SecurityProfile::Normal
            && payload.security_profile != SecurityProfile::ZeroTrust
        {
            payload.security_profile = SecurityProfile::Normal;
        }
        if payload.nonce_cache.is_empty() {
            payload.nonce_cache = vec![];
        }
        if payload.ipc_shared_secret.is_empty() {
            payload.ipc_shared_secret = random_secret();
        }
        payload.config_version = 2;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn create_and_open_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.dat");
        let password = "correct horse battery staple";
        let vault = Vault::create_new(&path, password).unwrap();
        assert_eq!(vault.payload.config_version, CURRENT_CONFIG_VERSION);
        let opened = Vault::open(&path, password).unwrap();
        assert_eq!(opened.payload.device_id, vault.payload.device_id);
        assert_eq!(opened.payload.security_profile, SecurityProfile::Normal);
    }

    #[test]
    fn wrong_password_fails() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("vault.dat");
        let vault = Vault::create_new(&path, "pw1").unwrap();
        assert!(Vault::open(&path, "pw2").is_err());
        drop(vault);
    }
}
