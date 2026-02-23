//! BLAKE3-based hash utilities
//!
//! - Deterministic message IDs
//! - Hash-chain links (each message commits to the previous one)
//! - Content-addressing for attachments

pub fn hash(data: &[u8]) -> [u8; 32] {
    blake3::hash(data).into()
}

/// Keyed hash — used for MACs where a key context differentiates domains.
pub fn keyed_hash(key: &[u8; 32], data: &[u8]) -> [u8; 32] {
    blake3::keyed_hash(key, data).into()
}

/// Derive a deterministic 32-byte message ID from content.
pub fn message_id(sender_id: &str, recipient_id: &str, plaintext: &[u8], ts_nanos: i64) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"dl-msg-id-v1\x00");
    hasher.update(sender_id.as_bytes());
    hasher.update(b"\x00");
    hasher.update(recipient_id.as_bytes());
    hasher.update(b"\x00");
    hasher.update(&ts_nanos.to_le_bytes());
    hasher.update(b"\x00");
    hasher.update(plaintext);
    hex::encode(hasher.finalize().as_bytes())
}

/// Compute a chain link: H(prev_hash || message_id || ciphertext)
///
/// Enables out-of-band auditing that no messages have been dropped.
pub fn chain_link(prev_hash: &[u8; 32], message_id: &str, ciphertext: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"dl-chain-v1\x00");
    hasher.update(prev_hash);
    hasher.update(message_id.as_bytes());
    hasher.update(ciphertext);
    hasher.finalize().into()
}

/// Content hash for an attachment (used as dedup key / integrity check).
pub fn attachment_hash(data: &[u8]) -> String {
    hex::encode(blake3::hash(data).as_bytes())
}
