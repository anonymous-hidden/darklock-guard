//! Event Chain module for Darklock Guard
//!
//! Implements an append-only cryptographic event chain for audit trails.
//! Each event contains a hash of the previous event, creating a tamper-evident log.
//!
//! Features:
//! - Append-only chain with cryptographic linking
//! - Ed25519 signatures on each event
//! - Chain integrity verification
//! - Event persistence

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;
use std::fs;
use std::path::{Path, PathBuf};
use crate::crypto::{hash_string, SigningKeyPair};
use crate::error::{DarklockError, Result};

/// Event types
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// Application started
    AppStart,
    /// Application shutdown
    AppShutdown,
    /// Path added to protection
    PathAdded,
    /// Path removed from protection
    PathRemoved,
    /// Integrity scan started
    ScanStarted,
    /// Integrity scan completed
    ScanCompleted,
    /// File modification detected
    FileModified,
    /// New file detected
    FileAdded,
    /// File deletion detected
    FileDeleted,
    /// Settings changed
    SettingsChanged,
    /// Chain verification performed
    ChainVerified,
    /// Security alert
    SecurityAlert,
    /// Manifest signed
    ManifestSigned,
    /// Generic info event
    Info,
}

/// Event severity level
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EventSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

/// Single event in the chain
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainEvent {
    /// Unique event ID
    pub id: String,
    
    /// Event sequence number (0-indexed)
    pub sequence: u64,
    
    /// Event timestamp
    pub timestamp: DateTime<Utc>,
    
    /// Event type
    pub event_type: EventType,
    
    /// Event severity
    pub severity: EventSeverity,
    
    /// Human-readable message
    pub message: String,
    
    /// Additional event data
    pub data: Option<serde_json::Value>,
    
    /// Hash of previous event (None for genesis)
    pub prev_hash: Option<String>,
    
    /// Hash of this event's content
    pub hash: String,
    
    /// Ed25519 signature
    pub signature: Option<String>,
}

impl ChainEvent {
    /// Create a new event
    fn new(
        sequence: u64,
        event_type: EventType,
        severity: EventSeverity,
        message: String,
        data: Option<serde_json::Value>,
        prev_hash: Option<String>,
    ) -> Self {
        let id = Uuid::new_v4().to_string();
        let timestamp = Utc::now();
        
        // Compute hash of event content (excluding signature)
        let hash_content = format!(
            "{}:{}:{}:{:?}:{:?}:{}:{:?}:{:?}",
            id, sequence, timestamp, event_type, severity, message, data, prev_hash
        );
        let hash = hash_string(&hash_content);
        
        Self {
            id,
            sequence,
            timestamp,
            event_type,
            severity,
            message,
            data,
            prev_hash,
            hash,
            signature: None,
        }
    }
    
    /// Sign the event
    fn sign(&mut self, key: &SigningKeyPair) {
        self.signature = Some(key.sign(self.hash.as_bytes()));
    }
    
    /// Verify event hash
    pub fn verify_hash(&self) -> bool {
        let hash_content = format!(
            "{}:{}:{}:{:?}:{:?}:{}:{:?}:{:?}",
            self.id, self.sequence, self.timestamp, self.event_type,
            self.severity, self.message, self.data, self.prev_hash
        );
        let expected_hash = hash_string(&hash_content);
        self.hash == expected_hash
    }
}

/// Append-only event chain
pub struct EventChain {
    events: Vec<ChainEvent>,
    chain_file: PathBuf,
    max_events: usize,
}

impl EventChain {
    /// Create or load event chain
    pub fn new(data_dir: &Path, max_events: usize) -> Result<Self> {
        let chain_file = data_dir.join("event_chain.json");
        
        let events = if chain_file.exists() {
            let data = fs::read_to_string(&chain_file)?;
            serde_json::from_str(&data)?
        } else {
            Vec::new()
        };
        
        Ok(Self {
            events,
            chain_file,
            max_events,
        })
    }
    
    /// Get all events
    pub fn events(&self) -> &[ChainEvent] {
        &self.events
    }
    
    /// Get events with pagination
    pub fn get_events(&self, offset: usize, limit: usize) -> Vec<&ChainEvent> {
        self.events
            .iter()
            .rev()  // Most recent first
            .skip(offset)
            .take(limit)
            .collect()
    }
    
    /// Get events by type
    pub fn get_events_by_type(&self, event_type: EventType) -> Vec<&ChainEvent> {
        self.events
            .iter()
            .filter(|e| e.event_type == event_type)
            .collect()
    }
    
    /// Get events by severity
    pub fn get_events_by_severity(&self, severity: EventSeverity) -> Vec<&ChainEvent> {
        self.events
            .iter()
            .filter(|e| e.severity == severity)
            .collect()
    }
    
