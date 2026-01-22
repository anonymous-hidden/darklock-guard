//! SQLite database layer for the protection system
//!
//! Handles all persistence with proper schema migrations.

use crate::protection::{ProtectionError, Result};
use crate::protection::models::*;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::Mutex;

/// Current schema version
const SCHEMA_VERSION: i32 = 1;

/// Database wrapper with connection pooling
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open or create database at the given path
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Enable foreign keys and WAL mode for performance
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;  -- 64MB cache
             PRAGMA temp_store = MEMORY;"
        )?;
        
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        
        Ok(db)
    }
    
    /// Open in-memory database (for testing)
    #[allow(dead_code)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        
        Ok(db)
    }
    
    /// Run schema migrations
    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        // Create schema version table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            )",
            [],
        )?;
        
        // Get current version
        let current_version: i32 = conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |row| row.get(0))
            .unwrap_or(0);
        
        if current_version < 1 {
            self.migrate_v1(&conn)?;
        }
        
        Ok(())
    }
    
    /// Schema version 1 - Initial schema
    fn migrate_v1(&self, conn: &Connection) -> Result<()> {
        conn.execute_batch(r#"
            -- Protected paths table
            CREATE TABLE IF NOT EXISTS protected_paths (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'not_scanned',
                last_scan_at TEXT,
                baseline_version INTEGER NOT NULL DEFAULT 0,
                settings_json TEXT NOT NULL DEFAULT '{}'
            );
            
            CREATE INDEX IF NOT EXISTS idx_protected_paths_path ON protected_paths(path);
            CREATE INDEX IF NOT EXISTS idx_protected_paths_status ON protected_paths(status);
            
            -- Baseline files table (normalized, not one big JSON blob)
            CREATE TABLE IF NOT EXISTS baseline_files (
                path_id TEXT NOT NULL,
                rel_path TEXT NOT NULL,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL,
                mode INTEGER NOT NULL DEFAULT 0,
                hash_algo TEXT NOT NULL DEFAULT 'blake3',
                hash_hex TEXT NOT NULL,
                chunk_size INTEGER,
                chunk_hashes_json TEXT,
                baseline_version INTEGER NOT NULL,
                PRIMARY KEY (path_id, rel_path, baseline_version),
                FOREIGN KEY (path_id) REFERENCES protected_paths(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_baseline_files_path_id ON baseline_files(path_id);
            CREATE INDEX IF NOT EXISTS idx_baseline_files_version ON baseline_files(path_id, baseline_version);
            
            -- Scan results table
            CREATE TABLE IF NOT EXISTS scan_results (
                scan_id TEXT PRIMARY KEY,
                path_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                totals_json TEXT NOT NULL DEFAULT '{}',
                result_status TEXT NOT NULL DEFAULT 'clean',
                FOREIGN KEY (path_id) REFERENCES protected_paths(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_scan_results_path_id ON scan_results(path_id);
            CREATE INDEX IF NOT EXISTS idx_scan_results_started_at ON scan_results(started_at DESC);
            
            -- File diffs table
            CREATE TABLE IF NOT EXISTS file_diffs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT NOT NULL,
                rel_path TEXT NOT NULL,
                change_type TEXT NOT NULL,
                old_hash TEXT,
                new_hash TEXT,
                old_size INTEGER,
                new_size INTEGER,
                details_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (scan_id) REFERENCES scan_results(scan_id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_file_diffs_scan_id ON file_diffs(scan_id);
            
            -- Event chain table (tamper-evident log)
            CREATE TABLE IF NOT EXISTS event_chain (
                event_id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                event_type TEXT NOT NULL,
                path_id TEXT,
                payload_json TEXT NOT NULL DEFAULT '{}',
                prev_hash_hex TEXT NOT NULL,
                event_hash_hex TEXT NOT NULL,
                signature_hex TEXT NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_event_chain_ts ON event_chain(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_event_chain_type ON event_chain(event_type);
            CREATE INDEX IF NOT EXISTS idx_event_chain_path_id ON event_chain(path_id);
            
            -- Record schema version
            INSERT OR REPLACE INTO schema_version (version) VALUES (1);
        "#)?;
        
        Ok(())
    }
    
    // ========================================================================
    // Protected Paths CRUD
    // ========================================================================
    
    /// Insert a new protected path
    pub fn insert_protected_path(&self, path: &ProtectedPath) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let settings_json = serde_json::to_string(&path.settings)?;
        
        conn.execute(
            "INSERT INTO protected_paths (id, path, display_name, created_at, status, last_scan_at, baseline_version, settings_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                path.id,
                path.path,
                path.display_name,
                path.created_at.to_rfc3339(),
                path.status.as_str(),
                path.last_scan_at.map(|t| t.to_rfc3339()),
                path.baseline_version,
                settings_json,
            ],
        )?;
        
        Ok(())
    }
    
    /// Get a protected path by ID
    pub fn get_protected_path(&self, id: &str) -> Result<Option<ProtectedPath>> {
        let conn = self.conn.lock().unwrap();
        
        conn.query_row(
            "SELECT id, path, display_name, created_at, status, last_scan_at, baseline_version, settings_json
             FROM protected_paths WHERE id = ?1",
            params![id],
            |row| self.row_to_protected_path(row),
        ).optional().map_err(Into::into)
    }
    
    /// Get a protected path by path string
    pub fn get_protected_path_by_path(&self, path: &str) -> Result<Option<ProtectedPath>> {
        let conn = self.conn.lock().unwrap();
        
        conn.query_row(
            "SELECT id, path, display_name, created_at, status, last_scan_at, baseline_version, settings_json
             FROM protected_paths WHERE path = ?1",
            params![path],
            |row| self.row_to_protected_path(row),
        ).optional().map_err(Into::into)
    }
    
    /// Get all protected paths
    pub fn get_all_protected_paths(&self) -> Result<Vec<ProtectedPath>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path, display_name, created_at, status, last_scan_at, baseline_version, settings_json
             FROM protected_paths ORDER BY created_at DESC"
        )?;
        
        let paths = stmt.query_map([], |row| self.row_to_protected_path(row))?
            .filter_map(|r| r.ok())
            .collect();
        
        Ok(paths)
    }
    
    /// Update protected path status
    pub fn update_path_status(&self, id: &str, status: PathStatus, last_scan_at: Option<DateTime<Utc>>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE protected_paths SET status = ?1, last_scan_at = ?2 WHERE id = ?3",
            params![
                status.as_str(),
                last_scan_at.map(|t| t.to_rfc3339()),
                id,
            ],
        )?;
        
        Ok(())
    }
    
    /// Increment baseline version
    pub fn increment_baseline_version(&self, id: &str) -> Result<i32> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE protected_paths SET baseline_version = baseline_version + 1 WHERE id = ?1",
            params![id],
        )?;
        
        let version: i32 = conn.query_row(
            "SELECT baseline_version FROM protected_paths WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        
        Ok(version)
    }
    
    /// Delete a protected path (cascades to baselines, scans, diffs)
    pub fn delete_protected_path(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM protected_paths WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    fn row_to_protected_path(&self, row: &rusqlite::Row) -> rusqlite::Result<ProtectedPath> {
        let settings_json: String = row.get(7)?;
        let settings: PathSettings = serde_json::from_str(&settings_json).unwrap_or_default();
        
        let created_at_str: String = row.get(3)?;
        let last_scan_str: Option<String> = row.get(5)?;
        
        Ok(ProtectedPath {
            id: row.get(0)?,
            path: row.get(1)?,
            display_name: row.get(2)?,
            created_at: DateTime::parse_from_rfc3339(&created_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            status: PathStatus::from_str(&row.get::<_, String>(4)?),
            last_scan_at: last_scan_str.and_then(|s| 
                DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc))
            ),
            baseline_version: row.get(6)?,
            settings,
        })
    }
    
    // ========================================================================
    // Baseline Files
    // ========================================================================
    
    /// Insert baseline files in batch
    pub fn insert_baseline_files(&self, files: &[BaselineFile]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO baseline_files 
                 (path_id, rel_path, size, mtime, mode, hash_algo, hash_hex, chunk_size, chunk_hashes_json, baseline_version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
            )?;
            
            for file in files {
                let chunk_hashes_json = file.chunk_hashes.as_ref()
                    .map(|h| serde_json::to_string(h).unwrap_or_default());
                
                stmt.execute(params![
                    file.path_id,
                    file.rel_path,
                    file.size as i64,
                    file.mtime,
                    file.mode,
                    file.hash_algo,
                    file.hash_hex,
                    file.chunk_size.map(|s| s as i64),
                    chunk_hashes_json,
                    file.baseline_version,
                ])?;
            }
        }
        
        tx.commit()?;
        Ok(())
    }
    
    /// Get all baseline files for a path and version
    pub fn get_baseline_files(&self, path_id: &str, version: i32) -> Result<Vec<BaselineFile>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT path_id, rel_path, size, mtime, mode, hash_algo, hash_hex, chunk_size, chunk_hashes_json, baseline_version
             FROM baseline_files WHERE path_id = ?1 AND baseline_version = ?2"
        )?;
        
        let files = stmt.query_map(params![path_id, version], |row| {
            let chunk_hashes_json: Option<String> = row.get(8)?;
            let chunk_hashes: Option<Vec<String>> = chunk_hashes_json
                .and_then(|s| serde_json::from_str(&s).ok());
            
            Ok(BaselineFile {
                path_id: row.get(0)?,
                rel_path: row.get(1)?,
                size: row.get::<_, i64>(2)? as u64,
                mtime: row.get(3)?,
                mode: row.get(4)?,
                hash_algo: row.get(5)?,
                hash_hex: row.get(6)?,
                chunk_size: row.get::<_, Option<i64>>(7)?.map(|s| s as u64),
                chunk_hashes,
                baseline_version: row.get(9)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
        
        Ok(files)
    }
    
    /// Get baseline file count for a path
    pub fn get_baseline_file_count(&self, path_id: &str, version: i32) -> Result<u64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM baseline_files WHERE path_id = ?1 AND baseline_version = ?2",
            params![path_id, version],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }
    
    /// Get total size of baseline files
    pub fn get_baseline_total_size(&self, path_id: &str, version: i32) -> Result<u64> {
        let conn = self.conn.lock().unwrap();
        let size: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size), 0) FROM baseline_files WHERE path_id = ?1 AND baseline_version = ?2",
            params![path_id, version],
            |row| row.get(0),
        )?;
        Ok(size as u64)
    }
    
    /// Delete old baseline versions (keep last N)
    pub fn prune_old_baselines(&self, path_id: &str, keep_versions: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        // Get current version
        let current_version: i32 = conn.query_row(
            "SELECT baseline_version FROM protected_paths WHERE id = ?1",
            params![path_id],
            |row| row.get(0),
        ).unwrap_or(0);
        
        let min_version = current_version - keep_versions + 1;
        if min_version > 0 {
            conn.execute(
                "DELETE FROM baseline_files WHERE path_id = ?1 AND baseline_version < ?2",
                params![path_id, min_version],
            )?;
        }
        
        Ok(())
    }
    
    // ========================================================================
    // Scan Results
    // ========================================================================
    
    /// Insert a scan result
    pub fn insert_scan_result(&self, scan: &ScanResult) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let totals_json = serde_json::to_string(&scan.totals)?;
        
        conn.execute(
            "INSERT INTO scan_results (scan_id, path_id, started_at, finished_at, totals_json, result_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                scan.scan_id,
                scan.path_id,
                scan.started_at.to_rfc3339(),
                scan.finished_at.map(|t| t.to_rfc3339()),
                totals_json,
                scan.result_status.as_str(),
            ],
        )?;
        
        Ok(())
    }
    
    /// Update scan result when finished
    pub fn update_scan_result(&self, scan_id: &str, finished_at: DateTime<Utc>, totals: &ScanTotals, status: ScanResultStatus) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let totals_json = serde_json::to_string(totals)?;
        
        conn.execute(
            "UPDATE scan_results SET finished_at = ?1, totals_json = ?2, result_status = ?3 WHERE scan_id = ?4",
            params![
                finished_at.to_rfc3339(),
                totals_json,
                status.as_str(),
                scan_id,
            ],
        )?;
        
        Ok(())
    }
    
    /// Get latest scan result for a path
    pub fn get_latest_scan_result(&self, path_id: &str) -> Result<Option<ScanResult>> {
        let conn = self.conn.lock().unwrap();
        
        conn.query_row(
            "SELECT scan_id, path_id, started_at, finished_at, totals_json, result_status
             FROM scan_results WHERE path_id = ?1 ORDER BY started_at DESC LIMIT 1",
            params![path_id],
            |row| self.row_to_scan_result(row),
        ).optional().map_err(Into::into)
    }
    
    fn row_to_scan_result(&self, row: &rusqlite::Row) -> rusqlite::Result<ScanResult> {
        let totals_json: String = row.get(4)?;
        let started_at_str: String = row.get(2)?;
        let finished_at_str: Option<String> = row.get(3)?;
        
        Ok(ScanResult {
            scan_id: row.get(0)?,
            path_id: row.get(1)?,
            started_at: DateTime::parse_from_rfc3339(&started_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
            finished_at: finished_at_str.and_then(|s|
                DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc))
            ),
            totals: serde_json::from_str(&totals_json).unwrap_or_default(),
            result_status: ScanResultStatus::from_str(&row.get::<_, String>(5)?),
        })
    }
    
    // ========================================================================
    // File Diffs
    // ========================================================================
    
    /// Insert file diffs in batch
    pub fn insert_file_diffs(&self, diffs: &[FileDiff]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        
        {
            let mut stmt = tx.prepare(
                "INSERT INTO file_diffs (scan_id, rel_path, change_type, old_hash, new_hash, old_size, new_size, details_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
            )?;
            
            for diff in diffs {
                let details_json = serde_json::to_string(&diff.details)?;
                stmt.execute(params![
                    diff.scan_id,
                    diff.rel_path,
                    diff.change_type.as_str(),
                    diff.old_hash,
                    diff.new_hash,
                    diff.old_size.map(|s| s as i64),
                    diff.new_size.map(|s| s as i64),
                    details_json,
                ])?;
            }
        }
        
        tx.commit()?;
        Ok(())
    }
    
    /// Get file diffs for a scan
    pub fn get_file_diffs(&self, scan_id: &str) -> Result<Vec<FileDiff>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT scan_id, rel_path, change_type, old_hash, new_hash, old_size, new_size, details_json
             FROM file_diffs WHERE scan_id = ?1"
        )?;
        
        let diffs = stmt.query_map(params![scan_id], |row| {
            let details_json: String = row.get(7)?;
            Ok(FileDiff {
                scan_id: row.get(0)?,
                rel_path: row.get(1)?,
                change_type: ChangeType::from_str(&row.get::<_, String>(2)?),
                old_hash: row.get(3)?,
                new_hash: row.get(4)?,
                old_size: row.get::<_, Option<i64>>(5)?.map(|s| s as u64),
                new_size: row.get::<_, Option<i64>>(6)?.map(|s| s as u64),
                details: serde_json::from_str(&details_json).unwrap_or_default(),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
        
        Ok(diffs)
    }
    
    // ========================================================================
    // Event Chain
    // ========================================================================
    
    /// Insert an event into the chain
    pub fn insert_chain_event(&self, event: &ChainEvent) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT INTO event_chain (event_id, ts, event_type, path_id, payload_json, prev_hash_hex, event_hash_hex, signature_hex)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                event.event_id,
                event.timestamp.to_rfc3339(),
                event.event_type.as_str(),
                event.path_id,
                serde_json::to_string(&event.payload)?,
                event.prev_hash_hex,
                event.event_hash_hex,
                event.signature_hex,
            ],
        )?;
        
        Ok(())
    }
    
    /// Get the last event hash (for chaining)
    pub fn get_last_event_hash(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        conn.query_row(
            "SELECT event_hash_hex FROM event_chain ORDER BY ts DESC LIMIT 1",
            [],
            |row| row.get(0),
        ).optional().map_err(Into::into)
    }
    
    /// Get all events for verification
    pub fn get_all_events(&self) -> Result<Vec<ChainEvent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT event_id, ts, event_type, path_id, payload_json, prev_hash_hex, event_hash_hex, signature_hex
             FROM event_chain ORDER BY ts ASC"
        )?;
        
        let events = stmt.query_map([], |row| {
            let ts_str: String = row.get(1)?;
            let payload_json: String = row.get(4)?;
            
            Ok(ChainEvent {
                event_id: row.get(0)?,
                timestamp: DateTime::parse_from_rfc3339(&ts_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                event_type: EventType::from_str(&row.get::<_, String>(2)?),
                path_id: row.get(3)?,
                payload: serde_json::from_str(&payload_json).unwrap_or(serde_json::Value::Null),
                prev_hash_hex: row.get(5)?,
                event_hash_hex: row.get(6)?,
                signature_hex: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
        
        Ok(events)
    }
    
    /// Get recent events (for UI)
    pub fn get_recent_events(&self, limit: u32) -> Result<Vec<ChainEvent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT event_id, ts, event_type, path_id, payload_json, prev_hash_hex, event_hash_hex, signature_hex
             FROM event_chain ORDER BY ts DESC LIMIT ?1"
        )?;
        
        let events = stmt.query_map(params![limit], |row| {
            let ts_str: String = row.get(1)?;
            let payload_json: String = row.get(4)?;
            
            Ok(ChainEvent {
                event_id: row.get(0)?,
                timestamp: DateTime::parse_from_rfc3339(&ts_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                event_type: EventType::from_str(&row.get::<_, String>(2)?),
                path_id: row.get(3)?,
                payload: serde_json::from_str(&payload_json).unwrap_or(serde_json::Value::Null),
                prev_hash_hex: row.get(5)?,
                event_hash_hex: row.get(6)?,
                signature_hex: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
        
        Ok(events)
    }
    
    /// Clear all events (danger zone)
    pub fn clear_event_chain(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM event_chain", [])?;
        Ok(())
    }
    
    /// Get event count
    pub fn get_event_count(&self) -> Result<u64> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM event_chain",
            [],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }
}
