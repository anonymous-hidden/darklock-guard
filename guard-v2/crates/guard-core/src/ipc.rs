use anyhow::{anyhow, Result};
use crate::settings::GuardSettings;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

pub const IPC_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientHello {
    pub protocol_version: u32,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerChallenge {
    pub session_id: String,
    pub server_nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientAuth {
    pub session_id: String,
    pub client_nonce: String,
    pub proof: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthOk {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum IpcEnvelope {
    ClientHello(ClientHello),
    ServerChallenge(ServerChallenge),
    ClientAuth(ClientAuth),
    AuthOk(AuthOk),
    Error { message: String },
    Request(RequestEnvelope),
    Response(ResponseEnvelope),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestEnvelope {
    pub session_id: String,
    pub nonce: u64,
    pub request: IpcRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseEnvelope {
    pub session_id: String,
    pub nonce: u64,
    pub response: IpcResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "request", content = "data")]
pub enum IpcRequest {
    Ping,
    GetStatus,
    GetSettings,
    UpdateSettings {
        settings: GuardSettings,
    },
    EnterSafeMode {
        reason: String,
    },
    ExitSafeMode {
        password: String,
    },
    CheckUpdate {
        manifest_path: String,
    },
    StageUpdate {
        manifest_path: String,
    },
    InstallUpdate {
        package_path: String,
        version_file: String,
    },
    RollbackUpdate {
        backup_manifest: String,
    },
    GetEvents {
        since: Option<String>,  // ISO 8601 timestamp
        limit: Option<usize>,
    },
    TriggerScan,
    // ── New commands per architecture spec ───────────────────────────────
    MaintenanceEnter {
        reason: String,
        timeout_secs: u64,
    },
    MaintenanceExit {
        rebaseline: bool,
    },
    SetProtectedPaths {
        paths: Vec<String>,
    },
    BaselineCreate,
    BaselineVerify,
    RestoreNow {
        path: String,
    },
    GetEngineMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "response", content = "data")]
pub enum IpcResponse {
    Pong,
    Status {
        ok: bool,
    },
    Settings {
        settings: GuardSettings,
    },
    SettingsUpdated,
    SafeModeEntered,
    SafeModeExited,
    UpdateChecked {
        available: bool,
        version: Option<String>,
    },
    UpdateStaged {
        package_path: String,
    },
    UpdateInstalled {
        backup_manifest: String,
    },
    UpdateRolledBack,
    Events {
        events: Vec<serde_json::Value>,
    },
    ScanComplete {
        result: serde_json::Value,
    },
    // ── New responses per architecture spec ──────────────────────────────
    MaintenanceEntered,
    MaintenanceExited {
        rebaselined: bool,
    },
    ProtectedPathsUpdated,
    BaselineCreated {
        entries: usize,
    },
    BaselineVerified {
        valid: bool,
        detail: serde_json::Value,
    },
    RestoreResult {
        path: String,
        outcome: String,
    },
    EngineModeInfo {
        mode: serde_json::Value,
    },
}

#[derive(Debug, Clone)]
pub struct SessionState {
    pub last_nonce: u64,
}

pub struct IpcAuthContext {
    shared_secret: Vec<u8>,
    sessions: Arc<Mutex<HashMap<String, SessionState>>>,
}

impl IpcAuthContext {
    pub fn new(shared_secret: Vec<u8>) -> Self {
        Self {
            shared_secret,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn compute_proof(&self, server_nonce: &str, client_nonce: &str) -> Result<String> {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.shared_secret)
            .map_err(|e| anyhow!("mac init: {e}"))?;
        mac.update(server_nonce.as_bytes());
        mac.update(client_nonce.as_bytes());
        Ok(hex::encode(mac.finalize().into_bytes()))
    }

    pub async fn register_session(&self, session_id: String) {
        let mut guard = self.sessions.lock().await;
        guard.insert(session_id, SessionState { last_nonce: 0 });
    }

    pub async fn verify_and_update_nonce(&self, session_id: &str, nonce: u64) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow!("unknown session"))?;
        if nonce <= session.last_nonce {
            return Err(anyhow!("replay detected: nonce not increasing"));
        }
        session.last_nonce = nonce;
        Ok(())
    }
}

pub struct IpcServer {
    auth: Arc<IpcAuthContext>,
    socket_path: std::path::PathBuf,
}

impl IpcServer {
    pub fn new(auth_secret: Vec<u8>, socket_path: std::path::PathBuf) -> Self {
        Self {
            auth: Arc::new(IpcAuthContext::new(auth_secret)),
            socket_path,
        }
    }

    #[cfg(unix)]
    pub async fn start(self: Arc<Self>, handler: Arc<dyn IpcHandler + Send + Sync>) -> Result<()> {
        use tokio::net::UnixListener;
        if self.socket_path.exists() {
            let _ = std::fs::remove_file(&self.socket_path);
        }
        let listener = UnixListener::bind(&self.socket_path)?;
        loop {
            let (stream, _addr) = listener.accept().await?;
            let auth = self.auth.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_connection(stream, auth, handler).await {
                    eprintln!("ipc connection error: {e}");
                }
            });
        }
    }

    #[cfg(windows)]
    pub async fn start(self: Arc<Self>, handler: Arc<dyn IpcHandler + Send + Sync>) -> Result<()> {
        use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
        loop {
            let server: NamedPipeServer = ServerOptions::new()
                .first_pipe_instance(true)
                .create(&self.socket_path)?;
            server.connect().await?;
            let auth = self.auth.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_connection(server, auth, handler).await {
                    eprintln!("ipc connection error: {e}");
                }
            });
        }
    }
}

