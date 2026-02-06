use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand};
use guard_core::event_log::{EventLog, EventSeverity};
use guard_core::ipc::{IpcHandler, IpcRequest, IpcResponse, IpcServer};
use guard_core::paths::{data_dir, ipc_socket_path, log_dir};
use guard_core::safe_mode::{SafeModeReason, SafeModeState};
use guard_core::secure_storage::store_ipc_secret;
use guard_core::vault::{Vault, CURRENT_CONFIG_VERSION, VAULT_VERSION};
use parking_lot::Mutex;
use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tokio::signal;
use tracing::info;
use zeroize::Zeroizing;

mod connected;
mod engine;
mod status;
mod service_state;

use crate::engine::Engine;
use crate::service_state::{CrashTracker, ServiceState};

#[derive(Parser, Debug)]
#[command(author, version, about = "Darklock Guard v2 Service", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Initialize a new encrypted vault
    Init {
        #[arg(long)]
        data_dir: Option<PathBuf>,
    },
    /// Run the background service
    Run {
        #[arg(long)]
        data_dir: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    match cli.command {
        Commands::Init { data_dir } => init_command(data_dir).await,
        Commands::Run { data_dir } => run_command(data_dir).await,
    }
}

async fn init_command(data_dir_override: Option<PathBuf>) -> Result<()> {
    let data = data_dir_override.unwrap_or(data_dir()?);
    std::fs::create_dir_all(&data)?;
    std::fs::create_dir_all(log_dir()?)?;
    let vault_path = data.join("vault.dat");
    if vault_path.exists() {
        return Err(anyhow!("vault already exists at {}", vault_path.display()));
    }
    let password = prompt_password_twice("Create vault password")?;
    let vault = Vault::create_new(&vault_path, &password)?;
    println!(
        "Vault created: version {} config {}",
        VAULT_VERSION, CURRENT_CONFIG_VERSION
    );
    println!("Device ID: {}", vault.payload.device_id);
    Ok(())
}

async fn run_command(data_dir_override: Option<PathBuf>) -> Result<()> {
    let data = data_dir_override.unwrap_or(data_dir()?);
    std::fs::create_dir_all(&data)?;
    std::fs::create_dir_all(log_dir()?)?;
    let vault_path = data.join("vault.dat");
    if !vault_path.exists() {
        return Err(anyhow!("vault missing; run init first"));
    }
    let password = prompt_password_once("Enter vault password")?;
    let vault = Vault::open(&vault_path, &password)?;
    let signing_key = vault.signing_key(&password)?;
    let log_path = log_dir()?.join("events.log");
    let event_log = EventLog::new(log_path, signing_key, 5 * 1024 * 1024)?;

    // crash-loop detection for Zero-Trust profile
    let crash_tracker = CrashTracker::new(data.join("crash-tracker.json"));
    let crash_count = crash_tracker.record_start()?;
    let mut safe_mode = SafeModeState::default();
    if crash_count >= 3
        && matches!(
            vault.payload.security_profile,
            guard_core::vault::SecurityProfile::ZeroTrust
        )
    {
        safe_mode.enter(SafeModeReason::ServiceCrashLoop);
        event_log.append(
            "SAFE_MODE_ENTERED",
            EventSeverity::Critical,
            serde_json::json!({"reason": "SERVICE_CRASH_LOOP", "crash_count": crash_count}),
        )?;
    } else if vault.payload.state.safe_mode {
        safe_mode.enter(SafeModeReason::Unknown);
    }

    let ipc_secret = vault.ipc_shared_secret()?;
    store_ipc_secret(&vault.payload.device_id, &ipc_secret)?;
    let socket_path = ipc_socket_path()?;

    let initial_connected = !matches!(vault.payload.mode, guard_core::vault::Mode::Connected);

    let engine = Engine::load_from_vault(&vault)?;
    let state = Arc::new(Mutex::new(ServiceState {
        vault_path,
        vault,
        engine,
        event_log,
        safe_mode,
        password: Zeroizing::new(password),
        connected: initial_connected,
        last_heartbeat: None,
        last_remote_command: None,
        update_available: false,
        _crash_tracker: crash_tracker,
    }));

    let updater_path = {
        let mut p = install_dir()?;
        #[cfg(windows)]
        {
            p.push("updater-helper.exe");
        }
        #[cfg(not(windows))]
        {
            p.push("updater-helper");
        }
        p
    };

    let handler = Arc::new(ServiceHandler {
        state: state.clone(),
        updater_path,
    });
    let server = Arc::new(IpcServer::new(ipc_secret, socket_path));
    #[cfg(unix)]
    let status_task = status::spawn_status_server(state.clone())?;
    #[cfg(not(unix))]
    let status_task: Option<tokio::task::JoinHandle<()>> = None;

    let connected_task = match connected::maybe_start_connected(state.clone()) {
        Ok(handle_opt) => handle_opt,
        Err(err) => {
            info!("connected mode disabled: {err}");
            None
        }
    };

    let server_task = {
        let server = server.clone();
        let handler = handler.clone();
        tokio::spawn(async move { server.start(handler).await })
    };

    info!("service started");
    signal::ctrl_c().await?;
    info!("service stopping");
    server_task.abort();
    if let Some(task) = connected_task {
        task.abort();
    }
    #[cfg(unix)]
    status_task.abort();
    Ok(())
}

struct ServiceHandler {
    state: Arc<Mutex<ServiceState>>,
    updater_path: PathBuf,
}

