//! Security check Tauri command.
use tauri::State;
use crate::{security_check::{run_security_check, SecurityCheckResult}, state::AppState};

/// Run security check — call immediately after successful login.
#[tauri::command]
pub async fn cmd_run_security_check(
    state: State<'_, AppState>,
) -> Result<SecurityCheckResult, String> {
    let result = run_security_check();

    // Log high-severity events to risk_events table if available
    if let Some(store) = state.get_store().await {
        for signal in &result.signals {
            if matches!(signal.severity, crate::security_check::RiskLevel::High | crate::security_check::RiskLevel::Critical) {
                let id = uuid::Uuid::new_v4().to_string();
                let raw = serde_json::to_string(signal).unwrap_or_default();
                sqlx::query(
                    "INSERT INTO risk_events (id, event_type, severity, description, raw_data) VALUES (?, ?, ?, ?, ?)"
                )
                .bind(&id)
                .bind(&signal.name)
                .bind(format!("{:?}", signal.severity).to_lowercase())
                .bind(&signal.description)
                .bind(&raw)
                .execute(&store.pool)
                .await
                .ok();
            }
        }
    }

    Ok(result)
}
