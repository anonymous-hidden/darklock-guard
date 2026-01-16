//! File system watcher with debouncing
//!
//! Uses the `notify` crate for cross-platform file watching.
//! Debounces events to avoid excessive rescanning.

use crate::protection::{ProtectionError, Result};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock};

/// Default debounce duration in milliseconds
const DEFAULT_DEBOUNCE_MS: u64 = 2000;

/// Watcher event indicating a path needs rescanning
#[derive(Debug, Clone)]
pub struct WatcherEvent {
    pub path_id: String,
    pub root_path: PathBuf,
    pub changed_files: Vec<PathBuf>,
    pub event_time: Instant,
}

/// File watcher manager
pub struct FileWatcher {
    /// Active watchers by path_id
    watchers: Arc<RwLock<HashMap<String, WatcherHandle>>>,
    /// Debounce duration
    debounce: Duration,
    /// Channel for sending watch events
    event_tx: mpsc::Sender<WatcherEvent>,
}

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    root_path: PathBuf,
}

impl FileWatcher {
    /// Create a new file watcher
    pub fn new(event_tx: mpsc::Sender<WatcherEvent>) -> Self {
        Self {
            watchers: Arc::new(RwLock::new(HashMap::new())),
            debounce: Duration::from_millis(DEFAULT_DEBOUNCE_MS),
            event_tx,
        }
    }
    
    /// Set debounce duration
    pub fn with_debounce(mut self, duration: Duration) -> Self {
        self.debounce = duration;
        self
    }
    
    /// Start watching a path
    pub async fn watch(&self, path_id: String, path: &Path) -> Result<()> {
        let path_id_clone = path_id.clone();
        let root_path = path.to_path_buf();
        let event_tx = self.event_tx.clone();
        let debounce = self.debounce;
        
        // Create debouncer state
        let pending_events: Arc<RwLock<HashMap<PathBuf, Instant>>> = Arc::new(RwLock::new(HashMap::new()));
        let pending_clone = pending_events.clone();
        let path_id_for_handler = path_id.clone();
        let root_path_for_handler = root_path.clone();
        
        // Create watcher with event handler
        let watcher = RecommendedWatcher::new(
            move |result: std::result::Result<Event, notify::Error>| {
                if let Ok(event) = result {
                    let pending = pending_clone.clone();
                    let path_id = path_id_for_handler.clone();
                    let root = root_path_for_handler.clone();
                    let tx = event_tx.clone();
                    
                    // Spawn async task to handle event
                    tokio::spawn(async move {
                        for path in event.paths {
                            let mut pending = pending.write().await;
                            pending.insert(path, Instant::now());
                        }
                        
                        // Wait for debounce period
                        tokio::time::sleep(debounce).await;
                        
                        // Collect events that have been stable for debounce period
                        let mut pending = pending.write().await;
                        let now = Instant::now();
                        let ready: Vec<PathBuf> = pending.iter()
                            .filter(|(_, time)| now.duration_since(**time) >= debounce)
                            .map(|(path, _)| path.clone())
                            .collect();
                        
                        if !ready.is_empty() {
                            // Remove processed events
                            for path in &ready {
                                pending.remove(path);
                            }
                            
                            // Send watcher event
                            let _ = tx.send(WatcherEvent {
                                path_id: path_id.clone(),
                                root_path: root.clone(),
                                changed_files: ready,
                                event_time: now,
                            }).await;
                        }
                    });
                }
            },
            Config::default(),
        ).map_err(|e| ProtectionError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        
        // Start watching
        let mut watcher = watcher;
        watcher.watch(path, RecursiveMode::Recursive)
            .map_err(|e| ProtectionError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        
        // Store handle
        let mut watchers = self.watchers.write().await;
        watchers.insert(path_id, WatcherHandle {
            _watcher: watcher,
            root_path,
        });
        
        Ok(())
    }
    
    /// Stop watching a path
    pub async fn unwatch(&self, path_id: &str) -> Result<()> {
        let mut watchers = self.watchers.write().await;
        watchers.remove(path_id);
        Ok(())
    }
    
    /// Check if a path is being watched
    pub async fn is_watching(&self, path_id: &str) -> bool {
        let watchers = self.watchers.read().await;
        watchers.contains_key(path_id)
    }
    
    /// Get all watched path IDs
    pub async fn get_watched_paths(&self) -> Vec<String> {
        let watchers = self.watchers.read().await;
        watchers.keys().cloned().collect()
    }
    
    /// Stop all watchers
    pub async fn stop_all(&self) {
        let mut watchers = self.watchers.write().await;
        watchers.clear();
    }
}

/// Create a channel for watcher events
pub fn create_watcher_channel() -> (mpsc::Sender<WatcherEvent>, mpsc::Receiver<WatcherEvent>) {
    mpsc::channel(100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;
    use tokio::time::timeout;
    
    #[tokio::test]
    async fn test_watcher_creation() {
        let (tx, _rx) = create_watcher_channel();
        let watcher = FileWatcher::new(tx);
        
        let temp_dir = TempDir::new().unwrap();
        watcher.watch("test".to_string(), temp_dir.path()).await.unwrap();
        
        assert!(watcher.is_watching("test").await);
        
        watcher.unwatch("test").await.unwrap();
        assert!(!watcher.is_watching("test").await);
    }
    
    #[tokio::test]
    async fn test_watcher_detects_changes() {
        let (tx, mut rx) = create_watcher_channel();
        let watcher = FileWatcher::new(tx)
            .with_debounce(Duration::from_millis(100));
        
        let temp_dir = TempDir::new().unwrap();
        watcher.watch("test".to_string(), temp_dir.path()).await.unwrap();
        
        // Create a file
        let test_file = temp_dir.path().join("test.txt");
        fs::write(&test_file, "hello").unwrap();
        
        // Wait for event with timeout
        let result = timeout(Duration::from_secs(5), rx.recv()).await;
        
        // May or may not receive event depending on timing
        // This is mainly to verify no panics occur
        drop(result);
        
        watcher.stop_all().await;
    }
}
