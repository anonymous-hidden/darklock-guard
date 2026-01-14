"""
Audit Log for FileGuard
=======================
Append-only, cryptographically signed log of all protection events.
Provides a complete history of what happened to protected files,
when, and what actions were taken.

Design Philosophy:
- Append-only for integrity (no deletions, no modifications)
- Each entry is HMAC-signed to detect tampering
- Human-readable format for transparency
- Structured data for filtering and searching
"""

import os
import json
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any, Generator, Tuple
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum

from .crypto import CryptoEngine


class EventSeverity(Enum):
    """
    Severity levels for audit events.
    
    Used for filtering and visual indicators in the UI.
    """
    INFO = 'info'           # Normal operations
    WARNING = 'warning'     # Potential issues
    ALERT = 'alert'         # Tamper detection
    CRITICAL = 'critical'   # Failed restoration, errors


class EventType(Enum):
    """
    Types of events that can be logged.
    """
    # Protection management
    FILE_PROTECTED = 'file_protected'
    FILE_UNPROTECTED = 'file_unprotected'
    PROTECTION_MODE_CHANGED = 'protection_mode_changed'
    
    # Detection events
    TAMPER_DETECTED = 'tamper_detected'
    FILE_DELETED = 'file_deleted'
    FILE_RENAMED = 'file_renamed'
    PERMISSIONS_CHANGED = 'permissions_changed'
    
    # Response events
    FILE_RESTORED = 'file_restored'
    RESTORE_FAILED = 'restore_failed'
    FILE_SEALED = 'file_sealed'
    FILE_UNSEALED = 'file_unsealed'
    
    # Verification events
    VERIFICATION_PASSED = 'verification_passed'
    VERIFICATION_FAILED = 'verification_failed'
    
    # System events
    SERVICE_STARTED = 'service_started'
    SERVICE_STOPPED = 'service_stopped'
    BACKUP_CREATED = 'backup_created'
    BACKUP_DELETED = 'backup_deleted'
    SETTINGS_CHANGED = 'settings_changed'


