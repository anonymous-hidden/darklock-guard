//! Authenticated Encryption with Associated Data
//!
//! Uses XChaCha20-Poly1305 (192-bit nonce).  
//! Key size: 32 bytes.  Nonce: 24 bytes (random).  Tag: 16 bytes.
//!
//! Ciphertext wire format:
//!   [ nonce (24 bytes) | ciphertext + tag ]

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng as AeadOsRng},
    XChaCha20Poly1305,
};
use zeroize::Zeroizing;

use crate::error::CryptoError;

/// Encrypt `plaintext` with a 32-byte key, prepending a random 24-byte nonce.
/// `aad` — additional associated data (authenticated but not encrypted).
pub fn encrypt(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| CryptoError::AeadEncrypt)?;

    let nonce = XChaCha20Poly1305::generate_nonce(&mut AeadOsRng);

    let ciphertext = cipher
        .encrypt(&nonce, chacha20poly1305::aead::Payload { msg: plaintext, aad })
        .map_err(|_| CryptoError::AeadEncrypt)?;

    // Prepend nonce
    let mut out = Vec::with_capacity(24 + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt wire-format bytes (nonce || ciphertext+tag).
pub fn decrypt(key: &[u8; 32], data: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if data.len() < 24 {
        return Err(CryptoError::AeadDecrypt);
    }
    let (nonce_bytes, ct) = data.split_at(24);
    let nonce = chacha20poly1305::XNonce::from_slice(nonce_bytes);

    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|_| CryptoError::AeadDecrypt)?;

    let plaintext = cipher
        .decrypt(nonce, chacha20poly1305::aead::Payload { msg: ct, aad })
        .map_err(|_| CryptoError::AeadDecrypt)?;

    Ok(Zeroizing::new(plaintext))
}

/// Encrypt a 32-byte key with another 32-byte wrapping key (key transport).
pub fn wrap_key(wrap_key: &[u8; 32], key_to_wrap: &[u8; 32]) -> Result<Vec<u8>, CryptoError> {
    encrypt(wrap_key, key_to_wrap, b"dl-key-wrap")
}

/// Decrypt a wrapped key.
pub fn unwrap_key(wrap_key: &[u8; 32], wrapped: &[u8]) -> Result<[u8; 32], CryptoError> {
    let plaintext = decrypt(wrap_key, wrapped, b"dl-key-wrap")?;
    if plaintext.len() != 32 {
        return Err(CryptoError::InvalidKey("Unwrapped key wrong length".into()));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&plaintext);
    Ok(out)
}
