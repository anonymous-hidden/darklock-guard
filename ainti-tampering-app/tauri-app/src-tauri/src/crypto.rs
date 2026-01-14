//! Cryptographic operations for Darklock Guard
//!
//! Implements:
//! - SHA-256 file hashing
//! - Ed25519 signing for manifests
//! - Merkle tree computation
//! - Secure key storage (DPAPI on Windows, Keyring elsewhere)

use sha2::{Sha256, Digest};
use ed25519_dalek::{SigningKey, VerifyingKey, Signature, Signer, Verifier};
use rand::rngs::OsRng;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use std::path::Path;
use std::fs::File;
use std::io::{BufReader, Read};
use crate::error::{DarklockError, Result};

/// Buffer size for file hashing (64KB)
const HASH_BUFFER_SIZE: usize = 65536;

/// Compute SHA-256 hash of a file
pub fn hash_file(path: &Path) -> Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(HASH_BUFFER_SIZE, file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; HASH_BUFFER_SIZE];

    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

/// Compute SHA-256 hash of raw bytes
pub fn hash_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Compute SHA-256 hash of a string
pub fn hash_string(data: &str) -> String {
    hash_bytes(data.as_bytes())
}

/// Ed25519 Key Pair for signing
#[derive(Clone)]
pub struct SigningKeyPair {
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
}

impl SigningKeyPair {
    /// Generate a new random key pair
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        Self { signing_key, verifying_key }
    }

    /// Create from existing secret key bytes
    pub fn from_secret_bytes(bytes: &[u8; 32]) -> Result<Self> {
        let signing_key = SigningKey::from_bytes(bytes);
        let verifying_key = signing_key.verifying_key();
        Ok(Self { signing_key, verifying_key })
    }

    /// Sign a message
    pub fn sign(&self, message: &[u8]) -> String {
        let signature = self.signing_key.sign(message);
        BASE64.encode(signature.to_bytes())
    }

    /// Verify a signature
    pub fn verify(&self, message: &[u8], signature_b64: &str) -> Result<bool> {
        let sig_bytes = BASE64.decode(signature_b64)
            .map_err(|e| DarklockError::Crypto(format!("Invalid signature encoding: {}", e)))?;
        
        let signature = Signature::from_slice(&sig_bytes)
            .map_err(|e| DarklockError::Crypto(format!("Invalid signature: {}", e)))?;
        
        Ok(self.verifying_key.verify(message, &signature).is_ok())
    }

    /// Get secret key bytes (for secure storage)
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Get public key as base64
    pub fn public_key_b64(&self) -> String {
        BASE64.encode(self.verifying_key.as_bytes())
    }
}

/// Merkle tree node
#[derive(Clone, Debug)]
pub struct MerkleNode {
    pub hash: String,
    pub left: Option<Box<MerkleNode>>,
    pub right: Option<Box<MerkleNode>>,
}

impl MerkleNode {
    /// Create a leaf node
    pub fn leaf(hash: String) -> Self {
        Self { hash, left: None, right: None }
    }

    /// Create a branch node
    pub fn branch(left: MerkleNode, right: MerkleNode) -> Self {
        let combined = format!("{}{}", left.hash, right.hash);
        let hash = hash_string(&combined);
        Self {
            hash,
            left: Some(Box::new(left)),
            right: Some(Box::new(right)),
        }
    }
}

/// Build a Merkle tree from a list of file hashes
pub fn build_merkle_tree(hashes: &[String]) -> Option<MerkleNode> {
    if hashes.is_empty() {
        return None;
    }

    let mut nodes: Vec<MerkleNode> = hashes
        .iter()
        .map(|h| MerkleNode::leaf(h.clone()))
        .collect();

    while nodes.len() > 1 {
        let mut next_level = Vec::new();

        for chunk in nodes.chunks(2) {
            match chunk {
                [left, right] => {
                    next_level.push(MerkleNode::branch(left.clone(), right.clone()));
                }
                [single] => {
                    // Duplicate single node for odd count
                    next_level.push(MerkleNode::branch(single.clone(), single.clone()));
                }
                _ => unreachable!(),
            }
        }

        nodes = next_level;
    }

    nodes.into_iter().next()
}

