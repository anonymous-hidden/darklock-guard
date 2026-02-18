use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use guard_core::ipc::{
    AuthOk, ClientAuth, ClientHello, IpcEnvelope, IpcRequest, IpcResponse, RequestEnvelope,
    ResponseEnvelope, IPC_PROTOCOL_VERSION,
};
use guard_core::paths::{ipc_socket_path, status_socket_path};
use guard_core::secure_storage::get_ipc_secret;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

async fn get_device_id() -> Result<String> {
    let socket_path = status_socket_path()?;
    let mut stream = UnixStream::connect(&socket_path).await?;
    let mut data = Vec::new();
    stream.read_to_end(&mut data).await?;
    let status: serde_json::Value = serde_json::from_slice(&data)?;
    let device_id = status["deviceId"]
        .as_str()
        .ok_or_else(|| anyhow!("deviceId not found in status"))?;
    Ok(device_id.to_string())
}

#[derive(Parser)]
#[command(name = "guard-cli")]
#[command(about = "CLI for Darklock Guard IPC control", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Get service status
    Status,
    
    /// Get current settings
    GetSettings,
    
    /// Set protected paths
    SetPaths {
        /// Paths to protect (directories or files)
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    
    /// Create baseline from protected paths
    CreateBaseline,
    
    /// Trigger a manual scan
    Scan,
    
    /// Enter safe mode
    SafeModeEnter {
        /// Reason for entering safe mode
        #[arg(default_value = "manual")]
        reason: String,
    },
    
    /// Exit safe mode
    SafeModeExit {
        /// Vault password
        password: String,
    },
    
    /// Get recent events
    GetEvents {
        /// Maximum number of events to retrieve
        #[arg(short, long, default_value = "50")]
        limit: usize,
    },
}

struct IpcClient {
    stream: UnixStream,
    session_id: String,
    nonce: u64,
    shared_secret: Vec<u8>,
}

impl IpcClient {
    async fn connect() -> Result<Self> {
        // First get device_id from status socket
        let device_id = get_device_id().await?;
        
        // Get IPC shared secret from keyring
        let shared_secret = get_ipc_secret(&device_id)?;

        // Connect to socket
        let socket_path = ipc_socket_path()?;
        let stream = UnixStream::connect(&socket_path).await?;

        let mut client = Self {
            stream,
            session_id: String::new(),
            nonce: 0,
            shared_secret,
        };

        client.handshake().await?;
        Ok(client)
    }

    async fn handshake(&mut self) -> Result<()> {
        let (read_half, mut write_half) = self.stream.split();
        let mut reader = BufReader::new(read_half);

        // Send ClientHello
        let hello = IpcEnvelope::ClientHello(ClientHello {
            protocol_version: IPC_PROTOCOL_VERSION,
            client_id: "ui".to_string(),
        });
        write_half
            .write_all(serde_json::to_string(&hello)?.as_bytes())
            .await?;
        write_half.write_all(b"\n").await?;
        write_half.flush().await?;

        // Receive ServerChallenge
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        let envelope: IpcEnvelope = serde_json::from_str(&line.trim_end())?;
        let challenge = match envelope {
            IpcEnvelope::ServerChallenge(c) => c,
            IpcEnvelope::Error { message } => return Err(anyhow!("server error: {message}")),
            _ => return Err(anyhow!("expected ServerChallenge")),
        };

        self.session_id = challenge.session_id.clone();

        // Generate client nonce
        let mut client_nonce_bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut client_nonce_bytes);
        let client_nonce = hex::encode(client_nonce_bytes);

        // Compute proof
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.shared_secret)
            .map_err(|e| anyhow!("mac init: {e}"))?;
        mac.update(challenge.server_nonce.as_bytes());
        mac.update(client_nonce.as_bytes());
        let proof = hex::encode(mac.finalize().into_bytes());

        // Send ClientAuth
        let auth = IpcEnvelope::ClientAuth(ClientAuth {
            session_id: challenge.session_id,
            client_nonce,
            proof,
        });
        write_half
            .write_all(serde_json::to_string(&auth)?.as_bytes())
            .await?;
        write_half.write_all(b"\n").await?;
        write_half.flush().await?;

        // Receive AuthOk
        line.clear();
        reader.read_line(&mut line).await?;
        let envelope: IpcEnvelope = serde_json::from_str(&line.trim_end())?;
        match envelope {
            IpcEnvelope::AuthOk(AuthOk { .. }) => Ok(()),
            IpcEnvelope::Error { message } => Err(anyhow!("auth failed: {message}")),
            _ => Err(anyhow!("expected AuthOk")),
        }
    }

    async fn send_request(&mut self, request: IpcRequest) -> Result<IpcResponse> {
        self.nonce += 1;
        let req_env = IpcEnvelope::Request(RequestEnvelope {
            session_id: self.session_id.clone(),
            nonce: self.nonce,
            request,
        });

        let (read_half, mut write_half) = self.stream.split();
        let mut reader = BufReader::new(read_half);

        write_half
            .write_all(serde_json::to_string(&req_env)?.as_bytes())
            .await?;
        write_half.write_all(b"\n").await?;
        write_half.flush().await?;

        let mut line = String::new();
        reader.read_line(&mut line).await?;
        let envelope: IpcEnvelope = serde_json::from_str(&line.trim_end())?;
        match envelope {
            IpcEnvelope::Response(ResponseEnvelope { response, .. }) => Ok(response),
            IpcEnvelope::Error { message } => Err(anyhow!("request failed: {message}")),
            _ => Err(anyhow!("unexpected response")),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    
    // Connect to IPC
    let mut client = IpcClient::connect().await?;
    
    match cli.command {
        Commands::Status => {
            let response = client.send_request(IpcRequest::GetStatus).await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::GetSettings => {
            let response = client.send_request(IpcRequest::GetSettings).await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::SetPaths { paths } => {
            // Convert to strings
            let path_strings: Vec<String> = paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            
            let response = client
                .send_request(IpcRequest::SetProtectedPaths {
                    paths: path_strings,
                })
                .await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::CreateBaseline => {
            let response = client.send_request(IpcRequest::BaselineCreate).await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::Scan => {
            let response = client.send_request(IpcRequest::TriggerScan).await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::SafeModeEnter { reason } => {
            let response = client
                .send_request(IpcRequest::EnterSafeMode { reason })
                .await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::SafeModeExit { password } => {
            let response = client
                .send_request(IpcRequest::ExitSafeMode { password })
                .await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
        
        Commands::GetEvents { limit } => {
            let response = client
                .send_request(IpcRequest::GetEvents {
                    since: None,
                    limit: Some(limit),
                })
                .await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
    }
    
    Ok(())
}
