//! Platform-specific secure key storage
//!
//! - Windows: DPAPI for key encryption
//! - Linux: Protected file with restricted permissions
//! - macOS: Keychain (optional)

use crate::protection::{ProtectionError, Result};
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use std::fs;
use std::path::{Path, PathBuf};

/// Key file name
const KEY_FILE: &str = "signing_key.enc";

/// Key store for managing Ed25519 signing keys
pub struct KeyStore {
    data_dir: PathBuf,
    signing_key: Option<SigningKey>,
}

impl KeyStore {
    /// Create or load a key store
    pub fn new(data_dir: &Path) -> Result<Self> {
        fs::create_dir_all(data_dir)?;
        
        let mut store = Self {
            data_dir: data_dir.to_path_buf(),
            signing_key: None,
        };
        
        store.load_or_create_key()?;
        
        Ok(store)
    }
    
    /// Get the signing key
    pub fn get_signing_key(&self) -> Result<SigningKey> {
        self.signing_key.clone()
            .ok_or_else(|| ProtectionError::KeyStore("Signing key not loaded".to_string()))
    }
    
    /// Get the verifying (public) key
    pub fn get_verifying_key(&self) -> Result<VerifyingKey> {
        let signing_key = self.get_signing_key()?;
        Ok(signing_key.verifying_key())
    }
    
    /// Load existing key or create new one
    fn load_or_create_key(&mut self) -> Result<()> {
        let key_path = self.data_dir.join(KEY_FILE);
        
        if key_path.exists() {
            self.signing_key = Some(self.load_key(&key_path)?);
        } else {
            let key = self.create_key()?;
            self.save_key(&key_path, &key)?;
            self.signing_key = Some(key);
        }
        
        Ok(())
    }
    
    /// Create a new signing key
    fn create_key(&self) -> Result<SigningKey> {
        Ok(SigningKey::generate(&mut OsRng))
    }
    
    /// Save key to file with platform-specific protection
    fn save_key(&self, path: &Path, key: &SigningKey) -> Result<()> {
        let key_bytes = key.to_bytes();
        
        #[cfg(windows)]
        {
            let encrypted = self.dpapi_encrypt(&key_bytes)?;
            fs::write(path, encrypted)?;
        }
        
        #[cfg(not(windows))]
        {
            // On Unix, just write with restricted permissions
            fs::write(path, key_bytes)?;
            self.set_restricted_permissions(path)?;
        }
        
        Ok(())
    }
    
    /// Load key from file
    fn load_key(&self, path: &Path) -> Result<SigningKey> {
        let data = fs::read(path)?;
        
        #[cfg(windows)]
        let key_bytes = self.dpapi_decrypt(&data)?;
        
        #[cfg(not(windows))]
        let key_bytes = data;
        
        if key_bytes.len() != 32 {
            return Err(ProtectionError::KeyStore("Invalid key file size".to_string()));
        }
        
        let mut key_array = [0u8; 32];
        key_array.copy_from_slice(&key_bytes);
        
        Ok(SigningKey::from_bytes(&key_array))
    }
    
    /// Windows: Encrypt using DPAPI
    #[cfg(windows)]
    fn dpapi_encrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        use winapi::um::dpapi::CryptProtectData;
        use winapi::um::wincrypt::CRYPTOAPI_BLOB;
        use std::ptr;
        
        let mut input_blob = CRYPTOAPI_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        
        let mut output_blob = CRYPTOAPI_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        
        let result = unsafe {
            CryptProtectData(
                &mut input_blob,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut output_blob,
            )
        };
        
        if result == 0 {
            return Err(ProtectionError::KeyStore("DPAPI encryption failed".to_string()));
        }
        
        let encrypted = unsafe {
            std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
        };
        
        // Free the allocated memory
        unsafe {
            winapi::um::winbase::LocalFree(output_blob.pbData as *mut _);
        }
        
        Ok(encrypted)
    }
    
    /// Windows: Decrypt using DPAPI
    #[cfg(windows)]
    fn dpapi_decrypt(&self, data: &[u8]) -> Result<Vec<u8>> {
        use winapi::um::dpapi::CryptUnprotectData;
        use winapi::um::wincrypt::CRYPTOAPI_BLOB;
        use std::ptr;
        
        let mut input_blob = CRYPTOAPI_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        
        let mut output_blob = CRYPTOAPI_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        
        let result = unsafe {
            CryptUnprotectData(
                &mut input_blob,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut output_blob,
            )
        };
        
        if result == 0 {
            return Err(ProtectionError::KeyStore("DPAPI decryption failed".to_string()));
        }
        
        let decrypted = unsafe {
            std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
        };
        
        // Free the allocated memory
        unsafe {
            winapi::um::winbase::LocalFree(output_blob.pbData as *mut _);
        }
        
        Ok(decrypted)
    }
    
    /// Unix: Set restricted file permissions (owner read/write only)
    #[cfg(not(windows))]
    fn set_restricted_permissions(&self, path: &Path) -> Result<()> {
        use std::os::unix::fs::PermissionsExt;
        
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(0o600); // rw-------
        fs::set_permissions(path, perms)?;
        
        Ok(())
    }
    
    /// Export public key for verification
    pub fn export_public_key(&self) -> Result<String> {
        let verifying_key = self.get_verifying_key()?;
        Ok(hex::encode(verifying_key.to_bytes()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    #[test]
    fn test_key_creation() {
        let temp_dir = TempDir::new().unwrap();
        let store = KeyStore::new(temp_dir.path()).unwrap();
        
        let signing_key = store.get_signing_key().unwrap();
        let verifying_key = store.get_verifying_key().unwrap();
        
        // Verify keys match
        assert_eq!(signing_key.verifying_key(), verifying_key);
    }
    
    #[test]
    fn test_key_persistence() {
        let temp_dir = TempDir::new().unwrap();
        
        // Create key store
        let store1 = KeyStore::new(temp_dir.path()).unwrap();
        let key1 = store1.get_signing_key().unwrap();
        
        // Reload and verify same key
        let store2 = KeyStore::new(temp_dir.path()).unwrap();
        let key2 = store2.get_signing_key().unwrap();
        
        assert_eq!(key1.to_bytes(), key2.to_bytes());
    }
}
