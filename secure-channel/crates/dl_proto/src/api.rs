//! API request/response types shared between clients and services.
//! These map directly to JSON bodies on the wire.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::envelope::Envelope;

// ── IDS ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    /// Base64 Ed25519 identity public key
    pub identity_pubkey: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterResponse {
    pub user_id: String,
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username_or_email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub user_id: String,
    pub username: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Signals whether the server thinks the client should re-verify keys.
    pub key_change_detected: bool,
    /// Role tag assigned to this user (e.g. "owner", "admin", "moderator").
    #[serde(default)]
    pub system_role: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceEnrollRequest {
    /// Base64 Ed25519 device public key
    pub device_pubkey: String,
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    /// DeviceCert JSON, signed by identity key
    pub device_cert: serde_json::Value,
    /// X25519 public key for DH (separate from signing key)
    pub dh_pubkey: String,
    /// Signed prekey for X3DH
    pub spk_pubkey: String,
    pub spk_sig: String,
    /// One-time prekeys (batch upload)
    pub one_time_prekeys: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceEnrollResponse {
    pub device_id: String,
    pub enrolled_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyUploadRequest {
    /// New batch of one-time prekeys
    pub one_time_prekeys: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserKeysResponse {
    pub user_id: String,
    pub username: String,
    /// Base64 Ed25519 identity public key
    pub identity_pubkey: String,
    /// Key version counter — if this increases unexpectedly, WARN user.
    pub key_version: u64,
    pub prekey_bundle: PrekeyBundleResponse,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PrekeyBundleResponse {
    pub ik_pub: String,
    pub spk_pub: String,
    pub spk_sig: String,
    pub opk_pub: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDevicesResponse {
    pub user_id: String,
    pub devices: Vec<DeviceInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub device_pubkey: String,
    pub enrolled_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
}

// ── RLY ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SendRequest {
    pub envelope: Envelope,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendResponse {
    pub envelope_id: String,
    pub received_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PollRequest {
    /// Long-poll timeout in seconds (max 30)
    pub timeout_secs: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PollResponse {
    pub envelopes: Vec<Envelope>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AckRequest {
    pub envelope_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AckResponse {
    pub acked: Vec<String>,
}

// ── Common ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshResponse {
    pub access_token: String,
    pub refresh_token: String,
}