/// Get Merkle root hash
pub fn merkle_root(hashes: &[String]) -> Option<String> {
    build_merkle_tree(hashes).map(|node| node.hash)
}

#[cfg(windows)]
pub mod secure_storage {
    //! Secure storage using Windows DPAPI
    
    use winapi::um::dpapi::{CryptProtectData, CryptUnprotectData};
    use winapi::um::wincrypt::DATA_BLOB;
    use std::ptr;
    use crate::error::{DarklockError, Result};

    /// Encrypt data using DPAPI (user scope)
    pub fn protect(data: &[u8]) -> Result<Vec<u8>> {
        let mut input_blob = DATA_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output_blob = DATA_BLOB {
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
            return Err(DarklockError::Crypto("DPAPI encryption failed".to_string()));
        }

        let protected = unsafe {
            std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
        };

        // Free the memory allocated by DPAPI
        unsafe {
            winapi::um::winbase::LocalFree(output_blob.pbData as _);
        }

        Ok(protected)
    }

    /// Decrypt data using DPAPI
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>> {
        let mut input_blob = DATA_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output_blob = DATA_BLOB {
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
            return Err(DarklockError::Crypto("DPAPI decryption failed".to_string()));
        }

        let decrypted = unsafe {
            std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
        };

        unsafe {
            winapi::um::winbase::LocalFree(output_blob.pbData as _);
        }

        Ok(decrypted)
    }
}

#[cfg(not(windows))]
pub mod secure_storage {
    //! Secure storage using keyring on non-Windows platforms
    
    use keyring::Entry;
    use crate::error::{DarklockError, Result};
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

    const SERVICE: &str = "darklock-guard";

    /// Store data in keyring
    pub fn protect(data: &[u8]) -> Result<Vec<u8>> {
        // On non-Windows, we just encode - actual storage happens at a higher level
        Ok(BASE64.encode(data).into_bytes())
    }

    /// Retrieve data from keyring
    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>> {
        let encoded = String::from_utf8(data.to_vec())
            .map_err(|e| DarklockError::Crypto(format!("Invalid UTF-8: {}", e)))?;
        BASE64.decode(&encoded)
            .map_err(|e| DarklockError::Crypto(format!("Invalid base64: {}", e)))
    }

    /// Store secret in OS keyring
    pub fn store_secret(key: &str, secret: &[u8]) -> Result<()> {
        let entry = Entry::new(SERVICE, key)
            .map_err(|e| DarklockError::Storage(format!("Keyring error: {}", e)))?;
        let encoded = BASE64.encode(secret);
        entry.set_password(&encoded)
            .map_err(|e| DarklockError::Storage(format!("Failed to store secret: {}", e)))
    }

    /// Retrieve secret from OS keyring
    pub fn retrieve_secret(key: &str) -> Result<Vec<u8>> {
        let entry = Entry::new(SERVICE, key)
            .map_err(|e| DarklockError::Storage(format!("Keyring error: {}", e)))?;
        let encoded = entry.get_password()
            .map_err(|e| DarklockError::Storage(format!("Failed to retrieve secret: {}", e)))?;
        BASE64.decode(&encoded)
            .map_err(|e| DarklockError::Crypto(format!("Invalid secret encoding: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_string() {
        let hash = hash_string("hello world");
        assert_eq!(hash.len(), 64); // SHA-256 produces 32 bytes = 64 hex chars
    }

    #[test]
    fn test_signing() {
        let keypair = SigningKeyPair::generate();
        let message = b"test message";
        let signature = keypair.sign(message);
        assert!(keypair.verify(message, &signature).unwrap());
    }

    #[test]
    fn test_merkle_tree() {
        let hashes = vec![
            "hash1".to_string(),
            "hash2".to_string(),
            "hash3".to_string(),
        ];
        let root = merkle_root(&hashes);
        assert!(root.is_some());
    }
}
