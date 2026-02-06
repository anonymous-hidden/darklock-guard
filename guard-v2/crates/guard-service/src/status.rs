use crate::service_state::{RemoteCommandRecord, ServiceState};
use anyhow::{anyhow, Result};
use chrono::SecondsFormat;
use guard_core::device_state::{DeviceState, RemoteActivity, UpdateChannel, UpdateState};
use guard_core::paths::status_socket_path;
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::task::JoinHandle;

#[cfg(unix)]
use tokio::{io::AsyncWriteExt, net::UnixListener};

/// IPC transport: Unix domain socket (local-only). Path is derived from `status_socket_path()`.
#[cfg(unix)]
pub fn spawn_status_server(state: Arc<Mutex<ServiceState>>) -> Result<JoinHandle<()>> {
    let socket_path = status_socket_path()?;
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    use std::os::unix::fs::PermissionsExt;
    let listener = UnixListener::bind(&socket_path)?;
    std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;

    let task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((mut stream, _)) => {
                    let payload = match snapshot_state(&state) {
                        Ok(device_state) => serde_json::to_vec(&device_state),
                        Err(err) => serde_json::to_vec(&DeviceState::error(&format!(
                            "invalid state: {err}"
                        ))),
                    };

                    if let Ok(bytes) = payload {
                        let _ = stream.write_all(&bytes).await;
                    }
                    let _ = stream.shutdown().await;
                }
                Err(err) => {
                    eprintln!("status ipc accept error: {err}");
                    break;
                }
            }
        }
    });

    Ok(task)
}

#[cfg(not(unix))]
pub fn spawn_status_server(_: Arc<Mutex<ServiceState>>) -> Result<JoinHandle<()>> {
    Err(anyhow!(
        "status server is only available on unix via UDS transport"
    ))
}

pub(crate) fn snapshot_state(state: &Arc<Mutex<ServiceState>>) -> Result<DeviceState> {
    let guard = state.lock();
    let channel = match guard.vault.payload.config.update_channel.as_str() {
        "stable" => UpdateChannel::Stable,
        "beta" => UpdateChannel::Beta,
        other => return Err(anyhow!("unknown update channel: {other}")),
    };

    if guard
        .vault
        .payload
        .state
        .installed_version
        .trim()
        .is_empty()
    {
        return Err(anyhow!("installed version missing"));
    }

    let updates = UpdateState {
        installed_version: guard.vault.payload.state.installed_version.clone(),
        channel,
        update_available: guard.update_available,
    };

    let remote_activity = guard
        .last_remote_command
        .as_ref()
        .map(|rc: &RemoteCommandRecord| RemoteActivity {
            command: rc.command.clone(),
            timestamp: rc.timestamp.to_rfc3339_opts(SecondsFormat::Millis, true),
            status: rc.status.clone(),
        });

    let last_heartbeat = guard
        .last_heartbeat
        .map(|t| t.to_rfc3339_opts(SecondsFormat::Secs, true));

    if guard.vault.payload.device_id.trim().is_empty() {
        return Err(anyhow!("device id missing"));
    }

    Ok(DeviceState {
        connected: guard.connected,
        last_heartbeat,
        device_id: Some(guard.vault.payload.device_id.clone()),
        security_profile: Some(guard.vault.payload.security_profile.clone()),
        remote_activity,
        updates: Some(updates),
        safe_mode: Some(guard.safe_mode.active),
        safe_mode_reason: guard.safe_mode.reason.clone(),
    })
}