@dataclass
class AuditEntry:
    """
    A single entry in the audit log.
    
    Contains all information about an event with a human-readable
    explanation of what happened and why.
    """
    id: str                          # Unique entry identifier
    timestamp: datetime              # When it happened
    event_type: EventType            # What type of event
    severity: EventSeverity          # How serious
    file_path: Optional[str]         # Affected file (if applicable)
    
    # Hash information for tamper events
    old_hash: Optional[str] = None
    new_hash: Optional[str] = None
    
    # What was done in response
    action_taken: str = ''
    
    # Human-readable explanation
    explanation: str = ''
    
    # Additional context
    details: Dict[str, Any] = field(default_factory=dict)
    
    # Cryptographic signature (HMAC)
    signature: Optional[str] = None
    
    # For chain integrity - hash of previous entry
    previous_hash: Optional[str] = None
    
    def to_dict(self) -> dict:
        """Serialize to dictionary for storage."""
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'event_type': self.event_type.value,
            'severity': self.severity.value,
            'file_path': self.file_path,
            'old_hash': self.old_hash,
            'new_hash': self.new_hash,
            'action_taken': self.action_taken,
            'explanation': self.explanation,
            'details': self.details,
            'signature': self.signature,
            'previous_hash': self.previous_hash,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'AuditEntry':
        """Deserialize from dictionary."""
        return cls(
            id=data['id'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            event_type=EventType(data['event_type']),
            severity=EventSeverity(data['severity']),
            file_path=data.get('file_path'),
            old_hash=data.get('old_hash'),
            new_hash=data.get('new_hash'),
            action_taken=data.get('action_taken', ''),
            explanation=data.get('explanation', ''),
            details=data.get('details', {}),
            signature=data.get('signature'),
            previous_hash=data.get('previous_hash'),
        )
    
    def to_signable_string(self) -> str:
        """
        Create a canonical string representation for signing.
        
        Excludes the signature field itself to avoid circular dependency.
        """
        parts = [
            self.id,
            self.timestamp.isoformat(),
            self.event_type.value,
            self.severity.value,
            self.file_path or '',
            self.old_hash or '',
            self.new_hash or '',
            self.action_taken,
            self.explanation,
            json.dumps(self.details, sort_keys=True),
            self.previous_hash or '',
        ]
        return '|'.join(parts)
    
    def to_human_readable(self) -> str:
        """
        Format the entry as human-readable text.
        
        This is what users see in the activity log.
        """
        time_str = self.timestamp.strftime('%Y-%m-%d %H:%M:%S')
        severity_icon = {
            EventSeverity.INFO: 'ℹ️',
            EventSeverity.WARNING: '⚠️',
            EventSeverity.ALERT: '🚨',
            EventSeverity.CRITICAL: '❌',
        }.get(self.severity, '•')
        
        lines = [
            f"{severity_icon} [{time_str}]",
            f"   {self.explanation}",
        ]
        
        if self.file_path:
            # Show just the filename for brevity
            filename = Path(self.file_path).name
            lines.append(f"   File: {filename}")
        
        if self.action_taken:
            lines.append(f"   Action: {self.action_taken}")
        
        return '\n'.join(lines)


class AuditLog:
    """
    Append-only audit log with cryptographic signing.
    
    Entries are stored in a JSON Lines format (one JSON object per line)
    for efficient appending and streaming reads.
    
    Chain integrity is maintained by including the hash of the previous
    entry in each new entry, similar to blockchain.
    """
    
    def __init__(
        self,
        log_path: Path,
        crypto: Optional[CryptoEngine] = None,
        sign_entries: bool = True
    ):
        """
        Initialize the audit log.
        
        Args:
            log_path: Path to the log file
            crypto: CryptoEngine for signing (required if sign_entries=True)
            sign_entries: Whether to HMAC-sign each entry
        """
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        
        self.crypto = crypto
        self.sign_entries = sign_entries
        
        # Thread safety for writes
        self._write_lock = threading.Lock()
        
        # Track last entry hash for chain integrity
        self._last_hash: Optional[str] = None
        self._entry_count = 0
        
        # Initialize chain from existing log
        self._initialize_chain()
    
    def _initialize_chain(self) -> None:
        """
        Read existing log to get last entry hash.
        
        This maintains chain integrity across restarts.
        """
        if not self.log_path.exists():
            return
        
        try:
            # Read last line of log file
            with open(self.log_path, 'r', encoding='utf-8') as f:
                last_line = None
                for line in f:
                    if line.strip():
                        last_line = line
                        self._entry_count += 1
                
                if last_line:
                    entry_data = json.loads(last_line)
                    entry = AuditEntry.from_dict(entry_data)
                    # Hash this entry to be the previous_hash for next entry
                    self._last_hash = self._hash_entry(entry)
                    
        except Exception as e:
            print(f"Warning: Could not initialize audit chain: {e}")
    
    def _hash_entry(self, entry: AuditEntry) -> str:
        """Create a hash of an entry for chain integrity."""
        from .hasher import IntegrityHasher
        hasher = IntegrityHasher()
        return hasher.hash_string(entry.to_signable_string())
    
    def _generate_id(self) -> str:
        """Generate a unique entry ID."""
        import uuid
        return str(uuid.uuid4())[:8]
    
    def _sign_entry(self, entry: AuditEntry) -> str:
        """
        Create HMAC signature for an entry.
        
        Returns:
            Hex-encoded signature string
        """
        if not self.crypto or not self.crypto.is_initialized():
            return ''
        
        signable = entry.to_signable_string()
        signature = self.crypto.generate_hmac(signable.encode('utf-8'))
        return signature.hex()
    
    def log(
        self,
        event_type: EventType,
        severity: EventSeverity,
        explanation: str,
        file_path: Optional[str] = None,
        old_hash: Optional[str] = None,
        new_hash: Optional[str] = None,
        action_taken: str = '',
        details: Optional[Dict[str, Any]] = None
    ) -> AuditEntry:
        """
        Add an entry to the audit log.
        
        This is the primary method for logging events. It handles:
        - ID generation
        - Timestamping
        - Chain integrity (previous_hash)
        - Signing (if enabled)
        - Atomic append to log file
        
        Args:
            event_type: Type of event
            severity: Severity level
            explanation: Human-readable description
            file_path: Affected file path
            old_hash: Previous file hash (for tamper events)
            new_hash: Current file hash (for tamper events)
            action_taken: What was done in response
            details: Additional context
            
        Returns:
            The created AuditEntry
        """
        with self._write_lock:
            # Create entry
            entry = AuditEntry(
                id=self._generate_id(),
                timestamp=datetime.now(),
                event_type=event_type,
                severity=severity,
                file_path=file_path,
                old_hash=old_hash,
                new_hash=new_hash,
                action_taken=action_taken,
                explanation=explanation,
                details=details or {},
                previous_hash=self._last_hash,
            )
            
            # Sign if enabled
            if self.sign_entries and self.crypto:
                entry.signature = self._sign_entry(entry)
            
            # Append to log file
            self._append_entry(entry)
            
            # Update chain state
            self._last_hash = self._hash_entry(entry)
            self._entry_count += 1
            
            return entry
    
    def _append_entry(self, entry: AuditEntry) -> None:
        """
        Append an entry to the log file.
        
        Uses append mode and flushes to ensure durability.
        """
        try:
            with open(self.log_path, 'a', encoding='utf-8') as f:
                json_line = json.dumps(entry.to_dict())
                f.write(json_line + '\n')
                f.flush()
                os.fsync(f.fileno())  # Ensure written to disk
        except Exception as e:
            print(f"Failed to write audit entry: {e}")
    
    def read_entries(
        self,
        limit: Optional[int] = None,
        file_path_filter: Optional[str] = None,
        severity_filter: Optional[EventSeverity] = None,
        event_type_filter: Optional[EventType] = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None
    ) -> List[AuditEntry]:
        """
        Read entries from the log with optional filtering.
        
        Args:
            limit: Maximum entries to return (None = all)
            file_path_filter: Only entries for this file path
            severity_filter: Only entries with this severity
            event_type_filter: Only entries of this type
            since: Only entries after this time
            until: Only entries before this time
            
        Returns:
            List of matching AuditEntry objects (newest first)
        """
        if not self.log_path.exists():
            return []
        
        entries = []
        
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip():
                        continue
                    
                    try:
                        data = json.loads(line)
                        entry = AuditEntry.from_dict(data)
                        
                        # Apply filters
                        if file_path_filter and entry.file_path != file_path_filter:
                            continue
                        if severity_filter and entry.severity != severity_filter:
                            continue
                        if event_type_filter and entry.event_type != event_type_filter:
                            continue
                        if since and entry.timestamp < since:
                            continue
                        if until and entry.timestamp > until:
                            continue
                        
                        entries.append(entry)
                        
                    except Exception:
                        continue  # Skip malformed entries
            
            # Reverse to get newest first
            entries.reverse()
            
            # Apply limit
            if limit:
                entries = entries[:limit]
            
            return entries
            
        except Exception as e:
            print(f"Failed to read audit log: {e}")
            return []
    
    def stream_entries(self) -> Generator[AuditEntry, None, None]:
        """
        Stream entries from the log file.
        
        Memory-efficient for large logs.
        
        Yields:
            AuditEntry objects in order (oldest first)
        """
        if not self.log_path.exists():
            return
        
        try:
            with open(self.log_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if not line.strip():
                        continue
                    
                    try:
                        data = json.loads(line)
                        yield AuditEntry.from_dict(data)
                    except Exception:
                        continue
        except Exception as e:
            print(f"Error streaming audit log: {e}")
    
    def verify_integrity(self) -> Tuple[bool, List[str]]:
        """
        Verify the integrity of the audit log.
        
        Checks:
        1. Chain integrity (previous_hash values)
        2. Entry signatures (if signed)
        
        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        previous_hash = None
        
        for entry in self.stream_entries():
            # Check chain integrity
            if previous_hash is not None and entry.previous_hash != previous_hash:
                issues.append(f"Chain break at entry {entry.id}: "
                            f"expected {previous_hash[:8]}..., "
                            f"got {entry.previous_hash[:8] if entry.previous_hash else 'None'}...")
            
            # Check signature
            if self.sign_entries and self.crypto and entry.signature:
                expected_sig = self._sign_entry(entry)
                if entry.signature != expected_sig:
                    issues.append(f"Invalid signature on entry {entry.id}")
            
            # Update for next iteration
            previous_hash = self._hash_entry(entry)
        
        return len(issues) == 0, issues
    
    def get_entry_count(self) -> int:
        """Get total number of entries in the log."""
        return self._entry_count
    
    def get_recent_alerts(self, limit: int = 10) -> List[AuditEntry]:
        """Get recent alert-level entries."""
        return self.read_entries(
            limit=limit,
            severity_filter=EventSeverity.ALERT
        )
    
    def get_file_history(self, file_path: str, limit: int = 50) -> List[AuditEntry]:
        """Get history for a specific file."""
        return self.read_entries(
            limit=limit,
            file_path_filter=file_path
        )
    
    def export_human_readable(self, output_path: Path) -> bool:
        """
        Export the log as human-readable text.
        
        Args:
            output_path: Path to write the export
            
        Returns:
            True if export succeeded
        """
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write("FileGuard Audit Log Export\n")
                f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write("=" * 60 + "\n\n")
                
                for entry in self.stream_entries():
                    f.write(entry.to_human_readable())
                    f.write("\n\n")
            
            return True
        except Exception as e:
            print(f"Export failed: {e}")
            return False
    
    def clear(self) -> bool:
        """
        Clear the audit log.
        
        WARNING: This destroys all audit history and cannot be undone.
        Should require user confirmation in the UI.
        
        Returns:
            True if cleared successfully
        """
        with self._write_lock:
            try:
                if self.log_path.exists():
                    self.log_path.unlink()
                
                self._last_hash = None
                self._entry_count = 0
                
                # Log that the log was cleared (meta!)
                self.log(
                    event_type=EventType.SETTINGS_CHANGED,
                    severity=EventSeverity.WARNING,
                    explanation="Audit log was cleared by user"
                )
                
                return True
            except Exception as e:
                print(f"Failed to clear audit log: {e}")
                return False


# Convenience functions for common log entries

def log_file_protected(
    audit: AuditLog,
    file_path: str,
    mode: str,
    hash_value: str
) -> AuditEntry:
    """Log that a file was added to protection."""
    return audit.log(
        event_type=EventType.FILE_PROTECTED,
        severity=EventSeverity.INFO,
        explanation=f"File added to protection with mode: {mode}",
        file_path=file_path,
        new_hash=hash_value,
        action_taken="File is now monitored for changes"
    )


def log_tamper_detected(
    audit: AuditLog,
    file_path: str,
    old_hash: str,
    new_hash: str,
    action_taken: str
) -> AuditEntry:
    """Log that tampering was detected."""
    return audit.log(
        event_type=EventType.TAMPER_DETECTED,
        severity=EventSeverity.ALERT,
        explanation="File content was modified without authorization",
        file_path=file_path,
        old_hash=old_hash,
        new_hash=new_hash,
        action_taken=action_taken
    )


def log_file_restored(
    audit: AuditLog,
    file_path: str,
    restored_hash: str
) -> AuditEntry:
    """Log that a file was restored from backup."""
    return audit.log(
        event_type=EventType.FILE_RESTORED,
        severity=EventSeverity.INFO,
        explanation="File was restored to its protected state from backup",
        file_path=file_path,
        new_hash=restored_hash,
        action_taken="Content restored from encrypted backup"
    )
