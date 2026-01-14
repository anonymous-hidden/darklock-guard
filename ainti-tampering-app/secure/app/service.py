"""
Protection Service for FileGuard
================================
Background service that coordinates all protection activities.
Acts as the central orchestrator connecting:
- File watching
- Integrity verification
- Tamper response
- Audit logging

This is the "brain" of the protection system.

Design Philosophy:
- Single point of coordination for all protection logic
- Event-driven architecture
- Clean separation from UI
- Thread-safe operations
"""

import os
import sys
import threading
from pathlib import Path
from typing import Optional, Dict, Callable, List, Any
from datetime import datetime
from dataclasses import dataclass
from queue import Queue, Empty
import time

from core.crypto import CryptoEngine
from core.hasher import IntegrityHasher, FileMetadata
from core.baseline import BaselineManager, ProtectionMode as DBProtectionMode
from core.policy import (
    ProtectionPolicy, 
    ProtectionMode, 
    PolicyEngine,
    ChangeType,
    ResponseAction,
    create_standard_policy
)
from core.watcher import FileWatcher, FileEvent, PeriodicVerifier
from core.restore import RestoreEngine
from core.audit_log import (
    AuditLog, 
    EventType, 
    EventSeverity,
    log_file_protected,
    log_tamper_detected,
    log_file_restored
)
from config.settings_manager import SettingsManager


@dataclass
class ProtectionStatus:
    """Current status of the protection system."""
    is_running: bool
    protected_count: int
    last_verification: Optional[datetime]
    recent_tamper_count: int
    overall_status: str  # 'safe', 'warning', 'tampered'


@dataclass 
class TamperEvent:
    """Details of a detected tamper event."""
    file_path: str
    change_type: ChangeType
    old_hash: Optional[str]
    new_hash: Optional[str]
    timestamp: datetime
    action_taken: str
    was_restored: bool