#[async_trait::async_trait]
impl IpcHandler for ServiceHandler {
    async fn handle(&self, req: IpcRequest) -> Result<IpcResponse> {
        match req {
            IpcRequest::GetStatus => {
                let state = self.state.lock();
                Ok(IpcResponse::Status {
                    ok: !state.safe_mode.active,
                })
            }
            IpcRequest::GetSettings => {
                let state = self.state.lock();
                Ok(IpcResponse::Settings {
                    settings: state.engine.settings(),
                })
            }
            IpcRequest::UpdateSettings { settings } => {
                let mut state = self.state.lock();
                state
                    .engine
                    .update_settings(&mut state.vault, settings)
                    .map_err(|e| anyhow!(e.to_string()))?;
                Ok(IpcResponse::SettingsUpdated)
            }
            IpcRequest::CheckUpdate { manifest_path } => {
                let manifest = load_manifest(&manifest_path)?;
                {
                    let mut guard = self.state.lock();
                    guard.update_available = true;
                    guard.vault.payload.state.last_update_check = Some(Utc::now());
                    let password = guard.password.clone();
                    guard.vault.save(&password)?;
                }
                Ok(IpcResponse::UpdateChecked {
                    available: true,
                    version: Some(manifest.version),
                })
            }
            IpcRequest::StageUpdate { manifest_path } => {
                let out =
                    run_updater(&self.updater_path, &["stage", "--manifest", &manifest_path])?;
                {
                    let mut guard = self.state.lock();
                    guard.update_available = true;
                }
                Ok(IpcResponse::UpdateStaged {
                    package_path: out.trim().to_string(),
                })
            }
            IpcRequest::InstallUpdate {
                package_path,
                version_file,
            } => {
                let manifest = load_manifest(&version_file)?;
                let data_dir = data_dir()?;
                let backup_dir = data_dir.join("rollback");
                let install = install_dir()?.to_string_lossy().to_string();
                let backup = backup_dir.to_string_lossy().to_string();
                let args = vec![
                    "install",
                    "--package",
                    &package_path,
                    "--install-dir",
                    &install,
                    "--backup-dir",
                    &backup,
                    "--version-file",
                    &version_file,
                ];
                let backup_manifest = run_updater(&self.updater_path, &args)?;
                {
                    let mut guard = self.state.lock();
                    guard.update_available = false;
                    guard.vault.payload.state.installed_version = manifest.version.clone();
                    let password = guard.password.clone();
                    guard.vault.save(&password)?;
                }
                Ok(IpcResponse::UpdateInstalled {
                    backup_manifest: backup_manifest.trim().to_string(),
                })
            }
            IpcRequest::RollbackUpdate { backup_manifest } => {
                let install = install_dir()?.to_string_lossy().to_string();
                let args = vec![
                    "rollback",
                    "--backup-manifest",
                    &backup_manifest,
                    "--install-dir",
                    &install,
                ];
                run_updater(&self.updater_path, &args)?;
                Ok(IpcResponse::UpdateRolledBack)
            }
            _ => Err(anyhow!("unsupported request")),
        }
    }

    async fn enter_safe_mode(&self, reason: String) -> Result<IpcResponse> {
        let mut state = self.state.lock();
        state.safe_mode.enter(SafeModeReason::Manual);
        state.event_log.append(
            "SAFE_MODE_ENTERED",
            EventSeverity::Critical,
            serde_json::json!({"reason": reason}),
        )?;
        Ok(IpcResponse::SafeModeEntered)
    }

    async fn exit_safe_mode(&self, password: String) -> Result<IpcResponse> {
        let mut state = self.state.lock();
        // verify password by opening vault
        let vault = Vault::open(&state.vault_path, &password)?;
        state.vault = vault;
        state.password = Zeroizing::new(password);
        state.safe_mode.exit();
        state.event_log.append(
            "SAFE_MODE_EXITED",
            EventSeverity::Info,
            serde_json::json!({"manual": true}),
        )?;
        Ok(IpcResponse::SafeModeExited)
    }
}

fn prompt_password_once(prompt: &str) -> Result<String> {
    if let Ok(pw) = std::env::var("GUARD_VAULT_PASSWORD") {
        if !pw.is_empty() {
            return Ok(pw);
        }
    }
    let pw = rpassword::prompt_password(prompt).map_err(|e| anyhow!("password prompt: {e}"))?;
    if pw.len() < 12 {
        return Err(anyhow!("password too short; minimum 12 characters"));
    }
    Ok(pw)
}

fn prompt_password_twice(prompt: &str) -> Result<String> {
    if let Ok(pw) = std::env::var("GUARD_VAULT_PASSWORD") {
        if !pw.is_empty() {
            if let Ok(confirm) = std::env::var("GUARD_VAULT_PASSWORD_CONFIRM") {
                if confirm != pw {
                    return Err(anyhow!("password confirmation mismatch"));
                }
            }
            return Ok(pw);
        }
    }
    let first = prompt_password_once(prompt)?;
    let second = rpassword::prompt_password("Confirm password")
        .map_err(|e| anyhow!("password prompt: {e}"))?;
    if first != second {
        return Err(anyhow!("passwords do not match"));
    }
    Ok(first)
}

fn install_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    Ok(exe
        .parent()
        .ok_or_else(|| anyhow!("no parent for exe"))?
        .to_path_buf())
}

#[derive(Deserialize)]
struct ManifestView {
    version: String,
}

fn load_manifest(path: &str) -> Result<ManifestView> {
    let file = std::fs::File::open(path)?;
    let m: ManifestView = serde_json::from_reader(file)?;
    Ok(m)
}

fn run_updater(updater_path: &PathBuf, args: &[&str]) -> Result<String> {
    let output = Command::new(updater_path).args(args).output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("updater failed: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
