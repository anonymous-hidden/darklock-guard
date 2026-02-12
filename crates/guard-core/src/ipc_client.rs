use crate::ipc::{AuthOk, ClientAuth, ClientHello, IpcEnvelope, IpcRequest, IpcResponse, RequestEnvelope, ServerChallenge, IPC_PROTOCOL_VERSION};
use anyhow::{anyhow, Result};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

fn compute_proof(secret: &[u8], server_nonce: &str, client_nonce: &str) -> Result<String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret)
        .map_err(|e| anyhow!("mac init: {e}"))?;
    mac.update(server_nonce.as_bytes());
    mac.update(client_nonce.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

pub async fn send_request(
    socket_path: std::path::PathBuf,
    secret: &[u8],
    request: IpcRequest,
) -> Result<IpcResponse> {
    #[cfg(unix)]
    let stream = UnixStream::connect(socket_path).await?;

    #[cfg(windows)]
    let stream = ClientOptions::new()
        .open(socket_path)
        .map_err(|e| anyhow!("ipc connect: {e}"))?;

    let (read_half, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(read_half);

    let client_hello = ClientHello {
        protocol_version: IPC_PROTOCOL_VERSION,
        client_id: "ui".to_string(),
    };
    let hello = IpcEnvelope::ClientHello(client_hello);
    writer
        .write_all(serde_json::to_string(&hello)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;

    let mut line = String::new();
    reader.read_line(&mut line).await?;
    let challenge: IpcEnvelope = serde_json::from_str(line.trim_end())?;
    let ServerChallenge {
        session_id,
        server_nonce,
    } = match challenge {
        IpcEnvelope::ServerChallenge(c) => c,
        IpcEnvelope::Error { message } => return Err(anyhow!(message)),
        _ => return Err(anyhow!("expected ServerChallenge")),
    };

    let mut nonce_bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let client_nonce = hex::encode(nonce_bytes);
    let proof = compute_proof(secret, &server_nonce, &client_nonce)?;

    let auth = IpcEnvelope::ClientAuth(ClientAuth {
        session_id: session_id.clone(),
        client_nonce,
        proof,
    });
    writer
        .write_all(serde_json::to_string(&auth)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;

    line.clear();
    reader.read_line(&mut line).await?;
    let auth_ok: IpcEnvelope = serde_json::from_str(line.trim_end())?;
    let AuthOk { session_id } = match auth_ok {
        IpcEnvelope::AuthOk(ok) => ok,
        IpcEnvelope::Error { message } => return Err(anyhow!(message)),
        _ => return Err(anyhow!("expected AuthOk")),
    };

    let request_envelope = IpcEnvelope::Request(RequestEnvelope {
        session_id,
        nonce: 1,
        request,
    });
    writer
        .write_all(serde_json::to_string(&request_envelope)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;

    line.clear();
    reader.read_line(&mut line).await?;
    let response: IpcEnvelope = serde_json::from_str(line.trim_end())?;
    match response {
        IpcEnvelope::Response(envelope) => Ok(envelope.response),
        IpcEnvelope::Error { message } => Err(anyhow!(message)),
        _ => Err(anyhow!("unexpected response")),
    }
}
