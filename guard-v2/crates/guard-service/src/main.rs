use anyhow::{anyhow, Result};
use chrono::Utc;
use clap::{Parser, Subcommand};
use guard_core::backup_store::BackupStore;
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
use std::time::Duration;
use tokio::signal;
use tokio::sync::watch;
use tracing::{info, warn};
use zeroize::Zeroizing;

mod connected;
mod enforcement;
mod engine;
pub mod integrity;
mod status;
mod service_state;

use crate::enforcement::quarantine::QuarantineZone;
use crate::enforcement::restore::RestoreEngine;
use crate::engine::Engine;
use crate::integrity::audit_loop::{spawn_audit_loop, AuditLoopHandle};
use crate::integrity::pipeline::spawn_watcher_pipeline;
use crate::integrity::scanner::{Baseline, IntegrityScanner};
use crate::integrity::watcher::FileWatcher;
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
    let signing_key_clone = signing_key.clone();
    let log_path = log_dir()?.join("events.log");
    let event_log = Arc::new(EventLog::new(log_path, signing_key, 5 * 1024 * 1024)?);

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

    let engine = Arc::new(Engine::load_from_vault(&vault)?);

    // Initialize integrity scanner with protected paths from settings
    let protected_paths = engine.settings().protection.protected_paths.clone()
        .into_iter().map(PathBuf::from).collect::<Vec<_>>();
    let scanner = if !protected_paths.is_empty() {
        Some(IntegrityScanner::new(protected_paths.clone(), vault.payload.device_id.clone()))
    } else {
        None
    };

    let baseline_path = data.join("baseline.json");

    // ── Initialize Backup Store ─────────────────────────────────────────
    let backups_root = data.join("backups");
    let mut backup_store = BackupStore::load_or_create(
        &backups_root,
        signing_key_clone.clone(),
        &vault.payload.device_id,
    )?;

    // ── Initialize Enforcement Engine ───────────────────────────────────
    let quarantine_root = data.join("quarantine");
    let quarantine = QuarantineZone::new(quarantine_root)?;
    let restore_engine = Arc::new(RestoreEngine::new(quarantine));

    // ── Global shutdown signal ──────────────────────────────────────────
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // ── Load or create initial baseline + populate backup store ─────────
    let initial_baseline: Option<Baseline> = if let Some(ref scanner) = scanner {
        if baseline_path.exists() {
            Some(IntegrityScanner::load_baseline(&baseline_path)?)
        } else {
            let baseline = scanner.generate_baseline(&signing_key_clone)?;
            IntegrityScanner::save_baseline(&baseline, &baseline_path)?;
            event_log.append(
                "BASELINE_CREATED",
                EventSeverity::Info,
                serde_json::json!({"files": baseline.entries.len()}),
            )?;
            // Populate backup store from initial baseline
            for (_key, entry) in &baseline.entries {
                let p = PathBuf::from(&entry.path);
                if p.exists() {
                    if let Err(e) = backup_store.ensure_from_disk(
                        &p,
                        &entry.hash,
                        entry.permissions,
                        None,
                    ) {
                        warn!(path = %entry.path, error = %e, "initial backup failed");
                    }
                }
            }
            Some(baseline)
        }
    } else {
        None
    };

    // ── Start FileWatcher ───────────────────────────────────────────────
    // Clean up orphaned staging files from a previous crash.
    if !protected_paths.is_empty() {
        RestoreEngine::cleanup_staging(&protected_paths);
    }

    let mut _file_watcher = None; // Must keep alive for the duration
    let mut watcher_pipeline_handle = None;
    let mut tamper_rx_opt = None;

    if !protected_paths.is_empty() && scanner.is_some() {
        // Check inotify watch limit on Linux before starting watcher.
        #[cfg(target_os = "linux")]
        {
            if let Ok(limit_str) = std::fs::read_to_string("/proc/sys/fs/inotify/max_user_watches") {
                if let Ok(limit) = limit_str.trim().parse::<u64>() {
                    // Rough estimate: count files in protected paths
                    let mut file_count: u64 = 0;
                    for p in &protected_paths {
                        if p.is_dir() {
                            file_count += walkdir::WalkDir::new(p).into_iter().count() as u64;
                        } else {
                            file_count += 1;
                        }
                    }
                    if file_count > limit / 2 {
                        warn!(
                            file_count,
                            inotify_limit = limit,
                            "protected files ({file_count}) exceed 50% of inotify watch limit ({limit}). \
                            Consider: sysctl fs.inotify.max_user_watches={}",
                            file_count * 2
                        );
                    }
                }
            }
        }
        if let Ok((mut fw, raw_rx)) = FileWatcher::new() {
            if let Err(e) = fw.watch_paths(&protected_paths) {
                warn!(error = %e, "failed to start file watcher");
            }

            let baseline_for_pipeline = initial_baseline.clone();
            let baseline_arc = Arc::new(parking_lot::Mutex::new(baseline_for_pipeline));
            let baseline_fn = {
                let b = baseline_arc.clone();
                Arc::new(move || b.lock().clone()) as Arc<dyn Fn() -> Option<Baseline> + Send + Sync>
            };

            let (handle, tamper_tx) = spawn_watcher_pipeline(
                raw_rx,
                baseline_fn,
                restore_engine.restoring.clone(),
                shutdown_rx.clone(),
            );
            watcher_pipeline_handle = Some(handle);
            tamper_rx_opt = Some(tamper_tx.subscribe());
            _file_watcher = Some(fw);
        }
    }

    // ── Start Audit Loop ────────────────────────────────────────────────
    // Wrap BackupStore in Arc<Mutex<>> so it can be shared with async tasks.
    let backup_store = Arc::new(parking_lot::Mutex::new(backup_store));
    let mut audit_loop_handle_opt: Option<AuditLoopHandle> = None;

    if let Some(ref scanner) = scanner {
        let scanner_arc = Arc::new(scanner.clone());
        let bl_path = baseline_path.clone();
        let baseline_loader: Arc<dyn Fn() -> Option<Baseline> + Send + Sync> =
            Arc::new(move || IntegrityScanner::load_baseline(&bl_path).ok());

        let engine_for_audit = engine.clone();
        let restore_for_audit = restore_engine.clone();
        let event_log_for_audit = event_log.clone();
        let bl_for_audit = initial_baseline.clone();
        let backup_for_audit = backup_store.clone();
        let on_result = move |result: crate::integrity::scanner::ScanResult| {
            if let Some(ref baseline) = bl_for_audit {
                let store_guard = backup_for_audit.lock();
                engine_for_audit.handle_scan_result(
                    &result,
                    &restore_for_audit,
                    &store_guard,
                    baseline,
                    &event_log_for_audit,
                );
            }
        };

        let (_audit_handle, audit_ctl) = spawn_audit_loop(
            scanner_arc,
            Duration::from_secs(300), // 5 minutes
            baseline_loader,
            on_result,
        );
        audit_loop_handle_opt = Some(audit_ctl);
    }

    // ── Start maintenance watcher + daily anchor ────────────────────────
    let maint_handle = engine::spawn_maintenance_watcher(
        engine.clone(),
        event_log.clone(),
        shutdown_rx.clone(),
    );
    let anchor_handle = engine::spawn_daily_anchor(
        engine.clone(),
        event_log.clone(),
        data.clone(),
        shutdown_rx.clone(),
    );

    // ── Tamper event consumer task ──────────────────────────────────────
    let tamper_consumer = if let Some(mut tamper_rx) = tamper_rx_opt {
        let engine_c = engine.clone();
        let restore_c = restore_engine.clone();
        let event_log_c = event_log.clone();
        let bl = Arc::new(parking_lot::Mutex::new(initial_baseline.clone()));
        let backup_c = backup_store.clone();
        let handle = tokio::spawn(async move {
            loop {
                match tamper_rx.recv().await {
                    Ok(event) => {
                        // Route through the orchestrator for mode-aware enforcement.
                        let baseline_guard = bl.lock();
                        if let Some(ref baseline) = *baseline_guard {
                            let store_guard = backup_c.lock();
                            engine_c.handle_tamper_event(
                                &event,
                                &restore_c,
                                &store_guard,
                                baseline,
                                &event_log_c,
                            );
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!(missed = n, "tamper consumer lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Some(handle)
    } else {
        None
    };

    let state = Arc::new(Mutex::new(ServiceState {
        vault_path,
        vault,
        engine: engine.clone(),
        event_log: event_log.clone(),
        safe_mode,
        password: Zeroizing::new(password),
        connected: initial_connected,
        last_heartbeat: None,
        last_remote_command: None,
        update_available: false,
        _crash_tracker: crash_tracker,
        scanner,
        signing_key: signing_key_clone,
        baseline_path,
        data_dir: data.clone(),
        backup_store: backup_store.clone(),
        restore_engine: restore_engine.clone(),
        audit_loop_handle: audit_loop_handle_opt,
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

    // Log service start
    event_log.append(
        "SERVICE_START",
        EventSeverity::Info,
        serde_json::json!({}),
    )?;

    info!("service started – all subsystems online");
    signal::ctrl_c().await?;
    info!("service stopping");

    // Signal shutdown to all tasks
    let _ = shutdown_tx.send(true);

    // Log service stop
    let _ = event_log.append(
        "SERVICE_STOP",
        EventSeverity::Info,
        serde_json::json!({}),
    );

    server_task.abort();
    maint_handle.abort();
    anchor_handle.abort();
    if let Some(task) = connected_task {
        task.abort();
    }
    if let Some(handle) = watcher_pipeline_handle {
        handle.abort();
    }
    if let Some(handle) = tamper_consumer {
        handle.abort();
    }
    #[cfg(unix)]
    status_task.abort();
    Ok(()
    )
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
                let st = &mut *state;
                st.engine
                    .update_settings(&mut st.vault, settings)
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
            IpcRequest::GetEvents { since, limit } => {
                let state = self.state.lock();
                let since_dt = since.and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(&s)
                        .ok()
                        .map(|dt| dt.with_timezone(&Utc))
                });
                let entries = state.event_log.read_recent(since_dt, limit)
                    .unwrap_or_default();
                let events: Vec<serde_json::Value> = entries
                    .into_iter()
                    .map(|e| serde_json::to_value(e).unwrap_or_default())
                    .collect();
                Ok(IpcResponse::Events { events })
            }
            IpcRequest::TriggerScan => {
                let state = self.state.lock();
                if let Some(ref scanner) = state.scanner {
                    let baseline = if state.baseline_path.exists() {
                        IntegrityScanner::load_baseline(&state.baseline_path)?
                    } else {
                        let baseline = scanner.generate_baseline(&state.signing_key)?;
                        IntegrityScanner::save_baseline(&baseline, &state.baseline_path)?;
                        state.event_log.append(
                            "BASELINE_CREATED",
                            EventSeverity::Info,
                            serde_json::json!({"files": baseline.entries.len()}),
                        )?;
                        baseline
                    };
                    let result = scanner.scan_against_baseline(&baseline);
                    if !result.valid {
                        state.event_log.append(
                            "INTEGRITY_VIOLATION",
                            EventSeverity::Critical,
                            serde_json::json!({
                                "modified": result.modified.len(),
                                "removed": result.removed.len(),
                                "added": result.added.len()
                            }),
                        )?;
                    }
                    let result_json = serde_json::to_value(&result)
                        .unwrap_or_else(|_| serde_json::json!({"error": "serialization failed"}));
                    Ok(IpcResponse::ScanComplete { result: result_json })
                } else {
                    Ok(IpcResponse::ScanComplete {
                        result: serde_json::json!({
                            "error": "No protected paths configured",
                            "valid": true,
                            "total_files": 0
                        }),
                    })
                }
            }

            // ── New commands ────────────────────────────────────────────
            IpcRequest::MaintenanceEnter {
                reason,
                timeout_secs,
            } => {
                let state = self.state.lock();
                state
                    .engine
                    .enter_maintenance(reason, timeout_secs, &state.event_log)?;
                Ok(IpcResponse::MaintenanceEntered)
            }
            IpcRequest::MaintenanceExit { rebaseline } => {
                let mut state = self.state.lock();
                let st = &mut *state;
                let mut store_guard = st.backup_store.lock();
                let new_bl = st.engine.exit_maintenance(
                    rebaseline,
                    st.scanner.as_ref(),
                    &st.signing_key,
                    &st.baseline_path,
                    &mut *store_guard,
                    &st.event_log,
                    &st.data_dir,
                )?;
                Ok(IpcResponse::MaintenanceExited {
                    rebaselined: new_bl.is_some(),
                })
            }
            IpcRequest::SetProtectedPaths { paths } => {
                let mut state = self.state.lock();
                let st = &mut *state;
                let mut settings = st.engine.settings();
                settings.protection.protected_paths = paths;
                st.engine
                    .update_settings(&mut st.vault, settings)
                    .map_err(|e| anyhow!(e.to_string()))?;
                Ok(IpcResponse::ProtectedPathsUpdated)
            }
            IpcRequest::BaselineCreate => {
                let mut state = self.state.lock();
                let st = &mut *state;
                if let Some(ref scanner) = st.scanner {
                    let baseline = scanner.generate_baseline(&st.signing_key)?;
                    IntegrityScanner::save_baseline(&baseline, &st.baseline_path)?;
                    let entries = baseline.entries.len();
                    st.event_log.append(
                        "BASELINE_CREATED",
                        EventSeverity::Info,
                        serde_json::json!({"files": entries}),
                    )?;
                    Ok(IpcResponse::BaselineCreated { entries })
                } else {
                    Err(anyhow!("no protected paths configured"))
                }
            }
            IpcRequest::BaselineVerify => {
                let state = self.state.lock();
                if let Some(ref scanner) = state.scanner {
                    if state.baseline_path.exists() {
                        let baseline =
                            IntegrityScanner::load_baseline(&state.baseline_path)?;
                        let verifying_key = state.signing_key.verifying_key();
                        let sig_valid =
                            IntegrityScanner::verify_baseline_signature(&baseline, &verifying_key)
                                .unwrap_or(false);
                        let result = scanner.scan_against_baseline(&baseline);
                        let detail = serde_json::json!({
                            "signature_valid": sig_valid,
                            "total_files": result.total_files,
                            "modified": result.modified.len(),
                            "removed": result.removed.len(),
                            "added": result.added.len(),
                        });
                        Ok(IpcResponse::BaselineVerified {
                            valid: result.valid && sig_valid,
                            detail,
                        })
                    } else {
                        Err(anyhow!("no baseline exists"))
                    }
                } else {
                    Err(anyhow!("no protected paths configured"))
                }
            }
            IpcRequest::RestoreNow { path } => {
                let state = self.state.lock();
                let target = PathBuf::from(&path);
                if state.baseline_path.exists() {
                    let baseline =
                        IntegrityScanner::load_baseline(&state.baseline_path)?;
                    if let Some(entry) = baseline.entries.get(&path) {
                        let store_guard = state.backup_store.lock();
                        let outcome =
                            state.restore_engine.restore_file(&target, entry, &store_guard);
                        let outcome_str = format!("{:?}", outcome);
                        Ok(IpcResponse::RestoreResult {
                            path,
                            outcome: outcome_str,
                        })
                    } else {
                        Err(anyhow!("path not in baseline"))
                    }
                } else {
                    Err(anyhow!("no baseline exists"))
                }
            }
            IpcRequest::GetEngineMode => {
                let state = self.state.lock();
                let mode = state.engine.mode();
                let mode_json = serde_json::to_value(&mode)
                    .unwrap_or_else(|_| serde_json::json!({"error": "serialization failed"}));
                Ok(IpcResponse::EngineModeInfo { mode: mode_json })
            }
            _ => Err(anyhow!("unsupported request")),
        }
    }

    async fn enter_safe_mode(&self, reason: String) -> Result<IpcResponse> {
        let mut state = self.state.lock();
        state.safe_mode.enter(SafeModeReason::Manual);
        state.engine.enter_safe_mode();
        state.event_log.append(
            "SAFE_MODE_ENTERED",
            EventSeverity::Critical,
            serde_json::json!({"reason": reason}),
        )?;
        Ok(IpcResponse::SafeModeEntered)
    }

    async fn exit_safe_mode(&self, password: String) -> Result<IpcResponse> {
        let mut state = self.state.lock();
        let vault = Vault::open(&state.vault_path, &password)?;
        state.vault = vault;
        state.password = Zeroizing::new(password);
        state.safe_mode.exit();
        state.engine.exit_safe_mode();
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
