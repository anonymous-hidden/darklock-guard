//! Error types for Darklock Guard

use thiserror::Error;
use serde::Serialize;

#[derive(Error, Debug, Serialize)]
pub enum DarklockError {
    #[error("IO error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Integrity violation: {0}")]
    IntegrityViolation(String),

    #[error("Path not found: {0}")]
    PathNotFound(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    #[error("Event chain error: {0}")]
    EventChain(String),
}

impl From<std::io::Error> for DarklockError {
    fn from(e: std::io::Error) -> Self {
        DarklockError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for DarklockError {
    fn from(e: serde_json::Error) -> Self {
        DarklockError::Serialization(e.to_string())
    }
}

// Convert to string for Tauri error handling
impl From<DarklockError> for String {
    fn from(e: DarklockError) -> String {
        e.to_string()
    }
}

pub type Result<T> = std::result::Result<T, DarklockError>;
