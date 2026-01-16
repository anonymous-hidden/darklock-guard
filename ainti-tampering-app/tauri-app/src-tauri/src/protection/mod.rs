//! File Protection Module - EDR-lite Protected Paths System
//!
//! This module implements comprehensive file integrity monitoring with:
//! - SQLite-backed storage for baselines and scan results
//! - BLAKE3/SHA256 hashing with multi-threaded streaming
//! - Tamper-evident event chain with Ed25519 signatures
//! - File watching with debouncing
//! - Rollback attack prevention
//!
//! # Security Properties
//!
//! **Detects:**
//! - Silent file modification (content changes)
//! - Metadata tampering (size, mtime changes)
//! - File additions and deletions
//! - Baseline rollback attacks
//! - Event log tampering
//!
//! **Cannot prevent (requires OS-level access):**
//! - Admin/root modifying files directly
//! - Disabling the app
//! - Direct database manipulation (detected but not prevented)
//! - Memory attacks on running process
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    Tauri Commands (API)                     │
//! ├─────────────────────────────────────────────────────────────┤
//! │  ProtectionManager                                          │
//! │  ├── Database (SQLite)                                      │
//! │  ├── Scanner (multi-threaded)                               │
//! │  ├── EventChain (tamper-evident)                            │
//! │  ├── Watcher (filesystem events)                            │
//! │  └── KeyStore (platform-specific)                           │
//! └─────────────────────────────────────────────────────────────┘
//! ```

pub mod database;
pub mod models;
pub mod hasher;
pub mod scanner;
pub mod baseline;
pub mod event_chain;
pub mod watcher;
pub mod keystore;
pub mod manager;
pub mod commands;

// Re-exports
pub use database::Database;
pub use models::*;
pub use hasher::Hasher;
pub use models::HashAlgorithm;
pub use scanner::{Scanner, ScanMode, ScanProgress};
pub use baseline::BaselineManager;
pub use event_chain::EventChain;
pub use watcher::FileWatcher;
pub use keystore::KeyStore;
pub use manager::ProtectionManager;

/// Result type for protection operations
pub type Result<T> = std::result::Result<T, ProtectionError>;

/// Errors specific to the protection module
#[derive(Debug, thiserror::Error)]
pub enum ProtectionError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    
    #[error("Path not found: {0}")]
    PathNotFound(String),
    
    #[error("Path already protected: {0}")]
    PathAlreadyProtected(String),
    
    #[error("No baseline exists for path: {0}")]
    NoBaseline(String),
    
    #[error("Baseline verification failed: {0}")]
    BaselineVerificationFailed(String),
    
    #[error("Event chain integrity failure: {0}")]
    EventChainIntegrity(String),
    
    #[error("Signature verification failed")]
    SignatureVerification,
    
    #[error("Key store error: {0}")]
    KeyStore(String),
    
    #[error("Scan in progress for path: {0}")]
    ScanInProgress(String),
    
    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
    
    #[error("Configuration error: {0}")]
    Config(String),
}
