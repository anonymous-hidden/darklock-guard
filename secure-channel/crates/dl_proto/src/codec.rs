//! Wire codec — serialization, framing, and padding for messages.
//!
//! # Padding
//! To resist traffic analysis, outgoing messages can be padded to fixed
//! size buckets. The padding is added INSIDE the plaintext before encryption,
//! so the relay sees uniform-sized ciphertext.
//!
//! Bucket sizes (bytes): 256, 512, 1024, 4096, 16384, 65536
//! Messages larger than 65536 bytes are not padded (attachments use
//! their own encryption channel).

use serde::{Deserialize, Serialize};

/// Padding mode for metadata minimization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaddingMode {
    /// No padding — minimal bandwidth.
    None,
    /// Pad to fixed-size buckets.
    Buckets,
    /// Pad all messages to the maximum bucket size (64KB).
    /// Maximum privacy, maximum bandwidth.
    Maximum,
}

impl Default for PaddingMode {
    fn default() -> Self {
        Self::Buckets
    }
}

const BUCKET_SIZES: &[usize] = &[256, 512, 1024, 4096, 16384, 65536];

/// Pad plaintext to the next bucket boundary.
///
/// Format: [original_len: u32 LE] [plaintext] [random padding]
///
/// The length prefix allows unambiguous unpadding after decryption.
pub fn pad_to_bucket(plaintext: &[u8], mode: PaddingMode) -> Vec<u8> {
    match mode {
        PaddingMode::None => {
            let mut out = Vec::with_capacity(4 + plaintext.len());
            out.extend_from_slice(&(plaintext.len() as u32).to_le_bytes());
            out.extend_from_slice(plaintext);
            out
        }
        PaddingMode::Buckets => {
            let needed = 4 + plaintext.len();
            let bucket = BUCKET_SIZES
                .iter()
                .copied()
                .find(|&b| b >= needed)
                .unwrap_or(needed); // If larger than max bucket, no padding
            pad_to_size(plaintext, bucket)
        }
        PaddingMode::Maximum => {
            pad_to_size(plaintext, *BUCKET_SIZES.last().unwrap())
        }
    }
}

/// Remove padding after decryption.
pub fn unpad(padded: &[u8]) -> Result<Vec<u8>, CodecError> {
    if padded.len() < 4 {
        return Err(CodecError::InvalidPadding("too short for length prefix".into()));
    }
    let len = u32::from_le_bytes([padded[0], padded[1], padded[2], padded[3]]) as usize;
    if 4 + len > padded.len() {
        return Err(CodecError::InvalidPadding(format!(
            "length prefix {len} exceeds padded data size {}",
            padded.len()
        )));
    }
    Ok(padded[4..4 + len].to_vec())
}

fn pad_to_size(plaintext: &[u8], target: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target);
    out.extend_from_slice(&(plaintext.len() as u32).to_le_bytes());
    out.extend_from_slice(plaintext);
    // Fill remaining with random bytes (not zeros — avoids compression leaks)
    let remaining = target.saturating_sub(out.len());
    if remaining > 0 {
        let mut padding = vec![0u8; remaining];
        use rand::RngCore;
        rand::rngs::OsRng.fill_bytes(&mut padding);
        out.extend_from_slice(&padding);
    }
    out
}

/// Batching mode for metadata minimization.
/// When enabled, outgoing messages are queued and sent in fixed-interval batches
/// rather than immediately, reducing timing correlation attacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BatchingMode {
    /// Send immediately (default).
    Immediate,
    /// Queue and send every N seconds.
    Interval { seconds: u32 },
}

impl Default for BatchingMode {
    fn default() -> Self {
        Self::Immediate
    }
}

/// Encode a message for the wire: serialize → pad → ready for AEAD encryption.
pub fn encode_for_wire(
    payload_json: &[u8],
    padding_mode: PaddingMode,
) -> Vec<u8> {
    pad_to_bucket(payload_json, padding_mode)
}

/// Decode a message from the wire: AEAD-decrypted bytes → unpad → JSON payload.
pub fn decode_from_wire(padded_plaintext: &[u8]) -> Result<Vec<u8>, CodecError> {
    unpad(padded_plaintext)
}

#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    #[error("Invalid padding: {0}")]
    InvalidPadding(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pad_unpad_roundtrip_buckets() {
        let msg = b"Hello, World!";
        let padded = pad_to_bucket(msg, PaddingMode::Buckets);
        assert_eq!(padded.len(), 256); // smallest bucket
        let unpadded = unpad(&padded).unwrap();
        assert_eq!(unpadded, msg);
    }

    #[test]
    fn pad_unpad_roundtrip_none() {
        let msg = b"No padding test";
        let padded = pad_to_bucket(msg, PaddingMode::None);
        assert_eq!(padded.len(), 4 + msg.len());
        let unpadded = unpad(&padded).unwrap();
        assert_eq!(unpadded, msg);
    }

    #[test]
    fn pad_unpad_large_message() {
        let msg = vec![0x42u8; 5000];
        let padded = pad_to_bucket(&msg, PaddingMode::Buckets);
        assert_eq!(padded.len(), 16384); // next bucket up from 5004
        let unpadded = unpad(&padded).unwrap();
        assert_eq!(unpadded, msg);
    }

    #[test]
    fn pad_maximum() {
        let msg = b"tiny";
        let padded = pad_to_bucket(msg, PaddingMode::Maximum);
        assert_eq!(padded.len(), 65536);
        let unpadded = unpad(&padded).unwrap();
        assert_eq!(unpadded, msg);
    }
}
