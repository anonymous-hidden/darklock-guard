"""
Baseline Manager for FileGuard
==============================
Manages the SQLite database that stores file protection metadata.
This is the "source of truth" for what files are protected and
what state they should be in.

Database Schema:
- protected_items: Files/folders under protection
- verification_history: Historical verification results
- settings: App configuration key-value store

Design Philosophy:
- All database operations are atomic
- Schema versioning for future migrations
- Connection pooling is handled by SQLite's built-in mechanisms
"""

import sqlite3
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
import json
import threading


# Current schema version - increment when schema changes
SCHEMA_VERSION = 1


class ProtectionMode(Enum):
    """
    Available protection modes for files/folders.
    
    DETECT_ONLY: Monitor for changes, no automatic action
    DETECT_ALERT: Monitor and show notifications on changes
    DETECT_RESTORE: Monitor and automatically restore on changes
    SEALED: Prevent all modifications until explicitly unlocked
    """
    DETECT_ONLY = 'detect_only'
    DETECT_ALERT = 'detect_alert'
    DETECT_RESTORE = 'detect_restore'
    SEALED = 'sealed'


@dataclass
class ProtectedItem:
    """
    Represents a file or folder under protection.
    
    Contains all metadata needed for monitoring and restoration.
    """
    id: int
    path: str
    item_type: str  # 'file' or 'folder'
    hash: str
    size: int
    modified_time: float
    permissions: int
    protection_mode: ProtectionMode
    backup_path: Optional[str]
    created_at: datetime
    last_verified: Optional[datetime]
    is_locked: bool  # For seal mode
    
    @classmethod
    def from_row(cls, row: sqlite3.Row) -> 'ProtectedItem':
        """Create from database row."""
        return cls(
            id=row['id'],
            path=row['path'],
            item_type=row['item_type'],
            hash=row['hash'],
            size=row['size'],
            modified_time=row['modified_time'],
            permissions=row['permissions'],
            protection_mode=ProtectionMode(row['protection_mode']),
            backup_path=row['backup_path'],
            created_at=datetime.fromisoformat(row['created_at']),
            last_verified=datetime.fromisoformat(row['last_verified']) if row['last_verified'] else None,
            is_locked=bool(row['is_locked']),
        )


@dataclass
class VerificationRecord:
    """
    Record of a verification check result.
    """
    id: int
    item_id: int
    verified_at: datetime
    previous_hash: str
    current_hash: str
    status: str  # 'unchanged', 'modified', 'missing', 'error'
    action_taken: str
    details: Optional[str]