#[async_trait::async_trait]
pub trait IpcHandler {
    async fn handle(&self, req: IpcRequest) -> Result<IpcResponse>;
    async fn enter_safe_mode(&self, reason: String) -> Result<IpcResponse>;
    async fn exit_safe_mode(&self, password: String) -> Result<IpcResponse>;
}

async fn handle_connection<S>(
    stream: S,
    auth: Arc<IpcAuthContext>,
    handler: Arc<dyn IpcHandler + Send + Sync>,
) -> Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (read_half, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(read_half);

    // Expect ClientHello
    let mut line = String::new();
    let n = reader.read_line(&mut line).await?;
    if n == 0 {
        return Err(anyhow!("empty hello"));
    }
    let envelope: IpcEnvelope = serde_json::from_str(&line.trim_end())?;
    let hello = match envelope {
        IpcEnvelope::ClientHello(h) => h,
        _ => return Err(anyhow!("expected ClientHello")),
    };
    if hello.protocol_version != IPC_PROTOCOL_VERSION {
        writer
            .write_all(
                serde_json::to_string(&IpcEnvelope::Error {
                    message: "protocol version mismatch".to_string(),
                })
                .unwrap()
                .as_bytes(),
            )
            .await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
        return Err(anyhow!("protocol version mismatch"));
    }
    if hello.client_id != "ui" {
        return Err(anyhow!("unauthorized client"));
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let mut server_nonce_bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut server_nonce_bytes);
    let server_nonce = hex::encode(server_nonce_bytes);

    let challenge = IpcEnvelope::ServerChallenge(ServerChallenge {
        session_id: session_id.clone(),
        server_nonce: server_nonce.clone(),
    });
    writer
        .write_all(serde_json::to_string(&challenge)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;

    line.clear();
    let n = reader.read_line(&mut line).await?;
    if n == 0 {
        return Err(anyhow!("missing client auth"));
    }
    let envelope: IpcEnvelope = serde_json::from_str(&line.trim_end())?;
    let auth_msg = match envelope {
        IpcEnvelope::ClientAuth(m) => m,
        _ => return Err(anyhow!("expected ClientAuth")),
    };
    if auth_msg.session_id != session_id {
        return Err(anyhow!("session id mismatch"));
    }
    let expected = auth.compute_proof(&server_nonce, &auth_msg.client_nonce)?;
    if expected != auth_msg.proof {
        return Err(anyhow!("invalid proof"));
    }

    auth.register_session(session_id.clone()).await;
    let ok = IpcEnvelope::AuthOk(AuthOk {
        session_id: session_id.clone(),
    });
    writer
        .write_all(serde_json::to_string(&ok)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;

    // Process requests
    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        let env: IpcEnvelope = serde_json::from_str(&line.trim_end())?;
        let req_env = match env {
            IpcEnvelope::Request(r) => r,
            _ => return Err(anyhow!("expected Request envelope")),
        };
        if req_env.session_id != session_id {
            return Err(anyhow!("session mismatch"));
        }
        auth.verify_and_update_nonce(&session_id, req_env.nonce)
            .await?;
        let resp = match req_env.request {
            IpcRequest::Ping => IpcResponse::Pong,
            IpcRequest::GetStatus => handler.handle(IpcRequest::GetStatus).await?,
            IpcRequest::EnterSafeMode { reason } => handler.enter_safe_mode(reason).await?,
            IpcRequest::ExitSafeMode { password } => handler.exit_safe_mode(password).await?,
            other => handler.handle(other).await?,
        };
        let response_env = IpcEnvelope::Response(ResponseEnvelope {
            session_id: session_id.clone(),
            nonce: req_env.nonce,
            response: resp,
        });
        writer
            .write_all(serde_json::to_string(&response_env)?.as_bytes())
            .await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn proof_changes_with_nonce() {
        let ctx = IpcAuthContext::new(vec![1, 2, 3, 4]);
        let p1 = ctx.compute_proof("abc", "def").unwrap();
        let p2 = ctx.compute_proof("abc", "xyz").unwrap();
        assert_ne!(p1, p2);
    }

    #[tokio::test]
    async fn nonce_replay_rejected() {
        let ctx = IpcAuthContext::new(vec![1, 2, 3, 4]);
        ctx.register_session("s1".to_string()).await;
        ctx.verify_and_update_nonce("s1", 1).await.unwrap();
        assert!(ctx.verify_and_update_nonce("s1", 1).await.is_err());
    }
}
