use chrono::Utc;
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::{
    task::JoinHandle,
    time::{self, Duration},
};
use tracing::warn;

use super::api_client::ApiClient;
use crate::ServiceState;

pub fn spawn_heartbeat_loop(
    client: ApiClient,
    device_id: String,
    state: Arc<Mutex<ServiceState>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(30));
        loop {
            ticker.tick().await;
            match client.send_heartbeat(&device_id).await {
                Ok(_) => {
                    if let Ok(mut guard) = std::panic::catch_unwind(|| state.lock()) {
                        guard.connected = true;
                        guard.last_heartbeat = Some(Utc::now());
                        guard
                            .event_log
                            .append(
                                "HEARTBEAT_SENT",
                                guard_core::event_log::EventSeverity::Info,
                                serde_json::json!({"device_id": device_id}),
                            )
                            .ok();
                    }
                }
                Err(err) => {
                    warn!(error = %err, "heartbeat failed");
                    if let Ok(mut guard) = std::panic::catch_unwind(|| state.lock()) {
                        guard.connected = false;
                    }
                }
            }
        }
    })
}
