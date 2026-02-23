//! Encrypted message envelope — what the relay server sees.
//!
//! The server is a DUMB RELAY: it only sees:
//!   - envelope_id  (random UUID, no semantic meaning)
//!   - recipient_id (needed for routing — cannot be avoided)
//!   - sender_id    (needed to prevent spam)
//!   - sent_at      (needed for retention TTL)
//!   - ciphertext   (opaque bytes)
//!   - init_data    (optional, only on first message)
//!   - ratchet_header (DH ratchet public key + counters)
//!
//! The server CANNOT see: message type, plaintext, any metadata beyond above.
//! Recipient IDs are user IDs; the server does NOT store contact graphs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use dl_crypto::ratchet::RatchetHeader;
use dl_crypto::x3dh::X3DHHeader;

/// On-wire envelope — sent to and received from the relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    /// Random UUID — no cryptographic meaning, used for ack/dedup.
    pub envelope_id: String,

    /// Protocol version for forward compatibility.
    pub version: u8,

    /// Sender's user ID (authenticated by server token, not by envelope sig).
    pub sender_id: String,

    /// Recipient's user ID.
    pub recipient_id: String,

    /// Timestamp set by sender; server SHOULD set its own received_at and
    /// reject envelopes with sent_at skew > 5 minutes.
    pub sent_at: DateTime<Utc>,

    /// Session ID this envelope belongs to.
    pub session_id: String,

    /// Double Ratchet header (DH public key + message counters).
    pub ratchet_header: RatchetHeader,

    /// XChaCha20-Poly1305 ciphertext (nonce || ct+tag), base64-encoded.
    /// Inner content is padded PlaintextPayload JSON.
    pub ciphertext: String,

    /// Only present on session-initiating message (X3DH handshake header).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x3dh_header: Option<X3DHHeader>,

    /// Hash-chain link (see dl_crypto::hash_chain).
    pub chain_link: String,
}

/// Server metadata added when the envelope is stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEnvelope {
    #[serde(flatten)]
    pub envelope: Envelope,
    pub received_at: DateTime<Utc>,
    pub delivered: bool,
}
