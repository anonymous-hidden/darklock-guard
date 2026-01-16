//! Darklock Guard Library
//!
//! This module re-exports all public types for use as a library crate.

pub mod commands;
pub mod integrity;
pub mod storage;
pub mod event_chain;
pub mod crypto;
pub mod error;

// New EDR-lite protection system
pub mod protection;

pub use error::{DarklockError, Result};
pub use storage::{AppState, Settings, ProtectedPath, FileEntry};
pub use integrity::{IntegrityScanner, ScanConfig, ScanResult};
pub use event_chain::{EventChain, EventType, EventSeverity, ChainEvent};
pub use crypto::{SigningKeyPair, hash_file, hash_string, merkle_root};

// Protection module re-exports
pub use protection::{
    ProtectionManager,
    ProtectionError,
    Database,
    Scanner,
    ScanMode,
    EventChain as ProtectionEventChain,
    FileWatcher,
    KeyStore,
    BaselineManager,
};
