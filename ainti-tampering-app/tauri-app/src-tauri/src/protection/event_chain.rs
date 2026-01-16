//! Tamper-evident event chain with Ed25519 signatures
//!
//! Implements a cryptographically-linked log where:
//! - Each event contains hash of previous event
//! - Each event is signed with Ed25519
//! - Chain can be verified from genesis
//! - Tampering is detectable

use crate::protection::{ProtectionError, Result};
use crate::protection::database::Database;
use crate::protection::models::*;
use crate::protection::keystore::KeyStore;
use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

/// Genesis hash (first event's prev_hash)
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Event chain manager
pub struct EventChain {
    db: Arc<Database>,
    keystore: Arc<KeyStore>,
    signing_key: SigningKey,
}

impl EventChain {
    /// Create a new event chain manager
    pub fn new(db: Arc<Database>, keystore: Arc<KeyStore>) -> Result<Self> {
        let signing_key = keystore.get_signing_key()?;
        
        Ok(Self {
            db,
            keystore,
            signing_key,
        })
    }
    
    /// Append an event to the chain
    pub fn append(
        &self,
        event_type: EventType,
        path_id: Option<&str>,
        payload: serde_json::Value,
    ) -> Result<ChainEvent> {
        let event_id = Uuid::new_v4().to_string();
        let timestamp = Utc::now();
        
        // Get previous hash (or genesis for first event)
        let prev_hash = self.db.get_last_event_hash()?
            .unwrap_or_else(|| GENESIS_HASH.to_string());
        
        // Compute event hash: hash(prev_hash || timestamp || type || payload)
        let hash_input = format!(
            "{}|{}|{}|{}",
            prev_hash,
            timestamp.to_rfc3339(),
            event_type.as_str(),
            payload.to_string(),
        );
        let event_hash = blake3::hash(hash_input.as_bytes()).to_hex().to_string();
        
        // Sign the event hash
        let signature = self.signing_key.sign(event_hash.as_bytes());
        let signature_hex = hex::encode(signature.to_bytes());
        
        let event = ChainEvent {
            event_id,
            timestamp,
            event_type,
            path_id: path_id.map(String::from),
            payload,
            prev_hash_hex: prev_hash,
            event_hash_hex: event_hash,
            signature_hex,
        };
        
        self.db.insert_chain_event(&event)?;
        
        Ok(event)
    }
    
    /// Verify the entire event chain
    pub fn verify(&self) -> Result<ChainVerificationResult> {
        let events = self.db.get_all_events()?;
        
        if events.is_empty() {
            return Ok(ChainVerificationResult {
                valid: true,
                events_verified: 0,
                first_invalid_event: None,
                error_message: None,
            });
        }
        
        let verifying_key = self.keystore.get_verifying_key()?;
        let mut expected_prev_hash = GENESIS_HASH.to_string();
        
        for (idx, event) in events.iter().enumerate() {
            // Verify chain linkage
            if event.prev_hash_hex != expected_prev_hash {
                return Ok(ChainVerificationResult {
                    valid: false,
                    events_verified: idx as u64,
                    first_invalid_event: Some(event.event_id.clone()),
                    error_message: Some(format!(
                        "Chain broken at event {}: expected prev_hash {}, got {}",
                        event.event_id, expected_prev_hash, event.prev_hash_hex
                    )),
                });
            }
            
            // Recompute hash
            let hash_input = format!(
                "{}|{}|{}|{}",
                event.prev_hash_hex,
                event.timestamp.to_rfc3339(),
                event.event_type.as_str(),
                event.payload.to_string(),
            );
            let computed_hash = blake3::hash(hash_input.as_bytes()).to_hex().to_string();
            
            if computed_hash != event.event_hash_hex {
                return Ok(ChainVerificationResult {
                    valid: false,
                    events_verified: idx as u64,
                    first_invalid_event: Some(event.event_id.clone()),
                    error_message: Some(format!(
                        "Hash mismatch at event {}: computed {}, stored {}",
                        event.event_id, computed_hash, event.event_hash_hex
                    )),
                });
            }
            
            // Verify signature
            let signature_bytes = hex::decode(&event.signature_hex)
                .map_err(|_| ProtectionError::SignatureVerification)?;
            let signature = Signature::from_bytes(
                &signature_bytes.try_into()
                    .map_err(|_| ProtectionError::SignatureVerification)?
            );
            
            if verifying_key.verify(event.event_hash_hex.as_bytes(), &signature).is_err() {
                return Ok(ChainVerificationResult {
                    valid: false,
                    events_verified: idx as u64,
                    first_invalid_event: Some(event.event_id.clone()),
                    error_message: Some(format!(
                        "Signature verification failed at event {}",
                        event.event_id
                    )),
                });
            }
            
            expected_prev_hash = event.event_hash_hex.clone();
        }
        
        Ok(ChainVerificationResult {
            valid: true,
            events_verified: events.len() as u64,
            first_invalid_event: None,
            error_message: None,
        })
    }
    
