//! Group state with signed epochs.
//!
//! Group state is a signed object containing:
//!   group_id, epoch, members, admins, policies, sender_key_info, signature
//!
//! Epoch increments on any membership change; epoch changes force sender-key
//! rotation and block old sender keys.
//!
//! v2 migration target: MLS (RFC 9420) for large-scale groups.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Signed group state — the authoritative descriptor of a group at a point in time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupState {
    pub group_id: String,
    /// Monotonically increasing epoch. Increments on ANY membership change.
    pub epoch: u64,
    /// Current members with roles.
    pub members: Vec<GroupMember>,
    /// Group policies.
    pub policies: GroupPolicies,
    /// Sender key info for this epoch (encrypted per-member via 1:1 sessions).
    pub sender_key_id: String,
    /// Ed25519 signature over the canonical form of this state, made by the
    /// admin who committed the change.
    pub signature: String,
    /// Who signed this state change (user_id of the admin).
    pub signed_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub user_id: String,
    pub display_name: Option<String>,
    pub role: GroupRole,
    pub joined_at: DateTime<Utc>,
    /// Ed25519 identity public key at time of joining (for key-change detection)
    pub identity_pubkey: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupRole {
    Admin,
    Member,
}

/// Group-level policies that affect security behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupPolicies {
    /// Maximum number of members.
    pub max_members: u32,
    /// Whether new members can see history before they joined.
    pub history_visibility: HistoryVisibility,
    /// Whether only admins can add members.
    pub admin_only_invite: bool,
    /// Whether the group accepts join-by-link.
    pub join_by_link: bool,
    /// Disappearing messages (0 = disabled, seconds otherwise)
    pub disappearing_messages_secs: u64,
}

impl Default for GroupPolicies {
    fn default() -> Self {
        Self {
            max_members: 256,
            history_visibility: HistoryVisibility::Joined,
            admin_only_invite: false,
            join_by_link: false,
            disappearing_messages_secs: 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryVisibility {
    /// Only messages sent after the member joined.
    Joined,
    /// All history (requires re-encryption with new sender key).
    Shared,
}

/// A group epoch change event — sent to all members when the group state updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpochChange {
    pub group_id: String,
    pub old_epoch: u64,
    pub new_epoch: u64,
    pub change_type: EpochChangeType,
    /// New sender key (encrypted per-member via their 1:1 session).
    pub new_sender_key_id: String,
    /// Signed by the admin who performed the change.
    pub signature: String,
    pub signed_by: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EpochChangeType {
    MemberAdded { user_id: String },
    MemberRemoved { user_id: String },
    MemberPromoted { user_id: String },
    MemberDemoted { user_id: String },
    PolicyChanged { field: String, old_value: String, new_value: String },
}

/// Canonical bytes for signing a GroupState.
pub fn canonical_group_state_bytes(state: &GroupState) -> Vec<u8> {
    // Build a deterministic representation for signing
    let canonical = serde_json::json!({
        "group_id": state.group_id,
        "epoch": state.epoch,
        "members": state.members,
        "policies": state.policies,
        "sender_key_id": state.sender_key_id,
        "signed_by": state.signed_by,
        "created_at": state.created_at.to_rfc3339(),
        "updated_at": state.updated_at.to_rfc3339(),
    });
    serde_json::to_vec(&canonical).unwrap_or_default()
}
