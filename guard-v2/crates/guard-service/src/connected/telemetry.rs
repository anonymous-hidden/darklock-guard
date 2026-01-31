use guard_core::event_log::{EventLog, EventSeverity};
use parking_lot::Mutex;
use std::sync::Arc;

use crate::ServiceState;

pub fn record_command_event(
    state: &Arc<Mutex<ServiceState>>,
    action: &str,
    command_id: &str,
    reason: &impl std::fmt::Debug,
) {
    if let Ok(mut guard) = std::panic::catch_unwind(|| state.lock()) {
        let _ = guard.event_log.append(
            action,
            EventSeverity::Warning,
            serde_json::json!({"command_id": command_id, "reason": format!("{:?}", reason)}),
        );
    }
}
