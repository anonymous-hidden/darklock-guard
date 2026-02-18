//! Periodic integrity audit loop.
//!
//! Runs a full scan of all protected paths against the current baseline at a
//! configurable interval (default 5 minutes). This is the "belt" to the
//! watcher's "suspenders" – it catches anything the watcher missed (restarts,
//! NFS, event overflow, etc.).

use crate::integrity::scanner::{Baseline, IntegrityScanner, ScanResult};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Notify};
use tracing::{debug, info};

/// Handle returned to the caller so it can request an immediate scan or shut
/// the loop down.
pub struct AuditLoopHandle {
    /// Notify to wake the loop early (e.g. after maintenance exit).
    pub wake: Arc<Notify>,
    /// Send `true` to shut down.
    pub shutdown_tx: watch::Sender<bool>,
}

/// Spawn the audit loop as a tokio task.  Returns a `JoinHandle` and an
/// `AuditLoopHandle` for control.
///
/// `on_result` is called after every scan with the `ScanResult`. The caller
/// (the orchestrator) decides what to enforce.
pub fn spawn_audit_loop<F>(
    scanner: Arc<IntegrityScanner>,
    interval: Duration,
    baseline_fn: Arc<dyn Fn() -> Option<Baseline> + Send + Sync>,
    on_result: F,
) -> (tokio::task::JoinHandle<()>, AuditLoopHandle)
where
    F: Fn(ScanResult) + Send + Sync + 'static,
{
    let wake = Arc::new(Notify::new());
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let wake_clone = wake.clone();

    let handle = tokio::spawn(async move {
        info!(
            interval_secs = interval.as_secs(),
            "audit loop started"
        );

        loop {
            tokio::select! {
                _ = tokio::time::sleep(interval) => {}
                _ = wake_clone.notified() => {
                    debug!("audit loop woken early");
                }
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        info!("audit loop shutting down");
                        return;
                    }
                }
            }

            // Check shutdown again after wakeup.
            if *shutdown_rx.borrow() {
                return;
            }

            let baseline = match (baseline_fn)() {
                Some(b) => b,
                None => {
                    debug!("audit loop: no baseline available, skipping scan");
                    continue;
                }
            };

            info!(
                entries = baseline.entries.len(),
                "audit loop: running periodic scan"
            );

            let result = scanner.scan_against_baseline(&baseline);
            on_result(result);
        }
    });

    (
        handle,
        AuditLoopHandle {
            wake,
            shutdown_tx,
        },
    )
}
