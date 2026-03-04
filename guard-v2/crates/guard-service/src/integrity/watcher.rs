//! Real-time file system watcher using the `notify` crate.
//!
//! Watches protected paths for changes and sends events through a channel
//! to be processed by the integrity scanner.

use anyhow::Result;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tokio::sync::broadcast;
use tracing::{info, warn, error, debug};

/// Types of file changes we care about
#[derive(Debug, Clone)]
pub enum FileChange {
    Modified(PathBuf),
    Created(PathBuf),
    Removed(PathBuf),
    Renamed { from: PathBuf, to: PathBuf },
    PermissionChanged(PathBuf),
}

/// FileWatcher watches protected directories for changes
pub struct FileWatcher {
    watcher: RecommendedWatcher,
    change_tx: broadcast::Sender<FileChange>,
}

impl FileWatcher {
    /// Create a new FileWatcher
    pub fn new() -> Result<(Self, broadcast::Receiver<FileChange>)> {
        let (change_tx, change_rx) = broadcast::channel(1024);
        let tx = change_tx.clone();

        let (sync_tx, sync_rx) = mpsc::channel::<Result<Event, notify::Error>>();

        let watcher = RecommendedWatcher::new(
            move |res| {
                let _ = sync_tx.send(res);
            },
            Config::default()
                .with_poll_interval(Duration::from_secs(2)),
        )?;

        // Spawn thread to bridge sync notify events to async broadcast
        let tx_clone = tx.clone();
        std::thread::Builder::new()
            .name("file-watcher-bridge".into())
            .spawn(move || {
                loop {
                    match sync_rx.recv() {
                        Ok(Ok(event)) => {
                            let changes = classify_event(&event);
                            for change in changes {
                                if tx_clone.send(change).is_err() {
                                    debug!("All receivers dropped, stopping watcher bridge");
                                    return;
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            error!("File watcher error: {}", e);
                        }
                        Err(_) => {
                            debug!("Watcher channel closed");
                            return;
                        }
                    }
                }
            })?;

        Ok((
            Self {
                watcher,
                change_tx: tx,
            },
            change_rx,
        ))
    }

    /// Start watching a list of paths
    pub fn watch_paths(&mut self, paths: &[PathBuf]) -> Result<()> {
        for path in paths {
            if path.exists() {
                let mode = if path.is_dir() {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                };
                self.watcher.watch(path, mode)?;
                info!("Watching: {}", path.display());
            } else {
                warn!("Path does not exist, cannot watch: {}", path.display());
            }
        }
        Ok(())
    }

    /// Stop watching a path
    pub fn unwatch(&mut self, path: &PathBuf) -> Result<()> {
        self.watcher.unwatch(path)?;
        Ok(())
    }

    /// Get a new receiver for file changes
    pub fn subscribe(&self) -> broadcast::Receiver<FileChange> {
        self.change_tx.subscribe()
    }
}

/// Classify a notify event into our FileChange types
fn classify_event(event: &Event) -> Vec<FileChange> {
    let mut changes = Vec::new();

    match &event.kind {
        EventKind::Create(_) => {
            for path in &event.paths {
                changes.push(FileChange::Created(path.clone()));
            }
        }
        EventKind::Modify(modify_kind) => {
            use notify::event::ModifyKind;
            match modify_kind {
                ModifyKind::Name(_) if event.paths.len() >= 2 => {
                    changes.push(FileChange::Renamed {
                        from: event.paths[0].clone(),
                        to: event.paths[1].clone(),
                    });
                }
                ModifyKind::Metadata(_) => {
                    for path in &event.paths {
                        changes.push(FileChange::PermissionChanged(path.clone()));
                    }
                }
                _ => {
                    for path in &event.paths {
                        changes.push(FileChange::Modified(path.clone()));
                    }
                }
            }
        }
        EventKind::Remove(_) => {
            for path in &event.paths {
                changes.push(FileChange::Removed(path.clone()));
            }
        }
        _ => {}
    }

    changes
}
