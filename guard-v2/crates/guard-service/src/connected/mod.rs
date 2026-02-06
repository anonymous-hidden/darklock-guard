use anyhow::{anyhow, Result};
use guard_core::vault::{Mode, SecurityProfile};
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tracing::info;

use crate::service_state::ServiceState;

mod api_client;
pub mod commands;
mod heartbeat;
pub mod state;
mod telemetry;
pub mod verifier;

use api_client::ApiClient;
pub use commands::{CommandValidationError, ServerCommand};
use state::ConnectedState;
use verifier::Verifier;

#[derive(Clone, Debug)]
pub struct ConnectedConfig {
    pub api_base_url: String,
    pub api_token: String,
    pub device_id: String,
    pub security_profile: SecurityProfile,
    pub server_public_key: Option<String>,
}

pub fn maybe_start_connected(state: Arc<Mutex<ServiceState>>) -> Result<Option<JoinHandle<()>>> {
    {
        let guard = state.lock();
        if guard.vault.payload.mode != Mode::Connected {
            return Ok(None);
        }
    }

    let guard = state.lock();
    let device_id = guard.vault.payload.device_id.clone();
    let security_profile = guard.vault.payload.security_profile.clone();
    let server_public_key = guard.vault.payload.connection.server_public_key.clone();
    drop(guard);

    let api_base_url = std::env::var("CONNECTED_API_BASE_URL")
        .map_err(|_| anyhow!("CONNECTED_API_BASE_URL missing"))?;
    let api_token =
        std::env::var("CONNECTED_API_TOKEN").map_err(|_| anyhow!("CONNECTED_API_TOKEN missing"))?;

    let config = ConnectedConfig {
        api_base_url,
        api_token,
        device_id,
        security_profile,
        server_public_key,
    };

    let handle = tokio::spawn(async move {
        if let Err(err) = run_connected(config, state.clone()).await {
            tracing::error!(error = %err, "connected mode failed");
        }
    });

    Ok(Some(handle))
}

async fn run_connected(config: ConnectedConfig, state: Arc<Mutex<ServiceState>>) -> Result<()> {
    let client = ApiClient::new(&config);
    let verifier = Verifier::new(config.server_public_key.clone());
    let mut runtime = ConnectedState::new(config.security_profile.clone());

    let heartbeat_task =
        heartbeat::spawn_heartbeat_loop(client.clone(), config.device_id.clone(), state.clone());
    let commands_task = commands::spawn_command_loop(
        client,
        verifier,
        config.device_id.clone(),
        runtime.take_nonce_book(),
        config.security_profile.clone(),
        state.clone(),
    );

    tokio::select! {
        _ = heartbeat_task => { info!("heartbeat loop stopped") }
        _ = commands_task => { info!("command loop stopped") }
    }

    Ok(())
}
