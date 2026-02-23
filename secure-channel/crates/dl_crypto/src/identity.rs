//! Identity key management  
//!
//! Each *user* has one long-term `IdentityKeyPair` (Ed25519).  
//! Each *device* has one `DeviceKeyPair` (Ed25519).  
//! A `DeviceCert` is a JSON payload signed by the identity key, binding  
//! the device public key + device-id + timestamp + capabilities.  
//!
//! Key-change policy (NON-NEGOTIABLE)
//! -----------------------------------
//! If a stored `IdentityPublicKey` for a VERIFIED contact changes, the
//! application MUST:
//!   1. Block send/receive to that contact.
//!   2. Surface a loud, unmissable UI warning (KeyChangeBanner).
//!   3. Require the user to explicitly re-verify (QR / fingerprint comparison).
//!   4. Never silently fall back to unverified messaging.
//! This module produces the key material; enforcement lives in `dl_store` +
//! the Tauri command layer.
//!
//! Prekeys
//! -------
//! - Signed Prekey (SPK): X25519, rotated periodically (weekly default),
//!   public half signed by the identity Ed25519 key.
//! - One-Time Prekeys (OPK): X25519, consumed once per session init.
//!   Batch-generated and uploaded; server deletes after use.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use ed25519_dalek::{
    Signature, Signer, SigningKey, Verifier as _, VerifyingKey,
};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use zeroize::ZeroizeOnDrop;

use crate::error::CryptoError;

// ── Newtype wrappers ──────────────────────────────────────────────────────────

/// 32-byte Ed25519 public key, base64url-encoded on the wire.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublicKeyBytes(pub Vec<u8>);

impl PublicKeyBytes {
    pub fn to_b64(&self) -> String {
        URL_SAFE_NO_PAD.encode(&self.0)
    }

    pub fn from_b64(s: &str) -> Result<Self, CryptoError> {
        let bytes = URL_SAFE_NO_PAD.decode(s)?;
        if bytes.len() != 32 {
            return Err(CryptoError::InvalidKey(format!(
                "Public key must be 32 bytes, got {}",
                bytes.len()
            )));
        }
        Ok(Self(bytes))
    }

    /// Human-readable fingerprint: BLAKE3 of the public key, truncated to
    /// 20 bytes (160 bits), hex-encoded in groups of 4 for display.
    ///
    /// Example: "a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789 0abc def0"
    ///
    /// 160 bits provides strong collision resistance for manual verification.
    pub fn fingerprint(&self) -> String {
        let hash = blake3::hash(&self.0);
        let hex = hex::encode(&hash.as_bytes()[..20]);
        hex.chars()
            .collect::<Vec<_>>()
            .chunks(4)
            .map(|c| c.iter().collect::<String>())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Numeric fingerprint for QR codes: 12 groups of 5 digits (60 digits).
    /// Derived from BLAKE3 hash, matching Signal's safety number format.
    pub fn numeric_fingerprint(&self) -> String {
        let hash = blake3::hash(&self.0);
        let bytes = hash.as_bytes();
        let mut groups = Vec::with_capacity(12);
        for i in 0..12 {
            // Take 2.5 bytes (20 bits) per group, mod 100000
            let offset = i * 5 / 2;
            let val = if i % 2 == 0 {
                ((bytes[offset] as u32) << 12)
                    | ((bytes[offset + 1] as u32) << 4)
                    | ((bytes[offset + 2] as u32) >> 4)
            } else {
                (((bytes[offset] & 0x0F) as u32) << 16)
                    | ((bytes[offset + 1] as u32) << 8)
                    | (bytes[offset + 2] as u32)
            };
            groups.push(format!("{:05}", val % 100_000));
        }
        groups.join(" ")
    }

    /// Compare two fingerprints for verification.
    /// Returns true if both keys produce the same fingerprint.
    pub fn fingerprints_match(&self, other: &PublicKeyBytes) -> bool {
        // Constant-time comparison of the full hash to prevent timing leaks
        let h1 = blake3::hash(&self.0);
        let h2 = blake3::hash(&other.0);
        let mut diff = 0u8;
        for (a, b) in h1.as_bytes().iter().zip(h2.as_bytes().iter()) {
            diff |= a ^ b;
        }
        diff == 0
    }
}

// ── Identity keypair ──────────────────────────────────────────────────────────

/// Long-term identity signing key.  Drop clears memory via ZeroizeOnDrop.
#[derive(ZeroizeOnDrop)]
pub struct IdentityKeyPair {
    #[zeroize(skip)]
    pub public: PublicKeyBytes,
    secret_bytes: [u8; 32],
}

impl IdentityKeyPair {
    pub fn generate() -> Result<Self, CryptoError> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let public = PublicKeyBytes(signing_key.verifying_key().to_bytes().to_vec());
        let secret_bytes = signing_key.to_bytes();
        Ok(Self { public, secret_bytes })
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 32 {
            return Err(CryptoError::InvalidKey(format!(
                "Identity key must be 32 bytes, got {}", bytes.len()
            )));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(bytes);
        let signing_key = SigningKey::from_bytes(&arr);
        let public = PublicKeyBytes(signing_key.verifying_key().to_bytes().to_vec());
        Ok(Self { public, secret_bytes: arr })
    }

