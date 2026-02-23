//! Plaintext message types (inside the encrypted envelope).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Deserialised plaintext carried inside an Envelope ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaintextPayload {
    /// Protocol version (currently 2).
    pub version: u8,
    /// Deterministic message ID (BLAKE3 of content + metadata).
    pub message_id: String,
    /// Message content (text, attachment, reaction, etc.).
    pub content: MessageContent,
    pub sent_at: DateTime<Utc>,
    /// Sender's user ID (for cross-checking with envelope).
    pub sender_user_id: String,
    /// Sender's device ID.
    pub sender_device_id: String,
    /// Hash chain link for tamper evidence.
    pub chain_link: String,
    /// Previous hash-chain link (so the recipient can cross-validate).
    pub prev_chain_link: String,
    /// Padding bucket size used (for the recipient to verify correct padding).
    pub padding_bucket: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageContent {
    Text {
        body: String,
    },
    Attachment {
        filename: String,
        mime_type: String,
        size_bytes: u64,
        /// Blake3 hash of the unencrypted content.
        content_hash: String,
        /// URL or key reference for the encrypted attachment on server.
        storage_ref: String,
        /// 32-byte XChaCha20-Poly1305 key, base64 (wrapped in session key).
        attachment_key: String,
    },
    Reaction {
        target_message_id: String,
        emoji: String,
    },
    Delete {
        target_message_id: String,
    },
    GroupInvite {
        group_id: String,
        group_name: String,
        invite_token: String,
    },
    /// Typing indicator — never persisted.
    Typing {
        typing: bool,
    },
    /// Read receipt — never persisted on server.
    Receipt {
        message_id: String,
        state: DeliveryState,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageType {
    Direct,
    Group,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    #[default]
    Sending,
    Sent,
    Delivered,
    Read,
    Failed,
}