class BaselineManager:
    """
    Central database manager for all protection state.
    
    Handles:
    - Creating and migrating database schema
    - CRUD operations for protected items
    - Verification history tracking
    - Thread-safe database access
    """
    
    def __init__(self, db_path: Path):
        """
        Initialize the baseline manager.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Thread-local storage for connections
        self._local = threading.local()
        
        # Initialize schema
        self._initialize_schema()
    
    def _get_connection(self) -> sqlite3.Connection:
        """
        Get a database connection for the current thread.
        
        SQLite connections shouldn't be shared across threads,
        so we maintain one per thread.
        """
        if not hasattr(self._local, 'connection') or self._local.connection is None:
            conn = sqlite3.connect(
                str(self.db_path),
                check_same_thread=False,
                timeout=30.0
            )
            conn.row_factory = sqlite3.Row
            # Enable foreign keys
            conn.execute("PRAGMA foreign_keys = ON")
            self._local.connection = conn
        return self._local.connection
    
    @contextmanager
    def _transaction(self):
        """
        Context manager for database transactions.
        
        Automatically commits on success, rolls back on exception.
        """
        conn = self._get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    
    def _initialize_schema(self) -> None:
        """
        Create or migrate the database schema.
        
        Uses a version table to track schema versions and
        apply migrations when needed.
        """
        with self._transaction() as conn:
            # Create version tracking table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
            """)
            
            # Check current version
            cursor = conn.execute(
                "SELECT MAX(version) as version FROM schema_version"
            )
            row = cursor.fetchone()
            current_version = row['version'] if row['version'] else 0
            
            # Apply migrations
            if current_version < 1:
                self._apply_schema_v1(conn)
    
    def _apply_schema_v1(self, conn: sqlite3.Connection) -> None:
        """
        Apply version 1 of the schema.
        
        Creates all initial tables for file protection.
        """
        # Main protected items table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS protected_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                item_type TEXT NOT NULL CHECK (item_type IN ('file', 'folder')),
                hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                modified_time REAL NOT NULL,
                permissions INTEGER NOT NULL,
                protection_mode TEXT NOT NULL,
                backup_path TEXT,
                created_at TEXT NOT NULL,
                last_verified TEXT,
                is_locked INTEGER NOT NULL DEFAULT 0
            )
        """)
        
        # Index for quick path lookups
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_protected_items_path 
            ON protected_items(path)
        """)
        
        # Verification history table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS verification_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL,
                verified_at TEXT NOT NULL,
                previous_hash TEXT NOT NULL,
                current_hash TEXT,
                status TEXT NOT NULL,
                action_taken TEXT,
                details TEXT,
                FOREIGN KEY (item_id) REFERENCES protected_items(id) ON DELETE CASCADE
            )
        """)
        
        # Index for history queries
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_verification_history_item 
            ON verification_history(item_id, verified_at)
        """)
        
        # Key-value settings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        
        # Folder contents tracking (for folder protection)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS folder_contents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL,
                relative_path TEXT NOT NULL,
                hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                FOREIGN KEY (folder_id) REFERENCES protected_items(id) ON DELETE CASCADE,
                UNIQUE(folder_id, relative_path)
            )
        """)
        
        # Record schema version
        conn.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
            (1, datetime.now().isoformat())
        )
    
    # =========================================================================
    # Protected Items CRUD
    # =========================================================================
    
    def add_protected_item(
        self,
        path: str,
        item_type: str,
        hash_value: str,
        size: int,
        modified_time: float,
        permissions: int,
        protection_mode: ProtectionMode,
        backup_path: Optional[str] = None
    ) -> int:
        """
        Add a new item to protection.
        
        Args:
            path: Absolute path to file or folder
            item_type: 'file' or 'folder'
            hash_value: SHA-256 hash of contents
            size: File size in bytes
            modified_time: Last modification timestamp
            permissions: File permission bits
            protection_mode: How to handle tampering
            backup_path: Path to encrypted backup
            
        Returns:
            ID of the newly created protected item
        """
        with self._transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO protected_items 
                (path, item_type, hash, size, modified_time, permissions, 
                 protection_mode, backup_path, created_at, is_locked)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    path,
                    item_type,
                    hash_value,
                    size,
                    modified_time,
                    permissions,
                    protection_mode.value,
                    backup_path,
                    datetime.now().isoformat(),
                    1 if protection_mode == ProtectionMode.SEALED else 0
                )
            )
            return cursor.lastrowid
    
    def get_protected_item(self, item_id: int) -> Optional[ProtectedItem]:
        """Get a protected item by ID."""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM protected_items WHERE id = ?",
            (item_id,)
        )
        row = cursor.fetchone()
        return ProtectedItem.from_row(row) if row else None
    
    def get_protected_item_by_path(self, path: str) -> Optional[ProtectedItem]:
        """Get a protected item by its path."""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM protected_items WHERE path = ?",
            (path,)
        )
        row = cursor.fetchone()
        return ProtectedItem.from_row(row) if row else None
    
    def get_all_protected_items(self) -> List[ProtectedItem]:
        """Get all protected items."""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT * FROM protected_items ORDER BY created_at DESC"
        )
        return [ProtectedItem.from_row(row) for row in cursor.fetchall()]
    
    def update_protected_item(
        self,
        item_id: int,
        hash_value: Optional[str] = None,
        size: Optional[int] = None,
        modified_time: Optional[float] = None,
        permissions: Optional[int] = None,
        protection_mode: Optional[ProtectionMode] = None,
        backup_path: Optional[str] = None,
        last_verified: Optional[datetime] = None,
        is_locked: Optional[bool] = None
    ) -> bool:
        """
        Update a protected item's metadata.
        
        Only updates fields that are provided (not None).
        
        Returns:
            True if update succeeded
        """
        updates = []
        values = []
        
        if hash_value is not None:
            updates.append("hash = ?")
            values.append(hash_value)
        if size is not None:
            updates.append("size = ?")
            values.append(size)
        if modified_time is not None:
            updates.append("modified_time = ?")
            values.append(modified_time)
        if permissions is not None:
            updates.append("permissions = ?")
            values.append(permissions)
        if protection_mode is not None:
            updates.append("protection_mode = ?")
            values.append(protection_mode.value)
        if backup_path is not None:
            updates.append("backup_path = ?")
            values.append(backup_path)
        if last_verified is not None:
            updates.append("last_verified = ?")
            values.append(last_verified.isoformat())
        if is_locked is not None:
            updates.append("is_locked = ?")
            values.append(1 if is_locked else 0)
        
        if not updates:
            return False
        
        values.append(item_id)
        
        with self._transaction() as conn:
            cursor = conn.execute(
                f"UPDATE protected_items SET {', '.join(updates)} WHERE id = ?",
                values
            )
            return cursor.rowcount > 0
    
    def remove_protected_item(self, item_id: int) -> bool:
        """
        Remove an item from protection.
        
        This also cascades to delete verification history
        and folder contents.
        
        Returns:
            True if item was removed
        """
        with self._transaction() as conn:
            cursor = conn.execute(
                "DELETE FROM protected_items WHERE id = ?",
                (item_id,)
            )
            return cursor.rowcount > 0
    
    def is_path_protected(self, path: str) -> bool:
        """Check if a path is currently protected."""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT 1 FROM protected_items WHERE path = ?",
            (path,)
        )
        return cursor.fetchone() is not None
    
    def get_protected_count(self) -> int:
        """Get total count of protected items."""
        conn = self._get_connection()
        cursor = conn.execute("SELECT COUNT(*) as count FROM protected_items")
        return cursor.fetchone()['count']
    
    # =========================================================================
    # Verification History
    # =========================================================================
    
    def record_verification(
        self,
        item_id: int,
        previous_hash: str,
        current_hash: Optional[str],
        status: str,
        action_taken: str = '',
        details: Optional[str] = None
    ) -> int:
        """
        Record a verification check result.
        
        Args:
            item_id: ID of the protected item
            previous_hash: Expected hash from baseline
            current_hash: Actual computed hash (None if file missing)
            status: 'unchanged', 'modified', 'missing', 'error'
            action_taken: Description of automatic response
            details: Additional context
            
        Returns:
            ID of the verification record
        """
        with self._transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO verification_history 
                (item_id, verified_at, previous_hash, current_hash, status, action_taken, details)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    datetime.now().isoformat(),
                    previous_hash,
                    current_hash,
                    status,
                    action_taken,
                    details
                )
            )
            
            # Update last_verified timestamp on the protected item
            conn.execute(
                "UPDATE protected_items SET last_verified = ? WHERE id = ?",
                (datetime.now().isoformat(), item_id)
            )
            
            return cursor.lastrowid
    
    def get_verification_history(
        self,
        item_id: Optional[int] = None,
        limit: int = 100,
        status_filter: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get verification history records.
        
        Args:
            item_id: Filter to specific item (None for all)
            limit: Maximum records to return
            status_filter: Filter by status
            
        Returns:
            List of verification records as dictionaries
        """
        conn = self._get_connection()
        
        query = """
            SELECT vh.*, pi.path as item_path 
            FROM verification_history vh
            JOIN protected_items pi ON vh.item_id = pi.id
            WHERE 1=1
        """
        params = []
        
        if item_id is not None:
            query += " AND vh.item_id = ?"
            params.append(item_id)
        
        if status_filter:
            query += " AND vh.status = ?"
            params.append(status_filter)
        
        query += " ORDER BY vh.verified_at DESC LIMIT ?"
        params.append(limit)
        
        cursor = conn.execute(query, params)
        
        return [dict(row) for row in cursor.fetchall()]
    
    def get_last_verification(self, item_id: int) -> Optional[Dict[str, Any]]:
        """Get the most recent verification for an item."""
        history = self.get_verification_history(item_id=item_id, limit=1)
        return history[0] if history else None
    
    def get_tamper_events(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        """
        Get all tampering events (modified or missing status).
        
        Args:
            since: Only events after this time
            
        Returns:
            List of tamper event records
        """
        conn = self._get_connection()
        
        query = """
            SELECT vh.*, pi.path as item_path 
            FROM verification_history vh
            JOIN protected_items pi ON vh.item_id = pi.id
            WHERE vh.status IN ('modified', 'missing')
        """
        params = []
        
        if since:
            query += " AND vh.verified_at > ?"
            params.append(since.isoformat())
        
        query += " ORDER BY vh.verified_at DESC"
        
        cursor = conn.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]
    
    # =========================================================================
    # Folder Contents Tracking
    # =========================================================================
    
    def save_folder_contents(
        self,
        folder_id: int,
        contents: Dict[str, Tuple[str, int]]  # {relative_path: (hash, size)}
    ) -> None:
        """
        Save the contents manifest for a protected folder.
        
        Args:
            folder_id: ID of the protected folder
            contents: Dictionary mapping relative paths to (hash, size) tuples
        """
        with self._transaction() as conn:
            # Clear existing contents
            conn.execute(
                "DELETE FROM folder_contents WHERE folder_id = ?",
                (folder_id,)
            )
            
            # Insert new contents
            for relative_path, (hash_value, size) in contents.items():
                conn.execute(
                    """
                    INSERT INTO folder_contents (folder_id, relative_path, hash, size)
                    VALUES (?, ?, ?, ?)
                    """,
                    (folder_id, relative_path, hash_value, size)
                )
    
    def get_folder_contents(self, folder_id: int) -> Dict[str, Tuple[str, int]]:
        """
        Get the saved contents manifest for a folder.
        
        Returns:
            Dictionary mapping relative paths to (hash, size) tuples
        """
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT relative_path, hash, size FROM folder_contents WHERE folder_id = ?",
            (folder_id,)
        )
        
        return {
            row['relative_path']: (row['hash'], row['size'])
            for row in cursor.fetchall()
        }
    
    # =========================================================================
    # Settings Storage
    # =========================================================================
    
    def set_setting(self, key: str, value: Any) -> None:
        """
        Store a setting value.
        
        Values are JSON-serialized for storage.
        """
        with self._transaction() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                (key, json.dumps(value), datetime.now().isoformat())
            )
    
    def get_setting(self, key: str, default: Any = None) -> Any:
        """
        Retrieve a setting value.
        
        Args:
            key: Setting key
            default: Value to return if key doesn't exist
            
        Returns:
            The stored value, or default if not found
        """
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT value FROM settings WHERE key = ?",
            (key,)
        )
        row = cursor.fetchone()
        
        if row:
            return json.loads(row['value'])
        return default
    
    def get_all_settings(self) -> Dict[str, Any]:
        """Get all settings as a dictionary."""
        conn = self._get_connection()
        cursor = conn.execute("SELECT key, value FROM settings")
        
        return {
            row['key']: json.loads(row['value'])
            for row in cursor.fetchall()
        }
    
    # =========================================================================
    # Statistics
    # =========================================================================
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        Get summary statistics about protection state.
        
        Returns:
            Dictionary with counts and status info
        """
        conn = self._get_connection()
        
        # Total protected items
        total_cursor = conn.execute("SELECT COUNT(*) as count FROM protected_items")
        total_count = total_cursor.fetchone()['count']
        
        # By type
        type_cursor = conn.execute(
            "SELECT item_type, COUNT(*) as count FROM protected_items GROUP BY item_type"
        )
        by_type = {row['item_type']: row['count'] for row in type_cursor.fetchall()}
        
        # By mode
        mode_cursor = conn.execute(
            "SELECT protection_mode, COUNT(*) as count FROM protected_items GROUP BY protection_mode"
        )
        by_mode = {row['protection_mode']: row['count'] for row in mode_cursor.fetchall()}
        
        # Recent tamper events (last 24 hours)
        from datetime import timedelta
        yesterday = (datetime.now() - timedelta(days=1)).isoformat()
        tamper_cursor = conn.execute(
            """
            SELECT COUNT(*) as count FROM verification_history 
            WHERE status IN ('modified', 'missing') AND verified_at > ?
            """,
            (yesterday,)
        )
        recent_tampers = tamper_cursor.fetchone()['count']
        
        # Last verification time
        last_ver_cursor = conn.execute(
            "SELECT MAX(last_verified) as last FROM protected_items"
        )
        last_verified = last_ver_cursor.fetchone()['last']
        
        return {
            'total_protected': total_count,
            'by_type': by_type,
            'by_mode': by_mode,
            'recent_tamper_events': recent_tampers,
            'last_verification': last_verified,
        }
    
    def close(self) -> None:
        """Close the database connection."""
        if hasattr(self._local, 'connection') and self._local.connection:
            self._local.connection.close()
            self._local.connection = None