    pub fn secret_bytes(&self) -> &[u8; 32] {
        &self.secret_bytes
    }

    fn signing_key(&self) -> SigningKey {
        SigningKey::from_bytes(&self.secret_bytes)
    }

    /// Sign arbitrary bytes; returns 64-byte raw Ed25519 signature.
    pub fn sign(&self, msg: &[u8]) -> Vec<u8> {
        self.signing_key().sign(msg).to_bytes().to_vec()
    }

    /// Verify a signature made by any Ed25519 public key.
    pub fn verify(public_bytes: &[u8], msg: &[u8], sig_bytes: &[u8]) -> Result<(), CryptoError> {
        let vk = VerifyingKey::from_bytes(
            public_bytes.try_into().map_err(|_| CryptoError::InvalidKey("Bad pubkey len".into()))?,
        )
        .map_err(|e| CryptoError::InvalidKey(e.to_string()))?;
        let sig = Signature::from_bytes(
            sig_bytes.try_into().map_err(|_| CryptoError::InvalidKey("Bad sig len".into()))?,
        );
        vk.verify(msg, &sig).map_err(|_| CryptoError::SignatureVerification)
    }

    /// Convert this Ed25519 key's public half to X25519 for DH operations.
    /// Used in X3DH when the identity key participates in key agreement.
    pub fn to_x25519_public(&self) -> Result<x25519_dalek::PublicKey, CryptoError> {
        let ed_pub: [u8; 32] = self.public.0.clone().try_into()
            .map_err(|_| CryptoError::InvalidKey("public key not 32 bytes".into()))?;
        crate::x3dh::ed25519_pub_to_x25519(&ed_pub)
    }

    /// Export the public key in base64 format for server upload.
    pub fn public_b64(&self) -> String {
        self.public.to_b64()
    }
}

// ── Device keypair ────────────────────────────────────────────────────────────

#[derive(ZeroizeOnDrop)]
pub struct DeviceKeyPair {
    #[zeroize(skip)]
    pub public: PublicKeyBytes,
    secret_bytes: [u8; 32],
}

impl DeviceKeyPair {
    pub fn generate() -> Result<Self, CryptoError> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let public = PublicKeyBytes(signing_key.verifying_key().to_bytes().to_vec());
        Ok(Self { public, secret_bytes: signing_key.to_bytes() })
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        if bytes.len() != 32 {
            return Err(CryptoError::InvalidKey("Device key must be 32 bytes".into()));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(bytes);
        let signing_key = SigningKey::from_bytes(&arr);
        let public = PublicKeyBytes(signing_key.verifying_key().to_bytes().to_vec());
        Ok(Self { public, secret_bytes: arr })
    }

    pub fn secret_bytes(&self) -> &[u8; 32] {
        &self.secret_bytes
    }