    /// Append a new event
    pub fn append(
        &mut self,
        event_type: EventType,
        severity: EventSeverity,
        message: String,
        data: Option<serde_json::Value>,
        signing_key: Option<&SigningKeyPair>,
    ) -> Result<ChainEvent> {
        let sequence = self.events.len() as u64;
        let prev_hash = self.events.last().map(|e| e.hash.clone());
        
        let mut event = ChainEvent::new(
            sequence,
            event_type,
            severity,
            message,
            data,
            prev_hash,
        );
        
        // Sign if key provided
        if let Some(key) = signing_key {
            event.sign(key);
        }
        
        self.events.push(event.clone());
        
        // Prune old events if exceeding max
        if self.events.len() > self.max_events {
            let to_remove = self.events.len() - self.max_events;
            self.events.drain(0..to_remove);
        }
        
        // Persist
        self.save()?;
        
        Ok(event)
    }
    
    /// Verify entire chain integrity
    pub fn verify(&self) -> ChainVerificationResult {
        if self.events.is_empty() {
            return ChainVerificationResult {
                valid: true,
                total_events: 0,
                verified_events: 0,
                first_invalid_sequence: None,
                errors: vec![],
            };
        }
        
        let mut errors = Vec::new();
        let mut verified = 0;
        let mut first_invalid: Option<u64> = None;
        
        for (i, event) in self.events.iter().enumerate() {
            // Verify hash
            if !event.verify_hash() {
                if first_invalid.is_none() {
                    first_invalid = Some(event.sequence);
                }
                errors.push(format!(
                    "Event {} (seq {}): Hash verification failed",
                    event.id, event.sequence
                ));
                continue;
            }
            
            // Verify chain linkage (except genesis)
            if i > 0 {
                let prev = &self.events[i - 1];
                if event.prev_hash.as_ref() != Some(&prev.hash) {
                    if first_invalid.is_none() {
                        first_invalid = Some(event.sequence);
                    }
                    errors.push(format!(
                        "Event {} (seq {}): Chain link broken - prev_hash mismatch",
                        event.id, event.sequence
                    ));
                    continue;
                }
            } else {
                // Genesis event should have no prev_hash
                if event.prev_hash.is_some() {
                    if first_invalid.is_none() {
                        first_invalid = Some(event.sequence);
                    }
                    errors.push(format!(
                        "Event {} (seq {}): Genesis event has prev_hash",
                        event.id, event.sequence
                    ));
                    continue;
                }
            }
            
            verified += 1;
        }
        
        ChainVerificationResult {
            valid: errors.is_empty(),
            total_events: self.events.len(),
            verified_events: verified,
            first_invalid_sequence: first_invalid,
            errors,
        }
    }
    
    /// Save chain to disk
    fn save(&self) -> Result<()> {
        let data = serde_json::to_string_pretty(&self.events)?;
        fs::write(&self.chain_file, data)?;
        Ok(())
    }
    
    /// Get chain statistics
    pub fn stats(&self) -> ChainStats {
        let mut event_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        
        for event in &self.events {
            let key = format!("{:?}", event.event_type);
            *event_counts.entry(key).or_insert(0) += 1;
        }
        
        ChainStats {
            total_events: self.events.len(),
            first_event_time: self.events.first().map(|e| e.timestamp),
            last_event_time: self.events.last().map(|e| e.timestamp),
            event_counts,
        }
    }
}

/// Chain verification result
#[derive(Clone, Debug, Serialize)]
pub struct ChainVerificationResult {
    pub valid: bool,
    pub total_events: usize,
    pub verified_events: usize,
    pub first_invalid_sequence: Option<u64>,
    pub errors: Vec<String>,
}

/// Chain statistics
#[derive(Clone, Debug, Serialize)]
pub struct ChainStats {
    pub total_events: usize,
    pub first_event_time: Option<DateTime<Utc>>,
    pub last_event_time: Option<DateTime<Utc>>,
    pub event_counts: std::collections::HashMap<String, usize>,
}

/// Event data for frontend display
#[derive(Clone, Debug, Serialize)]
pub struct EventDisplay {
    pub id: String,
    pub sequence: u64,
    pub timestamp: DateTime<Utc>,
    pub event_type: String,
    pub severity: String,
    pub message: String,
    pub has_signature: bool,
}

impl From<&ChainEvent> for EventDisplay {
    fn from(event: &ChainEvent) -> Self {
        Self {
            id: event.id.clone(),
            sequence: event.sequence,
            timestamp: event.timestamp,
            event_type: format!("{:?}", event.event_type).to_lowercase().replace('_', "-"),
            severity: format!("{:?}", event.severity).to_lowercase(),
            message: event.message.clone(),
            has_signature: event.signature.is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    #[test]
    fn test_chain_creation() {
        let temp_dir = TempDir::new().unwrap();
        let chain = EventChain::new(temp_dir.path(), 1000).unwrap();
        assert!(chain.events().is_empty());
    }
    
    #[test]
    fn test_append_and_verify() {
        let temp_dir = TempDir::new().unwrap();
        let mut chain = EventChain::new(temp_dir.path(), 1000).unwrap();
        
        chain.append(
            EventType::AppStart,
            EventSeverity::Info,
            "Application started".to_string(),
            None,
            None,
        ).unwrap();
        
        chain.append(
            EventType::Info,
            EventSeverity::Info,
            "Test event".to_string(),
            None,
            None,
        ).unwrap();
        
        let result = chain.verify();
        assert!(result.valid);
        assert_eq!(result.total_events, 2);
        assert_eq!(result.verified_events, 2);
    }
}