class ProtectionService:
    """
    Central protection service coordinating all security activities.
    
    Responsibilities:
    - Managing protected files/folders
    - Real-time monitoring
    - Tamper detection and response
    - Backup management
    - Audit logging
    """
    
    def __init__(self, app_data_dir: Path, settings: SettingsManager):
        """
        Initialize the protection service.
        
        Args:
            app_data_dir: Directory for app data (database, backups, logs)
            settings: Settings manager instance
        """
        self.app_data_dir = Path(app_data_dir)
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        
        self.settings = settings
        
        # Initialize core components
        self._init_components()
        
        # Event queue for UI notifications
        self._event_queue: Queue[Dict[str, Any]] = Queue()
        
        # Callbacks for UI updates
        self._tamper_callbacks: List[Callable[[TamperEvent], None]] = []
        self._status_callbacks: List[Callable[[ProtectionStatus], None]] = []
        
        # Service state
        self._running = False
        self._lock = threading.RLock()
    
    def _init_components(self) -> None:
        """Initialize all core components."""
        # Paths
        storage_dir = self.app_data_dir / 'storage'
        storage_dir.mkdir(exist_ok=True)
        
        # Crypto engine
        self.crypto = CryptoEngine(storage_dir)
        self.crypto.initialize_keys()
        
        # Hasher
        algorithm = self.settings.get('security.hash_algorithm', 'sha256')
        self.hasher = IntegrityHasher(algorithm)
        
        # Database
        db_path = storage_dir / 'integrity.db'
        self.baseline = BaselineManager(db_path)
        
        # Restore engine
        backup_dir = storage_dir / 'backups'
        max_versions = self.settings.get('security.backup_retention_count', 3)
        self.restore = RestoreEngine(backup_dir, self.crypto, max_versions)
        
        # Audit log
        log_path = storage_dir / 'audit.log'
        sign_logs = self.settings.get('advanced.signed_audit_logs', True)
        self.audit = AuditLog(log_path, self.crypto if sign_logs else None, sign_logs)
        
        # Policy engine
        self.policy_engine = PolicyEngine()
        self._register_policy_handlers()
        
        # File watcher
        debounce_ms = self.settings.get('monitoring.watcher_debounce_ms', 500)
        self.watcher = FileWatcher(
            event_callback=self._handle_file_event,
            debounce_delay=debounce_ms / 1000.0
        )
        
        # Periodic verifier
        scan_interval = self.settings.get('monitoring.scan_interval_seconds', 300)
        self.verifier = PeriodicVerifier(
            verify_callback=self._verify_file,
            interval_seconds=scan_interval
        )
    
    def _register_policy_handlers(self) -> None:
        """Register handlers for different response actions."""
        self.policy_engine.register_handler(
            ResponseAction.LOG_ONLY,
            lambda path, policy, details: self._handle_log_only(path, details)
        )
        self.policy_engine.register_handler(
            ResponseAction.NOTIFY,
            lambda path, policy, details: self._handle_notify(path, details)
        )
        self.policy_engine.register_handler(
            ResponseAction.RESTORE_CONTENT,
            lambda path, policy, details: self._handle_restore(path, details)
        )
        self.policy_engine.register_handler(
            ResponseAction.RESTORE_PERMISSIONS,
            lambda path, policy, details: self._handle_restore_permissions(path, details)
        )
    
    # =========================================================================
    # Service Lifecycle
    # =========================================================================
    
    def start(self) -> bool:
        """
        Start the protection service.
        
        Begins file watching and periodic verification.
        
        Returns:
            True if started successfully
        """
        with self._lock:
            if self._running:
                return True
            
            try:
                # Start file watcher
                if not self.watcher.start():
                    return False
                
                # Add watches for all protected items
                for item in self.baseline.get_all_protected_items():
                    self.watcher.add_watch(
                        item.path, 
                        recursive=(item.item_type == 'folder')
                    )
                    self.verifier.add_path(item.path)
                
                # Start periodic verifier
                self.verifier.start()
                
                # Log service start
                self.audit.log(
                    event_type=EventType.SERVICE_STARTED,
                    severity=EventSeverity.INFO,
                    explanation="FileGuard protection service started"
                )
                
                self._running = True
                return True
                
            except Exception as e:
                print(f"Failed to start protection service: {e}")
                return False
    
    def stop(self) -> None:
        """Stop the protection service."""
        with self._lock:
            if not self._running:
                return
            
            # Stop components
            self.watcher.stop()
            self.verifier.stop()
            
            # Log service stop
            self.audit.log(
                event_type=EventType.SERVICE_STOPPED,
                severity=EventSeverity.INFO,
                explanation="FileGuard protection service stopped"
            )
            
            self._running = False
    
    @property
    def is_running(self) -> bool:
        """Check if service is running."""
        return self._running
    
    # =========================================================================
    # Protection Management
    # =========================================================================
    
    def protect_file(
        self,
        file_path: str,
        mode: ProtectionMode = ProtectionMode.DETECT_ALERT
    ) -> bool:
        """
        Add a file to protection.
        
        Args:
            file_path: Path to file to protect
            mode: Protection mode to use
            
        Returns:
            True if protection was added successfully
        """
        path = Path(file_path)
        
        if not path.exists():
            return False
        
        if not path.is_file():
            return False
        
        if self.baseline.is_path_protected(str(path.absolute())):
            return False  # Already protected
        
        try:
            # Get file metadata
            metadata = self.hasher.get_metadata(path)
            if not metadata:
                return False
            
            # Create encrypted backup
            backup_path = self.restore.create_backup(path)
            
            # Convert mode for database
            db_mode = DBProtectionMode(mode.value)
            
            # Add to database
            item_id = self.baseline.add_protected_item(
                path=str(path.absolute()),
                item_type='file',
                hash_value=metadata.hash,
                size=metadata.size,
                modified_time=metadata.modified_time,
                permissions=metadata.permissions,
                protection_mode=db_mode,
                backup_path=backup_path
            )
            
            # Start watching
            if self._running:
                self.watcher.add_watch(str(path.absolute()))
                self.verifier.add_path(str(path.absolute()))
            
            # Log event
            log_file_protected(
                self.audit,
                str(path.absolute()),
                mode.value,
                metadata.hash
            )
            
            # Notify UI
            self._emit_status_update()
            
            return True
            
        except Exception as e:
            print(f"Failed to protect file {file_path}: {e}")
            return False
    
    def protect_folder(
        self,
        folder_path: str,
        mode: ProtectionMode = ProtectionMode.DETECT_ALERT,
        recursive: bool = True
    ) -> bool:
        """
        Add a folder to protection.
        
        Args:
            folder_path: Path to folder to protect
            mode: Protection mode to use
            recursive: Whether to protect subdirectories
            
        Returns:
            True if protection was added successfully
        """
        path = Path(folder_path)
        
        if not path.exists() or not path.is_dir():
            return False
        
        if self.baseline.is_path_protected(str(path.absolute())):
            return False
        
        try:
            # Compute folder hash
            hash_result = self.hasher.hash_folder(path)
            if not hash_result.success:
                return False
            
            # Get folder stats
            stat_info = path.stat()
            
            # Store folder contents manifest
            manifest = self.hasher.compute_folder_manifest(path)
            
            # Convert mode for database
            db_mode = DBProtectionMode(mode.value)
            
            # Add folder to database
            item_id = self.baseline.add_protected_item(
                path=str(path.absolute()),
                item_type='folder',
                hash_value=hash_result.hash,
                size=sum(m.size for m in manifest.values()),
                modified_time=stat_info.st_mtime,
                permissions=stat_info.st_mode,
                protection_mode=db_mode,
                backup_path=None  # Folders don't have single backups
            )
            
            # Save folder contents
            contents = {
                rel_path: (meta.hash, meta.size)
                for rel_path, meta in manifest.items()
            }
            self.baseline.save_folder_contents(item_id, contents)
            
            # Create backups for each file in folder
            for rel_path, meta in manifest.items():
                file_path = path / rel_path
                self.restore.create_backup(file_path)
            
            # Start watching
            if self._running:
                self.watcher.add_watch(str(path.absolute()), recursive=recursive)
                self.verifier.add_path(str(path.absolute()))
            
            # Log event
            log_file_protected(
                self.audit,
                str(path.absolute()),
                mode.value,
                hash_result.hash
            )
            
            self._emit_status_update()
            return True
            
        except Exception as e:
            print(f"Failed to protect folder {folder_path}: {e}")
            return False
    
    def unprotect(self, path: str, delete_backups: bool = False) -> bool:
        """
        Remove protection from a file or folder.
        
        Args:
            path: Path to unprotect
            delete_backups: Whether to delete associated backups
            
        Returns:
            True if protection was removed
        """
        item = self.baseline.get_protected_item_by_path(path)
        if not item:
            return False
        
        try:
            # Stop watching
            self.watcher.remove_watch(path)
            self.verifier.remove_path(path)
            
            # Optionally delete backups
            if delete_backups:
                if item.item_type == 'file':
                    self.restore.delete_backups(path)
                else:
                    # Delete backups for all files in folder
                    contents = self.baseline.get_folder_contents(item.id)
                    folder = Path(path)
                    for rel_path in contents.keys():
                        file_path = str(folder / rel_path)
                        self.restore.delete_backups(file_path)
            
            # Remove from database
            self.baseline.remove_protected_item(item.id)
            
            # Log event
            self.audit.log(
                event_type=EventType.FILE_UNPROTECTED,
                severity=EventSeverity.INFO,
                explanation=f"Protection removed from {Path(path).name}",
                file_path=path
            )
            
            self._emit_status_update()
            return True
            
        except Exception as e:
            print(f"Failed to unprotect {path}: {e}")
            return False
    
    def change_protection_mode(self, path: str, new_mode: ProtectionMode) -> bool:
        """Change the protection mode for a file or folder."""
        item = self.baseline.get_protected_item_by_path(path)
        if not item:
            return False
        
        old_mode = item.protection_mode.value
        db_mode = DBProtectionMode(new_mode.value)
        
        success = self.baseline.update_protected_item(
            item.id,
            protection_mode=db_mode,
            is_locked=(new_mode == ProtectionMode.SEALED)
        )
        
        if success:
            self.audit.log(
                event_type=EventType.PROTECTION_MODE_CHANGED,
                severity=EventSeverity.INFO,
                explanation=f"Protection mode changed from {old_mode} to {new_mode.value}",
                file_path=path
            )
        
        return success
    
    # =========================================================================
    # Verification
    # =========================================================================
    
    def verify_all(self) -> Dict[str, str]:
        """
        Verify integrity of all protected items.
        
        Returns:
            Dictionary mapping paths to verification status
        """
        results = {}
        
        for item in self.baseline.get_all_protected_items():
            status = self._verify_file(item.path)
            results[item.path] = status
        
        return results
    
    def verify_now(self) -> None:
        """Trigger immediate verification of all items."""
        self.verifier.verify_now()
    
    def _verify_file(self, path: str) -> str:
        """
        Verify a single file's integrity.
        
        Args:
            path: Path to verify
            
        Returns:
            Status string: 'unchanged', 'modified', 'missing', 'error'
        """
        item = self.baseline.get_protected_item_by_path(path)
        if not item:
            return 'error'
        
        file_path = Path(path)
        
        # Check if file exists
        if not file_path.exists():
            self._handle_tampering(
                path=path,
                change_type=ChangeType.DELETED,
                item=item,
                new_hash=None
            )
            return 'missing'
        
        # Compute current hash
        if item.item_type == 'file':
            hash_result = self.hasher.hash_file(file_path)
        else:
            hash_result = self.hasher.hash_folder(file_path)
        
        if not hash_result.success:
            return 'error'
        
        # Compare with baseline
        if hash_result.hash == item.hash:
            # Record successful verification
            self.baseline.record_verification(
                item_id=item.id,
                previous_hash=item.hash,
                current_hash=hash_result.hash,
                status='unchanged'
            )
            return 'unchanged'
        else:
            # Tampering detected
            self._handle_tampering(
                path=path,
                change_type=ChangeType.CONTENT_MODIFIED,
                item=item,
                new_hash=hash_result.hash
            )
            return 'modified'
    
    # =========================================================================
    # Event Handling
    # =========================================================================
    
    def _handle_file_event(self, event: FileEvent) -> None:
        """Handle a file system event from the watcher."""
        # Find protected item for this path
        item = self.baseline.get_protected_item_by_path(event.path)
        
        if not item:
            # Check if it's within a protected folder
            for protected in self.baseline.get_all_protected_items():
                if protected.item_type == 'folder':
                    if event.path.startswith(protected.path):
                        item = protected
                        break
        
        if not item:
            return  # Not a protected path
        
        # Get policy for this item
        policy = create_standard_policy(
            ProtectionMode(item.protection_mode.value),
            is_folder=(item.item_type == 'folder')
        )
        
        # Evaluate change against policy
        action = self.policy_engine.evaluate_change(
            policy=policy,
            change_type=event.change_type,
            file_path=Path(event.path)
        )
        
        if action:
            # Verify the change is real (not just a false positive)
            if event.change_type == ChangeType.CONTENT_MODIFIED:
                hash_result = self.hasher.hash_file(Path(event.path))
                if hash_result.success and hash_result.hash == item.hash:
                    return  # False positive - hash unchanged
            
            # Execute the response action
            self.policy_engine.execute_action(
                action=action,
                file_path=Path(event.path),
                policy=policy,
                details={'event': event, 'item': item}
            )
    
    def _handle_tampering(
        self,
        path: str,
        change_type: ChangeType,
        item,
        new_hash: Optional[str]
    ) -> None:
        """Handle a detected tampering event."""
        # Get protection mode
        mode = ProtectionMode(item.protection_mode.value)
        policy = create_standard_policy(mode, is_folder=(item.item_type == 'folder'))
        
        # Determine action
        action = policy.get_action_for_change(change_type)
        action_desc = "Logged event"
        was_restored = False
        
        # Execute response
        if action == ResponseAction.RESTORE_CONTENT:
            result = self.restore.restore_file(path)
            if result.success:
                was_restored = True
                action_desc = "Automatically restored from backup"
                
                # Update baseline if file was missing
                if change_type == ChangeType.DELETED:
                    self.baseline.update_protected_item(
                        item.id,
                        last_verified=datetime.now()
                    )
        elif action == ResponseAction.NOTIFY:
            action_desc = "User notified"
        
        # Log tamper event
        log_tamper_detected(
            self.audit,
            path,
            item.hash,
            new_hash or 'DELETED',
            action_desc
        )
        
        # Record in verification history
        status = 'missing' if change_type == ChangeType.DELETED else 'modified'
        self.baseline.record_verification(
            item_id=item.id,
            previous_hash=item.hash,
            current_hash=new_hash,
            status=status,
            action_taken=action_desc
        )
        
        # Create tamper event for UI
        tamper_event = TamperEvent(
            file_path=path,
            change_type=change_type,
            old_hash=item.hash,
            new_hash=new_hash,
            timestamp=datetime.now(),
            action_taken=action_desc,
            was_restored=was_restored
        )
        
        # Notify callbacks
        for callback in self._tamper_callbacks:
            try:
                callback(tamper_event)
            except Exception as e:
                print(f"Tamper callback error: {e}")
        
        self._emit_status_update()
    
    def _handle_log_only(self, path: Path, details: dict) -> None:
        """Handle LOG_ONLY response."""
        pass  # Already logged by _handle_tampering
    
    def _handle_notify(self, path: Path, details: dict) -> None:
        """Handle NOTIFY response."""
        # Add to event queue for UI
        self._event_queue.put({
            'type': 'notification',
            'title': 'File Modified',
            'message': f'{path.name} was modified',
            'path': str(path),
            'severity': 'warning'
        })
    
    def _handle_restore(self, path: Path, details: dict) -> None:
        """Handle RESTORE_CONTENT response."""
        item = details.get('item')
        if item:
            result = self.restore.restore_file(str(path))
            if result.success:
                log_file_restored(self.audit, str(path), result.restored_hash)
    
    def _handle_restore_permissions(self, path: Path, details: dict) -> None:
        """Handle RESTORE_PERMISSIONS response."""
        item = details.get('item')
        if item:
            try:
                os.chmod(str(path), item.permissions)
            except Exception as e:
                print(f"Failed to restore permissions for {path}: {e}")
    
    # =========================================================================
    # Status & Notifications
    # =========================================================================
    
    def get_status(self) -> ProtectionStatus:
        """Get current protection status."""
        stats = self.baseline.get_statistics()
        
        # Determine overall status
        if stats['recent_tamper_events'] > 0:
            overall = 'tampered'
        elif stats['total_protected'] == 0:
            overall = 'warning'
        else:
            overall = 'safe'
        
        return ProtectionStatus(
            is_running=self._running,
            protected_count=stats['total_protected'],
            last_verification=datetime.fromisoformat(stats['last_verification']) if stats['last_verification'] else None,
            recent_tamper_count=stats['recent_tamper_events'],
            overall_status=overall
        )
    
    def _emit_status_update(self) -> None:
        """Emit status update to callbacks."""
        status = self.get_status()
        for callback in self._status_callbacks:
            try:
                callback(status)
            except Exception as e:
                print(f"Status callback error: {e}")
    
    def on_tamper(self, callback: Callable[[TamperEvent], None]) -> None:
        """Register callback for tamper events."""
        self._tamper_callbacks.append(callback)
    
    def on_status_change(self, callback: Callable[[ProtectionStatus], None]) -> None:
        """Register callback for status changes."""
        self._status_callbacks.append(callback)
    
    def get_pending_events(self) -> List[Dict[str, Any]]:
        """Get pending notification events for UI."""
        events = []
        while True:
            try:
                event = self._event_queue.get_nowait()
                events.append(event)
            except Empty:
                break
        return events
    
    # =========================================================================
    # Data Access
    # =========================================================================
    
    def get_protected_items(self):
        """Get all protected items."""
        return self.baseline.get_all_protected_items()
    
    def get_activity_history(self, limit: int = 100):
        """Get recent activity from audit log."""
        return self.audit.read_entries(limit=limit)
    
    def get_file_history(self, file_path: str, limit: int = 50):
        """Get history for a specific file."""
        return self.audit.get_file_history(file_path, limit)
    
    def get_verification_history(self, item_id: Optional[int] = None, limit: int = 100):
        """Get verification history."""
        return self.baseline.get_verification_history(item_id, limit)