    pub fn sign(&self, msg: &[u8]) -> Vec<u8> {
        SigningKey::from_bytes(&self.secret_bytes).sign(msg).to_bytes().to_vec()
    }
}

// ── Device certificate ────────────────────────────────────────────────────────

/// Proof that a device key belongs to an identity, signed by the identity key.
/// Format: IK_sign(version || device_id || user_id || DK_pub || created_at || expires_at || capabilities)
///
/// This prevents a server from silently swapping in arbitrary device keys
/// without changing the IK trust anchor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCert {
    pub version: u8,
    pub device_id: String,
    pub user_id: String,
    /// Base64-encoded Ed25519 device public key
    pub device_pubkey: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    /// Device capabilities — controls what this device is allowed to do
    pub capabilities: DeviceCapabilities,
    /// Base64-encoded Ed25519 signature over canonical JSON of the above fields
    pub signature: String,
}

/// What actions a device is authorised to perform.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeviceCapabilities {
    /// Can send/receive messages
    pub messaging: bool,
    /// Can manage contacts (add/verify/remove)
    pub contacts: bool,
    /// Can create/admin groups
    pub groups: bool,
    /// Can rotate identity key (dangerous — only primary device)
    pub identity_rotation: bool,
}

impl DeviceCapabilities {
    /// Full capabilities for a primary device.
    pub fn primary() -> Self {
        Self {
            messaging: true,
            contacts: true,
            groups: true,
            identity_rotation: true,
        }
    }

    /// Limited capabilities for a secondary/linked device.
    pub fn secondary() -> Self {
        Self {
            messaging: true,
            contacts: true,
            groups: false,
            identity_rotation: false,
        }
    }
}

impl DeviceCert {
    /// Issue a new device certificate, signed by the supplied identity key.
    pub fn issue(
        identity: &IdentityKeyPair,
        device_pub: &PublicKeyBytes,
        device_id: &str,
        user_id: &str,
        valid_days: i64,
        capabilities: DeviceCapabilities,
    ) -> Result<Self, CryptoError> {
        let now = Utc::now();
        let expires_at = now + chrono::Duration::days(valid_days);

        // Canonical payload — serialise deterministically before signing.
        // Field ordering MUST be stable (serde_json sorts alphabetically
        // by default with `json!`).
        let payload = serde_json::json!({
            "capabilities": capabilities,
            "device_id": device_id,
            "device_pubkey": device_pub.to_b64(),
            "expires_at": expires_at.to_rfc3339(),
            "issued_at": now.to_rfc3339(),
            "user_id": user_id,
            "version": 2,
        });
        let payload_bytes = serde_json::to_vec(&payload)?;
        let sig = identity.sign(&payload_bytes);

        Ok(DeviceCert {
            version: 2,
            device_id: device_id.to_string(),
            user_id: user_id.to_string(),
            device_pubkey: device_pub.to_b64(),
            issued_at: now,
            expires_at,
            capabilities,
            signature: URL_SAFE_NO_PAD.encode(&sig),
        })
    }

    /// Verify this cert against the provided identity public key.
    pub fn verify(&self, identity_pub: &PublicKeyBytes) -> Result<(), CryptoError> {
        // Re-build the same canonical payload (must match issue() ordering)
        let payload = serde_json::json!({
            "capabilities": self.capabilities,
            "device_id": self.device_id,
            "device_pubkey": self.device_pubkey,
            "expires_at": self.expires_at.to_rfc3339(),
            "issued_at": self.issued_at.to_rfc3339(),
            "user_id": self.user_id,
            "version": self.version,
        });
        let payload_bytes = serde_json::to_vec(&payload)?;

        let sig_bytes = URL_SAFE_NO_PAD.decode(&self.signature)?;
        IdentityKeyPair::verify(&identity_pub.0, &payload_bytes, &sig_bytes)?;

        // Expiry check
        if Utc::now() > self.expires_at {
            return Err(CryptoError::CertificateValidation("Certificate has expired".into()));
        }

        // Version check
        if self.version < 1 {
            return Err(CryptoError::CertificateValidation("Unknown certificate version".into()));
        }

        Ok(())
    }

    /// Device public key decoded from the cert.
    pub fn device_pubkey_bytes(&self) -> Result<PublicKeyBytes, CryptoError> {
        PublicKeyBytes::from_b64(&self.device_pubkey)
    }
}
