"""
Restore Engine for FileGuard
============================
Handles backup creation and restoration of protected files.
When tampering is detected, this module can restore files
to their last known good state.

Design Philosophy:
- Backups are encrypted and tamper-resistant
- Multiple backup versions supported
- Restoration is atomic (all or nothing)
- Original permissions are preserved
"""

import os
import sys
import shutil
import stat
from pathlib import Path
from typing import Optional, List, Dict, Tuple
from datetime import datetime
from dataclasses import dataclass
import json
import tempfile

from .crypto import CryptoEngine, EncryptedBlob
from .hasher import IntegrityHasher, FileMetadata


@dataclass
class BackupMetadata:
    """
    Metadata stored alongside each backup.
    
    Contains everything needed to restore the file exactly
    as it was when backed up.
    """
    original_path: str
    backup_time: datetime
    original_hash: str
    original_size: int
    original_permissions: int
    original_mtime: float
    version: int
    
    def to_dict(self) -> dict:
        return {
            'original_path': self.original_path,
            'backup_time': self.backup_time.isoformat(),
            'original_hash': self.original_hash,
            'original_size': self.original_size,
            'original_permissions': self.original_permissions,
            'original_mtime': self.original_mtime,
            'version': self.version,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'BackupMetadata':
        return cls(
            original_path=data['original_path'],
            backup_time=datetime.fromisoformat(data['backup_time']),
            original_hash=data['original_hash'],
            original_size=data['original_size'],
            original_permissions=data['original_permissions'],
            original_mtime=data['original_mtime'],
            version=data['version'],
        )


@dataclass
class RestoreResult:
    """Result of a restore operation."""
    success: bool
    message: str
    restored_path: Optional[str] = None
    restored_hash: Optional[str] = None


class RestoreEngine:
    """
    Manages backup creation and file restoration.
    
    Each protected file gets an encrypted backup stored in the
    backup directory. Multiple versions can be kept (configurable).
    """
    
    def __init__(
        self,
        backup_dir: Path,
        crypto: CryptoEngine,
        max_versions: int = 3
    ):
        """
        Initialize the restore engine.
        
        Args:
            backup_dir: Directory to store encrypted backups
            crypto: Initialized CryptoEngine for encryption
            max_versions: Maximum backup versions to keep per file
        """
        self.backup_dir = Path(backup_dir)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        
        self.crypto = crypto
        self.max_versions = max_versions
        self.hasher = IntegrityHasher()
        
        # Metadata file stores info about all backups
        self._metadata_file = self.backup_dir / '.backup_index.json'
        self._metadata: Dict[str, List[dict]] = self._load_metadata()
    
    def _load_metadata(self) -> Dict[str, List[dict]]:
        """Load backup metadata index from disk."""
        if self._metadata_file.exists():
            try:
                data = self._metadata_file.read_text(encoding='utf-8')
                return json.loads(data)
            except Exception:
                return {}
        return {}
    
    def _save_metadata(self) -> None:
        """Save backup metadata index to disk."""
        try:
            data = json.dumps(self._metadata, indent=2)
            self._metadata_file.write_text(data, encoding='utf-8')
        except Exception as e:
            print(f"Failed to save backup metadata: {e}")
    
    def _get_backup_filename(self, original_path: str, version: int) -> str:
        """
        Generate a backup filename for a given path and version.
        
        Uses a hash of the path to create a unique, filesystem-safe name.
        """
        # Hash the original path to get a unique identifier
        path_hash = self.hasher.hash_string(original_path)[:16]
        return f"{path_hash}_v{version}.backup"
    
    def create_backup(self, file_path: Path) -> Optional[str]:
        """
        Create an encrypted backup of a file.
        
        The backup includes:
        - Encrypted file contents (AES-256-GCM)
        - Metadata for restoration
        
        Old versions are automatically pruned to stay within max_versions.
        
        Args:
            file_path: Path to file to back up
            
        Returns:
            Path to backup file, or None if backup failed
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            print(f"Cannot backup - file does not exist: {file_path}")
            return None
        
        if not file_path.is_file():
            print(f"Cannot backup - not a file: {file_path}")
            return None
        
        try:
            # Get file metadata
            stat_info = file_path.stat()
            hash_result = self.hasher.hash_file(file_path)
            
            if not hash_result.success:
                print(f"Cannot backup - hash failed: {hash_result.error}")
                return None
            
            # Determine version number
            path_key = str(file_path.absolute())
            existing_versions = self._metadata.get(path_key, [])
            next_version = max([v.get('version', 0) for v in existing_versions], default=0) + 1
            
            # Create backup metadata
            metadata = BackupMetadata(
                original_path=path_key,
                backup_time=datetime.now(),
                original_hash=hash_result.hash,
                original_size=stat_info.st_size,
                original_permissions=stat_info.st_mode,
                original_mtime=stat_info.st_mtime,
                version=next_version,
            )
            
            # Generate backup filename
            backup_filename = self._get_backup_filename(path_key, next_version)
            backup_path = self.backup_dir / backup_filename
            
            # Encrypt and save file contents
            if not self.crypto.encrypt_file(file_path, backup_path):
                print(f"Encryption failed for backup of {file_path}")
                return None
            
            # Update metadata index
            if path_key not in self._metadata:
                self._metadata[path_key] = []
            
            self._metadata[path_key].append(metadata.to_dict())
            
            # Prune old versions
            self._prune_old_versions(path_key)
            
            # Save metadata
            self._save_metadata()
            
            return str(backup_path)
            
        except Exception as e:
            print(f"Backup failed for {file_path}: {e}")
            return None
    
    def _prune_old_versions(self, path_key: str) -> None:
        """Remove old backup versions beyond max_versions."""
        versions = self._metadata.get(path_key, [])
        
        if len(versions) <= self.max_versions:
            return
        
        # Sort by version number (ascending)
        versions.sort(key=lambda v: v.get('version', 0))
        
        # Remove oldest versions
        to_remove = versions[:-self.max_versions]
        self._metadata[path_key] = versions[-self.max_versions:]
        
        # Delete backup files
        for v in to_remove:
            version_num = v.get('version', 0)
            backup_filename = self._get_backup_filename(path_key, version_num)
            backup_path = self.backup_dir / backup_filename
            
            try:
                if backup_path.exists():
                    backup_path.unlink()
            except Exception as e:
                print(f"Failed to delete old backup {backup_path}: {e}")
    
    def restore_file(
        self,
        original_path: str,
        version: Optional[int] = None,
        restore_permissions: bool = True
    ) -> RestoreResult:
        """
        Restore a file from backup.
        
        The restoration process:
        1. Find the backup for the given path/version
        2. Decrypt to a temp file
        3. Verify the decrypted content hash
        4. Atomically replace the original file
        5. Restore permissions if requested
        
        Args:
            original_path: Path to restore
            version: Specific version to restore (None = latest)
            restore_permissions: Whether to restore original permissions
            
        Returns:
            RestoreResult indicating success/failure
        """
        path_key = str(Path(original_path).absolute())
        
        # Find backup metadata
        versions = self._metadata.get(path_key, [])
        if not versions:
            return RestoreResult(
                success=False,
                message=f"No backup found for {original_path}"
            )
        
        # Get requested version
        if version is None:
            # Latest version
            backup_meta = max(versions, key=lambda v: v.get('version', 0))
        else:
            # Specific version
            backup_meta = next(
                (v for v in versions if v.get('version') == version),
                None
            )
            if backup_meta is None:
                return RestoreResult(
                    success=False,
                    message=f"Version {version} not found for {original_path}"
                )
        
        metadata = BackupMetadata.from_dict(backup_meta)
        
        # Find backup file
        backup_filename = self._get_backup_filename(path_key, metadata.version)
        backup_path = self.backup_dir / backup_filename
        
        if not backup_path.exists():
            return RestoreResult(
                success=False,
                message=f"Backup file missing: {backup_path}"
            )
        
        try:
            # Create temp file for decryption
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                temp_path = Path(tmp.name)
            
            # Decrypt backup
            if not self.crypto.decrypt_file(backup_path, temp_path):
                temp_path.unlink(missing_ok=True)
                return RestoreResult(
                    success=False,
                    message="Decryption failed - backup may be corrupted"
                )
            
            # Verify decrypted content
            hash_result = self.hasher.hash_file(temp_path)
            if not hash_result.success or hash_result.hash != metadata.original_hash:
                temp_path.unlink(missing_ok=True)
                return RestoreResult(
                    success=False,
                    message="Hash verification failed - backup may be corrupted"
                )
            
            # Ensure target directory exists
            target_path = Path(original_path)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Atomic replace: move temp file to target
            # On Windows, we may need to remove existing file first
            if sys.platform == 'win32' and target_path.exists():
                target_path.unlink()
            
            shutil.move(str(temp_path), str(target_path))
            
            # Restore permissions
            if restore_permissions:
                try:
                    os.chmod(str(target_path), metadata.original_permissions)
                except Exception as perm_error:
                    # Log but don't fail - permissions might not be fully restorable
                    print(f"Could not fully restore permissions: {perm_error}")
            
            return RestoreResult(
                success=True,
                message=f"File restored successfully from backup v{metadata.version}",
                restored_path=str(target_path),
                restored_hash=metadata.original_hash
            )
            
        except Exception as e:
            return RestoreResult(
                success=False,
                message=f"Restore failed: {e}"
            )
    
    def get_backup_versions(self, original_path: str) -> List[BackupMetadata]:
        """
        Get all backup versions for a file.
        
        Args:
            original_path: Path to the original file
            
        Returns:
            List of BackupMetadata for available versions
        """
        path_key = str(Path(original_path).absolute())
        versions = self._metadata.get(path_key, [])
        
        return [BackupMetadata.from_dict(v) for v in versions]
    
    def has_backup(self, original_path: str) -> bool:
        """Check if a backup exists for a file."""
        path_key = str(Path(original_path).absolute())
        return path_key in self._metadata and len(self._metadata[path_key]) > 0
    
    def delete_backups(self, original_path: str) -> bool:
        """
        Delete all backups for a file.
        
        Used when removing protection from a file.
        
        Args:
            original_path: Path to the original file
            
        Returns:
            True if backups were deleted
        """
        path_key = str(Path(original_path).absolute())
        
        if path_key not in self._metadata:
            return False
        
        versions = self._metadata[path_key]
        
        # Delete all backup files
        for v in versions:
            version_num = v.get('version', 0)
            backup_filename = self._get_backup_filename(path_key, version_num)
            backup_path = self.backup_dir / backup_filename
            
            try:
                if backup_path.exists():
                    backup_path.unlink()
            except Exception as e:
                print(f"Failed to delete backup {backup_path}: {e}")
        
        # Remove from metadata
        del self._metadata[path_key]
        self._save_metadata()
        
        return True
    
    def get_total_backup_size(self) -> int:
        """Get total size of all backups in bytes."""
        total = 0
        
        for backup_file in self.backup_dir.glob("*.backup"):
            try:
                total += backup_file.stat().st_size
            except Exception:
                pass
        
        return total
    
    def clear_all_backups(self) -> int:
        """
        Delete all backups.
        
        Warning: This is destructive and cannot be undone.
        
        Returns:
            Number of backup files deleted
        """
        count = 0
        
        for backup_file in self.backup_dir.glob("*.backup"):
            try:
                backup_file.unlink()
                count += 1
            except Exception as e:
                print(f"Failed to delete {backup_file}: {e}")
        
        self._metadata.clear()
        self._save_metadata()
        
        return count
    
    def update_backup(self, file_path: Path) -> Optional[str]:
        """
        Update the backup for a file (create new version).
        
        This is called when a protected file is legitimately modified
        and the user wants to update the baseline.
        
        Args:
            file_path: Path to file to update backup for
            
        Returns:
            Path to new backup, or None if failed
        """
        return self.create_backup(file_path)
