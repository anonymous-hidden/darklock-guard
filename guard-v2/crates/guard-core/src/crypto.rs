use anyhow::{anyhow, Result};
use argon2::{Argon2, Params};
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::RngCore;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub const KDF_TIME_COST: u32 = 3;
pub const KDF_MEMORY_COST: u32 = 65536; // 64MB
pub const KDF_PARALLELISM: u32 = 4;
pub const DERIVED_KEY_LEN: usize = 32;

pub fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    let params = Params::new(
        KDF_MEMORY_COST,
        KDF_TIME_COST,
        KDF_PARALLELISM,
        Some(DERIVED_KEY_LEN),
    )
    .map_err(|e| anyhow!("argon2 params: {e}"))?;
    let argon = Argon2::from(params);
    let mut key = Zeroizing::new(vec![0u8; DERIVED_KEY_LEN]);
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| anyhow!("argon2 derive: {e}"))?;
    Ok(key)
}

pub fn encrypt(key: &[u8], nonce: &[u8; 24], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XNonce::from_slice(nonce);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow!("encrypt: {e}"))?;
    Ok(ciphertext)
}

pub fn decrypt(key: &[u8], nonce: &[u8; 24], ciphertext: &[u8]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XNonce::from_slice(nonce);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow!("decrypt: {e}"))?;
    Ok(plaintext)
}

pub fn generate_nonce() -> [u8; 24] {
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    nonce
}

pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn generate_signing_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

pub fn public_key_hex(key: &VerifyingKey) -> String {
    hex::encode(key.to_bytes())
}

pub fn device_id_from_public_key(key: &VerifyingKey) -> String {
    let digest = Sha256::digest(key.to_bytes());
    hex::encode(&digest[..8])
}

pub fn sign_bytes(key: &SigningKey, bytes: &[u8]) -> Signature {
    key.sign(bytes)
}

pub fn verify_signature(public: &VerifyingKey, bytes: &[u8], sig: &Signature) -> Result<()> {
    public
        .verify_strict(bytes, sig)
        .map_err(|e| anyhow!("signature verify failed: {e}"))
}
