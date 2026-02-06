use guard_core::event_log::EventSeverity;
use parking_lot::Mutex;
use std::sync::Arc;

use crate::service_state::ServiceState;

pub fn record_command_event(
    state: &Arc<Mutex<ServiceState>>,
    action: &str,
    command_id: &str,
    reason: &impl std::fmt::Debug,
) {
    let guard = state.lock();
    let _ = guard.event_log.append(
        action,
        EventSeverity::Warn,
        serde_json::json!({"command_id": command_id, "reason": format!("{:?}", reason)}),
    );
}