    /// Log system start event
    pub fn log_system_start(&self) -> Result<ChainEvent> {
        self.append(
            EventType::SystemStart,
            None,
            json!({
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
            }),
        )
    }
    
    /// Log path added event
    pub fn log_path_added(&self, path_id: &str, path: &str) -> Result<ChainEvent> {
        self.append(
            EventType::PathAdded,
            Some(path_id),
            json!({ "path": path }),
        )
    }
    
    /// Log path removed event
    pub fn log_path_removed(&self, path_id: &str, path: &str) -> Result<ChainEvent> {
        self.append(
            EventType::PathRemoved,
            Some(path_id),
            json!({ "path": path }),
        )
    }
    
    /// Log scan started event
    pub fn log_scan_started(&self, path_id: &str, scan_id: &str, mode: &str) -> Result<ChainEvent> {
        self.append(
            EventType::ScanStarted,
            Some(path_id),
            json!({
                "scan_id": scan_id,
                "mode": mode,
            }),
        )
    }
    
    /// Log scan completed event
    pub fn log_scan_completed(&self, path_id: &str, scan_id: &str, totals: &ScanTotals) -> Result<ChainEvent> {
        self.append(
            EventType::ScanCompleted,
            Some(path_id),
            json!({
                "scan_id": scan_id,
                "files_scanned": totals.files_scanned,
                "files_verified": totals.files_verified,
                "files_modified": totals.files_modified,
                "files_added": totals.files_added,
                "files_removed": totals.files_removed,
                "duration_ms": totals.duration_ms,
            }),
        )
    }
    
    /// Log changes detected event
    pub fn log_changes_detected(&self, path_id: &str, scan_id: &str, changes: u64) -> Result<ChainEvent> {
        self.append(
            EventType::ChangesDetected,
            Some(path_id),
            json!({
                "scan_id": scan_id,
                "total_changes": changes,
            }),
        )
    }
    
    /// Log baseline created event
    pub fn log_baseline_created(&self, path_id: &str, version: i32, file_count: u64) -> Result<ChainEvent> {
        self.append(
            EventType::BaselineCreated,
            Some(path_id),
            json!({
                "version": version,
                "file_count": file_count,
            }),
        )
    }
    
    /// Log baseline updated event
    pub fn log_baseline_updated(&self, path_id: &str, version: i32, file_count: u64) -> Result<ChainEvent> {
        self.append(
            EventType::BaselineUpdated,
            Some(path_id),
            json!({
                "version": version,
                "file_count": file_count,
            }),
        )
    }
    
    /// Log integrity violation event
    pub fn log_integrity_violation(&self, path_id: &str, message: &str) -> Result<ChainEvent> {
        self.append(
            EventType::IntegrityViolation,
            Some(path_id),
            json!({ "message": message }),
        )
    }
    
    /// Log chain verification event
    pub fn log_chain_verified(&self, result: &ChainVerificationResult) -> Result<ChainEvent> {
        self.append(
            EventType::ChainVerified,
            None,
            json!({
                "valid": result.valid,
                "events_verified": result.events_verified,
            }),
        )
    }
    
    /// Log error event
    pub fn log_error(&self, path_id: Option<&str>, error: &str) -> Result<ChainEvent> {
        self.append(
            EventType::Error,
            path_id,
            json!({ "error": error }),
        )
    }
    
    /// Get recent events for UI display
    pub fn get_recent_events(&self, limit: u32) -> Result<Vec<ChainEvent>> {
        self.db.get_recent_events(limit)
    }
    
    /// Get event count
    pub fn get_event_count(&self) -> Result<u64> {
        self.db.get_event_count()
    }
    
    /// Clear event chain (danger zone - requires explicit confirmation)
    pub fn clear(&self) -> Result<()> {
        // Log that we're clearing before we actually clear
        // This creates one final event
        let _ = self.append(
            EventType::SettingsChanged,
            None,
            json!({ "action": "event_chain_cleared" }),
        );
        
        self.db.clear_event_chain()
    }
}

/// Export events to JSON for external analysis
pub fn export_events_to_json(events: &[ChainEvent]) -> Result<String> {
    serde_json::to_string_pretty(events).map_err(Into::into)
}
