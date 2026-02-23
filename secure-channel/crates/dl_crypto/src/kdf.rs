//! Key derivation functions
//!
//! `vault_key_from_password` — Argon2id, derives the 32-byte key used to
//!   encrypt the local SQLite vault.
//!
//! `hkdf_expand` — HKDF-SHA256, used for session key material.

use argon2::{Argon2, Params, Version};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::ZeroizeOnDrop;

use crate::error::CryptoError;

// ── Vault key (Argon2id) ──────────────────────────────────────────────────────

/// 32-byte vault key derived from user password. Zeroized on drop.
#[derive(ZeroizeOnDrop)]
pub struct VaultKey(pub [u8; 32]);

/// Argon2id parameters — tuned for interactive (desktop) use.
/// REPLACE_ME: increase m_cost for higher-security devices.
fn argon2_params() -> Params {
    Params::new(
        64 * 1024, // m_cost: 64 MiB
        3,         // t_cost: 3 iterations
        1,         // p_cost: 1 thread
        Some(32),  // output len
    )
    .expect("Static Argon2 params are always valid")
}

/// Derive a vault key from a user password + 16-byte salt.
/// The salt should be stored alongside the encrypted vault (not secret).
pub fn vault_key_from_password(password: &[u8], salt: &[u8; 16]) -> Result<VaultKey, CryptoError> {
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, argon2_params());
    let mut output = [0u8; 32];
    argon2
        .hash_password_into(password, salt, &mut output)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    Ok(VaultKey(output))
}

/// Generate a fresh random 16-byte salt (call once on first run; store in DB).
pub fn generate_salt() -> [u8; 16] {
    use rand::RngCore;
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    salt
}

// ── HKDF-SHA256 ───────────────────────────────────────────────────────────────

/// Expand `ikm` + `info` into `output.len()` bytes of key material.
///
/// `salt` may be empty (HKDF will use a zeroed salt).
pub fn hkdf_expand(
    ikm: &[u8],
    salt: Option<&[u8]>,
    info: &[u8],
    output: &mut [u8],
) -> Result<(), CryptoError> {
    let hk = Hkdf::<Sha256>::new(salt, ikm);
    hk.expand(info, output)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))
}

/// Derive 32-byte root key for DH output.
pub fn derive_root_key(dh_output: &[u8], info: &[u8]) -> Result<[u8; 32], CryptoError> {
    let mut key = [0u8; 32];
    hkdf_expand(dh_output, Some(b"dl-secure-channel-v1"), info, &mut key)?;
    Ok(key)
}

/// Derive sending / receiving chain keys from a root key (ratchet step).
/// Returns (new_root_key, chain_key_send, chain_key_recv)
pub fn ratchet_keys(
    root_key: &[u8; 32],
    dh_ratchet_output: &[u8],
) -> Result<([u8; 32], [u8; 32], [u8; 32]), CryptoError> {
    let mut new_root = [0u8; 32];
    let mut ck_send = [0u8; 32];
    let mut ck_recv = [0u8; 32];

    // KDF_RK(rk, dh_out) → (rk', ck_send, ck_recv)
    let hk = Hkdf::<Sha256>::new(Some(root_key), dh_ratchet_output);
    hk.expand(b"dl-root-key", &mut new_root)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    hk.expand(b"dl-chain-send", &mut ck_send)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    hk.expand(b"dl-chain-recv", &mut ck_recv)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;

    Ok((new_root, ck_send, ck_recv))
}

/// Derive a per-message key from a chain key (symmetric ratchet step).
/// Returns (next_chain_key, message_key)
pub fn chain_step(ck: &[u8; 32]) -> Result<([u8; 32], [u8; 32]), CryptoError> {
    let hk = Hkdf::<Sha256>::new(Some(ck), b"dl-chain-step");
    let mut next_ck = [0u8; 32];
    let mut mk = [0u8; 32];
    hk.expand(b"next-chain-key", &mut next_ck)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    hk.expand(b"message-key", &mut mk)
        .map_err(|e| CryptoError::KeyDerivation(e.to_string()))?;
    Ok((next_ck, mk))
}
