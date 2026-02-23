//! Database row models — these map to/from SQL rows.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AccountRow {
    pub id: String,
    pub user_id: String,       // server-assigned user ID
    pub username: String,
    pub email: String,
    /// Base64 Ed25519 identity public key
    pub identity_pubkey: String,
    /// Encrypted (vault) Ed25519 identity secret key
    pub identity_secret_enc: String,
    /// Encrypted (vault) X25519 DH secret key
    pub dh_secret_enc: String,
    /// Hex-encoded 16-byte Argon2id salt for vault key derivation
    pub vault_salt: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ContactRow {
    pub id: String,
    pub owner_user_id: String,
    pub contact_user_id: String,
    pub display_name: Option<String>,
    /// Base64 Ed25519 identity public key — MUST NOT change silently.
    pub identity_pubkey: String,
    /// User-confirmed key fingerprint hash (null until verified).
    pub verified_fingerprint: Option<String>,
    /// If true, a key change was detected and not yet re-verified.
    pub key_change_pending: bool,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SessionRow {
    pub id: String,
    pub local_user_id: String,
    pub peer_user_id: String,
    /// Encrypted session state (Session struct, serialized + vault-encrypted)
    pub session_state_enc: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Last chain-link hash (hex)
    pub chain_head: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MessageRow {
    pub id: String,            // message_id from PlaintextPayload
    pub session_id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub sent_at: DateTime<Utc>,
    pub received_at: Option<DateTime<Utc>>,
    pub delivery_state: String, // DeliveryState as string
    pub message_type: String,  // "text" / "attachment" / etc.
    /// Encrypted message body (JSON of MessageContent, vault-encrypted)
    pub body_enc: String,
    pub chain_link: String,
    pub message_n: i64,
    pub is_outgoing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GroupRow {
    pub id: String,
    pub name: String,
    pub creator_user_id: String,
    pub created_at: DateTime<Utc>,
    pub avatar_url: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GroupMemberRow {
    pub group_id: String,
    pub user_id: String,
    pub display_name: Option<String>,
    pub role: String, // "admin" | "member"
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AttachmentRow {
    pub id: String,
    pub message_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub content_hash: String,
    pub storage_ref: String,
    /// Encrypted attachment key (vault-encrypted)
    pub attachment_key_enc: String,
    pub local_path: Option<String>,
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RiskEventRow {
    pub id: String,
    pub occurred_at: DateTime<Utc>,
    pub event_type: String,
    pub severity: String, // "low" | "medium" | "high" | "critical"
    pub description: String,
    pub raw_data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DeviceRow {
    pub id: String,
    pub user_id: String,
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    /// Base64 Ed25519 device public key
    pub device_pubkey: String,
    /// DeviceCert JSON (for display/verification)
    pub device_cert: String,
    pub enrolled_at: DateTime<Utc>,
    pub is_current_device: bool,
}
