//! BLAKE3-based tamper-evident hash chain for local message history.
//!
//! Each message in a conversation commits to the previous chain link,
//! creating an append-only integrity chain:
//!
//!   H_i = BLAKE3(H_{i-1} || msg_id || ciphertext_hash || timestamp_bucket)
//!
//! This detects modification, insertion, and reordering of stored messages.
//! It does NOT prevent deletion of entire histories (an attacker who owns
//! the DB can wipe everything), but any partial tampering is detectable.
//!
//! For stronger guarantees, include H_{i-1} in the AEAD associated data
//! of the next outgoing message so the peer can cross-validate.

use serde::{Deserialize, Serialize};

/// State of a conversation's hash chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashChain {
    /// Current head (most recent link). Starts at all zeros.
    pub head: [u8; 32],
    /// Number of links in the chain.
    pub length: u64,
}

impl Default for HashChain {
    fn default() -> Self {
        Self::new()
    }
}

impl HashChain {
    /// Start a new chain with the zero hash.
    pub fn new() -> Self {
        Self {
            head: [0u8; 32],
            length: 0,
        }
    }

    /// From an existing head (e.g., loaded from DB).
    pub fn from_head(head: [u8; 32], length: u64) -> Self {
        Self { head, length }
    }

    /// Append a new link and return its hash.
    ///
    /// - `msg_id` — deterministic message ID (from `hash::message_id`)
    /// - `ciphertext` — the raw ciphertext bytes
    /// - `timestamp_bucket` — a coarsened timestamp (e.g., hourly bucket)
    ///   to limit timing precision in the chain while still enabling ordering
    pub fn append(&mut self, msg_id: &str, ciphertext: &[u8], timestamp_bucket: i64) -> [u8; 32] {
        let link = compute_link(&self.head, msg_id, ciphertext, timestamp_bucket);
        self.head = link;
        self.length += 1;
        link
    }

    /// Verify that a link is valid given its predecessor.
    pub fn verify_link(
        prev_hash: &[u8; 32],
        msg_id: &str,
        ciphertext: &[u8],
        timestamp_bucket: i64,
        expected: &[u8; 32],
    ) -> bool {
        let computed = compute_link(prev_hash, msg_id, ciphertext, timestamp_bucket);
        constant_time_eq(&computed, expected)
    }

    /// Verify an entire chain of links sequentially.
    /// `links` is a list of (msg_id, ciphertext, timestamp_bucket, stored_hash).
    pub fn verify_chain(
        links: &[(&str, &[u8], i64, [u8; 32])],
    ) -> Result<(), HashChainError> {
        let mut prev = [0u8; 32]; // genesis
        for (i, (msg_id, ct, ts, stored)) in links.iter().enumerate() {
            if !Self::verify_link(&prev, msg_id, ct, *ts, stored) {
                return Err(HashChainError::BrokenLink {
                    index: i,
                    expected: hex::encode(compute_link(&prev, msg_id, ct, *ts)),
                    actual: hex::encode(stored),
                });
            }
            prev = *stored;
        }
        Ok(())
    }
}

/// Compute a single chain link.
fn compute_link(
    prev_hash: &[u8; 32],
    msg_id: &str,
    ciphertext: &[u8],
    timestamp_bucket: i64,
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"dl-chain-v1\x00");
    hasher.update(prev_hash);
    hasher.update(b"\x00");
    hasher.update(msg_id.as_bytes());
    hasher.update(b"\x00");
    // Hash the ciphertext instead of including all bytes (performance for attachments)
    let ct_hash = blake3::hash(ciphertext);
    hasher.update(ct_hash.as_bytes());
    hasher.update(b"\x00");
    hasher.update(&timestamp_bucket.to_le_bytes());
    hasher.finalize().into()
}

/// Constant-time comparison to prevent timing side channels.
fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Coarsen a Unix timestamp to an hourly bucket.
/// This limits timing precision leaked into the chain.
pub fn timestamp_bucket(unix_secs: i64) -> i64 {
    unix_secs / 3600
}

#[derive(Debug, thiserror::Error)]
pub enum HashChainError {
    #[error("Hash chain broken at link {index}: expected {expected}, got {actual}")]
    BrokenLink {
        index: usize,
        expected: String,
        actual: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_append_and_verify() {
        let mut chain = HashChain::new();
        let h1 = chain.append("msg-1", b"ciphertext-1", 1000);
        let h2 = chain.append("msg-2", b"ciphertext-2", 1001);

        assert_ne!(h1, h2);
        assert_eq!(chain.length, 2);
        assert_eq!(chain.head, h2);

        // Verify chain
        let links = vec![
            ("msg-1", b"ciphertext-1".as_slice(), 1000i64, h1),
            ("msg-2", b"ciphertext-2".as_slice(), 1001i64, h2),
        ];
        assert!(HashChain::verify_chain(&links).is_ok());
    }

    #[test]
    fn detects_tampering() {
        let mut chain = HashChain::new();
        let h1 = chain.append("msg-1", b"original", 1000);
        let h2 = chain.append("msg-2", b"ciphertext-2", 1001);

        // Tamper with message 1's ciphertext
        let links = vec![
            ("msg-1", b"TAMPERED".as_slice(), 1000i64, h1),
            ("msg-2", b"ciphertext-2".as_slice(), 1001i64, h2),
        ];
        assert!(HashChain::verify_chain(&links).is_err());
    }

    #[test]
    fn detects_reorder() {
        let mut chain = HashChain::new();
        let h1 = chain.append("msg-1", b"ct-1", 1000);
        let h2 = chain.append("msg-2", b"ct-2", 1001);

        // Swap order
        let links = vec![
            ("msg-2", b"ct-2".as_slice(), 1001i64, h2),
            ("msg-1", b"ct-1".as_slice(), 1000i64, h1),
        ];
        assert!(HashChain::verify_chain(&links).is_err());
    }
}
