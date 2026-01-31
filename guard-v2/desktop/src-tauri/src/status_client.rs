use anyhow::{anyhow, Result};
use guard_core::{device_state::DeviceState, paths::status_socket_path};
use serde_json::Value;

#[cfg(unix)]
use tokio::{io::AsyncReadExt, net::UnixStream};

#[cfg(unix)]
pub async fn fetch_device_state() -> Result<DeviceState> {
    let socket_path = status_socket_path()?;
    let mut stream = UnixStream::connect(socket_path)
        .await
        .map_err(|e| anyhow!("ipc connect failed: {e}"))?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).await?;
    parse_payload(&buf)
}

#[cfg(not(unix))]
pub async fn fetch_device_state() -> Result<DeviceState> {
    Err(anyhow!(
        "status IPC transport not available on this platform"
    ))
}

fn parse_payload(buf: &[u8]) -> Result<DeviceState> {
    let value: Value =
        serde_json::from_slice(buf).map_err(|e| anyhow!("ipc payload parse failed: {e}"))?;
    if let Some(err) = value.get("error").and_then(|v| v.as_str()) {
        return Err(anyhow!(err.to_string()));
    }
    serde_json::from_value::<DeviceState>(value)
        .map_err(|e| anyhow!("ipc payload decode failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use guard_core::device_state::RemoteActivityStatus;
    use tempfile::tempdir;
    use tokio::io::AsyncWriteExt;

    #[cfg(unix)]
    #[tokio::test]
    async fn device_state_success_round_trip() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("status.sock");
        std::env::set_var("GUARD_STATUS_SOCKET", &socket_path);

        let payload = serde_json::json!({
            "connected": true,
            "lastHeartbeat": "2026-01-30T12:00:00Z",
            "deviceId": "dev-123",
            "securityProfile": "ZERO_TRUST",
            "remoteActivity": {
                "command": "ENTER_SAFE_MODE",
                "timestamp": "2026-01-30T12:00:01Z",
                "status": "COMPLETED"
            },
            "updates": {
                "installedVersion": "2.0.0",
                "channel": "stable",
                "updateAvailable": false
            },
            "safeMode": true,
            "safeModeReason": "REMOTE_COMMAND"
        });

        let _ = std::fs::remove_file(&socket_path);
        let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
        let server_task = tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let bytes = serde_json::to_vec(&payload).unwrap();
                let _ = stream.write_all(&bytes).await;
                let _ = stream.shutdown().await;
            }
        });

        let state = fetch_device_state().await.unwrap();
        assert!(state.connected);
        assert_eq!(
            state.security_profile,
            Some(guard_core::vault::SecurityProfile::ZeroTrust)
        );
        assert_eq!(state.safe_mode, Some(true));
        assert_eq!(
            state.remote_activity.as_ref().unwrap().status,
            RemoteActivityStatus::Completed
        );
        assert_eq!(
            state.safe_mode_reason,
            Some(guard_core::safe_mode::SafeModeReason::RemoteCommand)
        );
        assert_eq!(
            state.remote_activity.as_ref().unwrap().command,
            "ENTER_SAFE_MODE"
        );

        server_task.abort();
        std::env::remove_var("GUARD_STATUS_SOCKET");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn device_state_error_when_service_stopped() {
        let dir = tempdir().unwrap();
        let socket_path = dir.path().join("missing.sock");
        std::env::set_var("GUARD_STATUS_SOCKET", &socket_path);

        let err = fetch_device_state().await.err().expect("should fail");
        assert!(
            err.to_string().contains("ipc connect failed")
                || err.to_string().contains("No such file")
        );

        std::env::remove_var("GUARD_STATUS_SOCKET");
    }
}
