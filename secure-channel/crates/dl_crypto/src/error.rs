use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Key generation failed: {0}")]
    KeyGeneration(String),

    #[error("Signature verification failed")]
    SignatureVerification,

    #[error("AEAD encryption failed")]
    AeadEncrypt,

    #[error("AEAD decryption failed (authentication tag mismatch — possible tampering)")]
    AeadDecrypt,

    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),

    #[error("Invalid key material: {0}")]
    InvalidKey(String),

    #[error("Session not initialised")]
    SessionNotInitialised,

    #[error("Ratchet step failed: {0}")]
    RatchetStep(String),

    #[error("Certificate validation failed: {0}")]
    CertificateValidation(String),

    #[error("Nonce generation failed")]
    NonceGeneration,

    #[error("Hash chain integrity error: {0}")]
    HashChainIntegrity(String),

    #[error("Hardware unlock error: {0}")]
    HardwareUnlock(String),

    #[error("Prekey error: {0}")]
    PrekeyError(String),

    #[error("Serialisation error: {0}")]
    Serialisation(#[from] serde_json::Error),

    #[error("Hex decode error: {0}")]
    HexDecode(#[from] hex::FromHexError),

    #[error("Base64 decode error: {0}")]
    Base64Decode(#[from] base64::DecodeError),
}
