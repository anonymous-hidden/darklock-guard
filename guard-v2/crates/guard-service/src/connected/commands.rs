use crate::connected::state::NonceBook;
use crate::connected::verifier::{canonical_result_message, Verifier};
use crate::ServiceState;
use anyhow::Result;
use chrono::{DateTime, Utc};
use guard_core::device_state::RemoteActivityStatus;
use guard_core::event_log::EventSeverity;
use guard_core::safe_mode::SafeModeReason;
use guard_core::vault::SecurityProfile;
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::Arc;
use tokio::{
    task::JoinHandle,
    time::{self, Duration},
};
use tracing::{info, warn};

use super::api_client::ApiClient;
use super::telemetry::record_command_event;
use crate::RemoteCommandRecord;

#[derive(Clone, Debug)]
pub struct ServerCommand {
    pub id: String,
    pub command: String,
    pub payload: Value,
    pub nonce: String,
    pub signature: String,
    pub expires_at: DateTime<Utc>,
}

impl TryFrom<Value> for ServerCommand {
    type Error = anyhow::Error;

    fn try_from(value: Value) -> Result<Self, Self::Error> {
        Ok(Self {
            id: value
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing id"))?
                .to_string(),
            command: value
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            payload: value
                .get("payload")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
            nonce: value
                .get("nonce")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing nonce"))?
                .to_string(),
            signature: value
                .get("signature")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            expires_at: value
                .get("expires_at")
                .and_then(|v| v.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|| Utc::now()),
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum CommandValidationError {
    ZeroTrust,
    Expired,
    Replay,
    InvalidSignature,
}

fn record_remote_activity(
    state: &Arc<Mutex<ServiceState>>,
    cmd: &ServerCommand,
    status: RemoteActivityStatus,
) {
    if let Ok(mut guard) = std::panic::catch_unwind(|| state.lock()) {
        guard.last_remote_command = Some(RemoteCommandRecord {
            command: cmd.command.clone(),
            timestamp: Utc::now(),
            status,
        });
    }
}

pub fn spawn_command_loop(
    client: ApiClient,
    verifier: Verifier,
    device_id: String,
    mut nonce_book: NonceBook,
    security_profile: SecurityProfile,
    state: Arc<Mutex<ServiceState>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(15));
        loop {
            ticker.tick().await;
            match client.fetch_pending_commands(&device_id).await {
                Ok(commands) => {
                    for cmd in commands {
                        match validate_command(&cmd, &security_profile, &mut nonce_book, &verifier)
                        {
                            Ok(_) => {
                                info!(id = %cmd.id, cmd = %cmd.command, "command validated");
                                record_remote_activity(&state, &cmd, RemoteActivityStatus::Pending);
                                if let Err(err) =
                                    execute_command(&client, &device_id, &cmd, &state).await
                                {
                                    warn!(error = %err, "failed to execute command");
                                }
                            }
                            Err(reason) => {
                                warn!(id = %cmd.id, ?reason, "command rejected locally");
                                record_remote_activity(
                                    &state,
                                    &cmd,
                                    RemoteActivityStatus::Rejected,
                                );
                                let _ = reject_command(&client, &device_id, &cmd, &state, &reason)
                                    .await;
                                record_command_event(&state, "COMMAND_REJECTED", &cmd.id, &reason);
                            }
                        }
                    }
                }
                Err(err) => warn!(error = %err, "pending command poll failed"),
            }
        }
    })
}

pub fn validate_command(
    cmd: &ServerCommand,
    profile: &SecurityProfile,
    nonce_book: &mut NonceBook,
    verifier: &Verifier,
) -> Result<(), CommandValidationError> {
    if matches!(profile, SecurityProfile::ZeroTrust) {
        return Err(CommandValidationError::ZeroTrust);
    }
    if cmd.expires_at < Utc::now() {
        return Err(CommandValidationError::Expired);
    }
    nonce_book
        .check_and_store(&cmd.nonce)
        .map_err(|_| CommandValidationError::Replay)?;
    verifier
        .verify_command(cmd)
        .map_err(|_| CommandValidationError::InvalidSignature)?;
    Ok(())
}

async fn reject_command(
    client: &ApiClient,
    device_id: &str,
    cmd: &ServerCommand,
    state: &Arc<Mutex<ServiceState>>,
    reason: &CommandValidationError,
) -> Result<()> {
    let payload = serde_json::json!({"error": format!("rejected: {:?}", reason)});
    let signature = sign_result(device_id, cmd, "rejected", &payload, state)?;
    client
        .submit_result(
            device_id,
            &cmd.id,
            "rejected",
            &cmd.nonce,
            Some(signature),
            Some(payload),
            Some(format!("rejected: {:?}", reason)),
        )
        .await
}

async fn execute_command(
    client: &ApiClient,
    device_id: &str,
    cmd: &ServerCommand,
    state: &Arc<Mutex<ServiceState>>,
) -> Result<()> {
    let result = match cmd.command.as_str() {
        "ENTER_SAFE_MODE" => execute_enter_safe_mode(client, device_id, cmd, state).await,
        "REQUEST_LOGS" => reply_execution_not_implemented(client, device_id, cmd, state).await,
        _ => reply_execution_not_implemented(client, device_id, cmd, state).await,
    };

    match result {
        Ok(_) => record_remote_activity(state, cmd, RemoteActivityStatus::Completed),
        Err(_) => record_remote_activity(state, cmd, RemoteActivityStatus::Failed),
    }

    result
}

async fn execute_enter_safe_mode(
    client: &ApiClient,
    device_id: &str,
    cmd: &ServerCommand,
    state: &Arc<Mutex<ServiceState>>,
) -> Result<()> {
    {
        let mut guard = state.lock();
        guard.safe_mode.enter(SafeModeReason::RemoteCommand);
        guard.event_log.append(
            "SAFE_MODE_ENTERED",
            EventSeverity::Critical,
            serde_json::json!({"reason": "REMOTE_COMMAND", "command_id": cmd.id}),
        )?;
        // Persist safe mode state to vault
        guard.vault.payload.state.safe_mode = true;
        guard.vault.payload.state.safe_mode_reason = Some("REMOTE_COMMAND".to_string());
        guard.vault.save(&guard.password)?;
    }

    info!(command_id = %cmd.id, "safe mode entered via remote command");
    let payload = serde_json::json!({"safe_mode": true, "reason": "REMOTE_COMMAND"});
    let signature = sign_result(device_id, cmd, "succeeded", &payload, state)?;
    client
        .submit_result(
            device_id,
            &cmd.id,
            "succeeded",
            &cmd.nonce,
            Some(signature),
            Some(payload),
            None,
        )
        .await
}

async fn reply_execution_not_implemented(
    client: &ApiClient,
    device_id: &str,
    cmd: &ServerCommand,
    state: &Arc<Mutex<ServiceState>>,
) -> Result<()> {
    let payload = serde_json::json!({"error": "execution_not_implemented"});
    let signature = sign_result(device_id, cmd, "failed", &payload, state)?;
    client
        .submit_result(
            device_id,
            &cmd.id,
            "failed",
            &cmd.nonce,
            Some(signature),
            Some(payload),
            None,
        )
        .await
}

fn sign_result(
    _device_id: &str,
    cmd: &ServerCommand,
    status: &str,
    payload: &serde_json::Value,
    state: &Arc<Mutex<ServiceState>>,
) -> Result<String> {
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::Signer;

    let message = canonical_result_message(&cmd.id, &cmd.nonce, status, payload);
    let guard = state.lock();
    let signing_key = guard.vault.signing_key(&guard.password)?;
    let sig = signing_key.sign(&message);
    Ok(general_purpose::STANDARD.encode(sig.to_bytes()))
}
