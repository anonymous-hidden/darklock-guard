//! dl_crypto — Darklock Secure Channel cryptographic primitives
//!
//! # Design principles
//! - NO custom crypto; all primitives come from audited Rust crates.
//! - Zeroize all secret material on drop.
//! - All public APIs return opaque newtypes to prevent accidental misuse.
//!
//! # Module layout
//! - `identity`         — long-term Ed25519 identity + device keys + device certificates
//! - `x3dh`             — X3DH-like asynchronous key agreement (SPK verification, proper DH)
//! - `ratchet`          — full Double Ratchet with DH ratchet steps + skipped message keys
//! - `session`          — legacy simplified session (deprecated, use ratchet + x3dh)
//! - `aead`             — XChaCha20-Poly1305 encrypt/decrypt helpers
//! - `kdf`              — HKDF / Argon2id key derivation
//! - `hash`             — BLAKE3 utilities (message IDs, chain links)
//! - `hash_chain`       — tamper-evident local message history chain
//! - `hardware_unlock`  — OS keyring / WebAuthn / Pi5 approval stubs
//! - `error`            — unified error type

pub mod aead;
pub mod error;
pub mod hash;
pub mod hash_chain;
pub mod hardware_unlock;
pub mod identity;
pub mod kdf;
pub mod ratchet;
pub mod session;
pub mod x3dh;

pub use error::CryptoError;
