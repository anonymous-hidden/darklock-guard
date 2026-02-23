//! Hardware-backed key unlock options.
//!
//! This module provides a layered unlock strategy to raise the bar against
//! local theft and some malware classes:
//!
//! 1. **OS Keyring** — Store a random "DB unwrap key" in the platform's
//!    credential store (Windows Credential Manager, Linux Secret Service /
//!    libsecret). If available, the vault can be unsealed without password
//!    entry (convenience mode).
//!
//! 2. **WebAuthn/FIDO2** — Use a hardware security key as a strong second
//!    factor for vault unsealing. The server (or local verifier) issues a
//!    challenge, the key signs it, and the response is used as additional
//!    entropy mixed into the vault key derivation.
//!    Ref: W3C WebAuthn Level 3, FIDO Alliance CTAP2.
//!
//! 3. **Pi5 / RFID approval** — Optional "Darklock Key Device" that must
//!    approve vault unsealing via a signed challenge over local network.
//!    This is an architectural control; cryptographic binding is in the
//!    protocol design.
//!
//! Implementation status:
//!   - OS Keyring: stub (use tauri-plugin-secure-storage in the Tauri app)
//!   - WebAuthn: stub (v2 feature)
//!   - Pi5 approval: stub (v2 feature)

use serde::{Deserialize, Serialize};
use crate::error::CryptoError;

/// Which hardware unlock methods are available / configured.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HardwareUnlockConfig {
    pub keyring_available: bool,
    pub webauthn_configured: bool,
    pub pi5_approval_configured: bool,
}

/// Result of a hardware unlock attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HardwareUnlockResult {
    /// Successfully retrieved unwrap key (32 bytes, base64).
    Success { unwrap_key_b64: String },
    /// Unlock denied or failed.
    Denied { reason: String },
    /// Method not available on this platform.
    Unavailable,
}

// ── OS Keyring ───────────────────────────────────────────────────────────────

/// Store a vault unwrap key in the OS keyring.
///
/// In the Tauri app, this should route to `tauri-plugin-secure-storage`
/// or the platform's native credential store.
pub fn store_in_keyring(_service: &str, _account: &str, _key: &[u8; 32]) -> Result<(), CryptoError> {
    // REPLACE_ME: integrate with tauri-plugin-secure-storage or keyring crate
    Err(CryptoError::KeyGeneration(
        "OS keyring integration not yet implemented — use password-based unlock".into(),
    ))
}

/// Retrieve a vault unwrap key from the OS keyring.
pub fn retrieve_from_keyring(_service: &str, _account: &str) -> Result<Option<[u8; 32]>, CryptoError> {
    // REPLACE_ME: integrate with tauri-plugin-secure-storage or keyring crate
    Ok(None) // Not available
}

/// Delete a vault unwrap key from the OS keyring.
pub fn delete_from_keyring(_service: &str, _account: &str) -> Result<(), CryptoError> {
    Ok(()) // No-op when not implemented
}

// ── WebAuthn / FIDO2 ─────────────────────────────────────────────────────────

/// Generate a WebAuthn challenge for vault unlock.
///
/// The challenge is a random 32-byte value. The FIDO2 authenticator signs it,
/// and the response is mixed into the vault key derivation as additional entropy.
pub fn generate_webauthn_challenge() -> [u8; 32] {
    use rand::RngCore;
    let mut challenge = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut challenge);
    challenge
}

/// Verify a WebAuthn assertion response and extract the authenticator data
/// for mixing into vault key derivation.
///
/// Returns additional entropy (32 bytes) derived from the assertion.
pub fn verify_webauthn_assertion(
    _challenge: &[u8; 32],
    _assertion_response: &[u8],
    _credential_public_key: &[u8],
) -> Result<[u8; 32], CryptoError> {
    // REPLACE_ME: implement WebAuthn assertion verification
    // In v2, use the webauthn-rs crate for server-side verification,
    // or delegate to the browser's navigator.credentials.get() via Tauri.
    Err(CryptoError::KeyGeneration(
        "WebAuthn verification not yet implemented (v2 feature)".into(),
    ))
}

// ── Pi5 / RFID Approval ─────────────────────────────────────────────────────

/// Request approval from a local Darklock Key Device (Pi5 + RFID).
///
/// Protocol:
///   1. Client generates a challenge nonce
///   2. Client sends challenge to key device over local network (mTLS or signed)
///   3. Key device requires physical RFID tap to approve
///   4. Key device signs the challenge and returns the signature
///   5. Client mixes the signature into vault key derivation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pi5ApprovalRequest {
    pub challenge: [u8; 32],
    pub device_name: String,
    pub requester_device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pi5ApprovalResponse {
    pub approved: bool,
    pub signature: Option<Vec<u8>>,
    pub approver_device_id: String,
}

/// Send an approval request to the Pi5 key device.
pub async fn request_pi5_approval(
    _key_device_url: &str,
    _request: &Pi5ApprovalRequest,
) -> Result<Pi5ApprovalResponse, CryptoError> {
    // REPLACE_ME: implement local network challenge-response with Pi5
    Err(CryptoError::KeyGeneration(
        "Pi5 approval integration not yet implemented (v2 feature)".into(),
    ))
}

// ── Mixed unlock ─────────────────────────────────────────────────────────────

/// Derive enhanced vault key by mixing password-derived key with hardware entropy.
///
/// vault_key_final = HKDF(ikm = password_key || hardware_entropy, info = "dl-hw-unlock-v1")
pub fn mix_hardware_entropy(
    password_key: &[u8; 32],
    hardware_entropy: &[u8; 32],
) -> Result<[u8; 32], CryptoError> {
    let mut ikm = [0u8; 64];
    ikm[..32].copy_from_slice(password_key);
    ikm[32..].copy_from_slice(hardware_entropy);

    let mut output = [0u8; 32];
    crate::kdf::hkdf_expand(&ikm, Some(b"dl-hw-unlock-v1"), b"vault-key", &mut output)?;

    // Zeroize intermediate
    use zeroize::Zeroize;
    ikm.zeroize();

    Ok(output)
}

/// Probe which hardware unlock methods are available on this system.
pub fn detect_hardware_unlock() -> HardwareUnlockConfig {
    HardwareUnlockConfig {
        keyring_available: cfg!(any(target_os = "linux", target_os = "windows", target_os = "macos")),
        webauthn_configured: false, // v2
        pi5_approval_configured: false, // v2
    }
}
