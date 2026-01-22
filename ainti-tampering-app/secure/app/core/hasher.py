"""
Integrity Hasher for FileGuard
==============================
Computes and verifies SHA-256 hashes for files and folders.
This is the core of tamper detection - any change to a file's
content will result in a different hash.

Design Philosophy:
- SHA-256 is cryptographically secure and collision-resistant
- Hash computation is deterministic and reproducible
- Large files are processed in chunks to manage memory
- Folder hashing includes all files recursively
"""

import hashlib
from pathlib import Path
from typing import Optional, Dict, List, Tuple, Generator
from dataclasses import dataclass
from datetime import datetime
import os


# Chunk size for reading large files (64KB is a good balance)
CHUNK_SIZE = 65536


@dataclass
class FileMetadata:
    """
    Complete metadata snapshot of a protected file.
    
    Captures everything needed to detect tampering:
    - Content hash (detects modifications)
    - Size (quick change detection)
    - Modified time (filesystem-level changes)
    - Permissions (security changes)
    """
    path: str
    hash: str
    size: int
    modified_time: float
    permissions: int
    computed_at: datetime
    
    def to_dict(self) -> dict:
        """Serialize for storage."""
        return {
            'path': self.path,
            'hash': self.hash,
            'size': self.size,
            'modified_time': self.modified_time,
            'permissions': self.permissions,
            'computed_at': self.computed_at.isoformat(),
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'FileMetadata':
        """Deserialize from storage."""
        return cls(
            path=data['path'],
            hash=data['hash'],
            size=data['size'],
            modified_time=data['modified_time'],
            permissions=data['permissions'],
            computed_at=datetime.fromisoformat(data['computed_at']),
        )


@dataclass
class HashResult:
    """
    Result of a hash computation with success/failure info.
    """
    success: bool
    hash: Optional[str] = None
    error: Optional[str] = None
    
    @property
    def is_valid(self) -> bool:
        return self.success and self.hash is not None


class IntegrityHasher:
    """
    Handles all hash computation for integrity verification.
    
    Supports:
    - Single file hashing
    - Folder hashing (recursive, deterministic order)
    - Streaming for large files
    - Metadata collection
    """
    
    def __init__(self, algorithm: str = 'sha256'):
        """
        Initialize hasher with specified algorithm.
        
        Args:
            algorithm: Hash algorithm to use (default: sha256)
        """
        self.algorithm = algorithm
        
        # Validate algorithm is available
        if algorithm not in hashlib.algorithms_available:
            raise ValueError(f"Hash algorithm '{algorithm}' not available")
    
    def hash_file(self, path: Path) -> HashResult:
        """
        Compute hash of a single file.
        
        Reads the file in chunks to handle large files without
        loading everything into memory at once.
        
        Args:
            path: Path to file to hash
            
        Returns:
            HashResult with computed hash or error
        """
        path = Path(path)
        
        if not path.exists():
            return HashResult(success=False, error="File does not exist")
        
        if not path.is_file():
            return HashResult(success=False, error="Path is not a file")
        
        try:
            hasher = hashlib.new(self.algorithm)
            
            with open(path, 'rb') as f:
                # Read and hash in chunks
                while chunk := f.read(CHUNK_SIZE):
                    hasher.update(chunk)
            
            return HashResult(success=True, hash=hasher.hexdigest())
            
        except PermissionError:
            return HashResult(success=False, error="Permission denied")
        except IOError as e:
            return HashResult(success=False, error=f"IO error: {e}")
        except Exception as e:
            return HashResult(success=False, error=f"Unexpected error: {e}")
    
    def hash_bytes(self, data: bytes) -> str:
        """
        Compute hash of raw bytes.
        
        Useful for hashing in-memory data like audit log entries.
        
        Args:
            data: Bytes to hash
            
        Returns:
            Hex-encoded hash string
        """
        hasher = hashlib.new(self.algorithm)
        hasher.update(data)
        return hasher.hexdigest()
    
    def hash_string(self, text: str, encoding: str = 'utf-8') -> str:
        """
        Compute hash of a string.
        
        Args:
            text: String to hash
            encoding: Text encoding to use
            
        Returns:
            Hex-encoded hash string
        """
        return self.hash_bytes(text.encode(encoding))
    
    def hash_folder(self, path: Path) -> HashResult:
        """
        Compute deterministic hash of an entire folder.
        
        The folder hash is computed by:
        1. Listing all files recursively in sorted order
        2. For each file, hashing: relative_path + file_hash
        3. Combining all individual hashes
        
        This ensures the same folder contents always produce
        the same hash, regardless of filesystem ordering.
        
        Args:
            path: Path to folder to hash
            
        Returns:
            HashResult with combined hash or error
        """
        path = Path(path)
        
        if not path.exists():
            return HashResult(success=False, error="Folder does not exist")
        
        if not path.is_dir():
            return HashResult(success=False, error="Path is not a folder")
        
        try:
            # Collect all files with their hashes
            file_hashes: List[Tuple[str, str]] = []
            
            for file_path in self._walk_files(path):
                result = self.hash_file(file_path)
                if not result.success:
                    # If any file fails, the whole folder hash fails
                    return HashResult(
                        success=False, 
                        error=f"Failed to hash {file_path}: {result.error}"
                    )
                
                # Use relative path for determinism across systems
                relative = file_path.relative_to(path).as_posix()
                file_hashes.append((relative, result.hash))
            
            # Sort by path for deterministic ordering
            file_hashes.sort(key=lambda x: x[0])
            
            # Combine all hashes
            combined_hasher = hashlib.new(self.algorithm)
            for rel_path, file_hash in file_hashes:
                # Hash both path and content hash
                combined_hasher.update(f"{rel_path}:{file_hash}\n".encode('utf-8'))
            
            return HashResult(success=True, hash=combined_hasher.hexdigest())
            
        except Exception as e:
            return HashResult(success=False, error=f"Folder hash error: {e}")
    
    def _walk_files(self, folder: Path) -> Generator[Path, None, None]:
        """
        Walk a folder tree yielding all files.
        
        Skips:
        - Hidden files (starting with .)
        - System files
        - Symbolic links (security risk)
        
        Yields:
            Path objects for each regular file
        """
        for item in sorted(folder.iterdir()):
            # Skip hidden files
            if item.name.startswith('.'):
                continue
            
            # Skip symbolic links (could point outside protected area)
            if item.is_symlink():
                continue
            
            if item.is_file():
                yield item
            elif item.is_dir():
                yield from self._walk_files(item)
    
    def get_metadata(self, path: Path) -> Optional[FileMetadata]:
        """
        Collect complete metadata for a file.
        
        Gathers all information needed for tamper detection:
        - Content hash
        - File size
        - Modification time
        - Permissions
        
        Args:
            path: Path to file
            
        Returns:
            FileMetadata object, or None if file can't be accessed
        """
        path = Path(path)
        
        if not path.exists():
            return None
        
        try:
            stat_info = path.stat()
            hash_result = self.hash_file(path)
            
            if not hash_result.success:
                return None
            
            return FileMetadata(
                path=str(path.absolute()),
                hash=hash_result.hash,
                size=stat_info.st_size,
                modified_time=stat_info.st_mtime,
                permissions=stat_info.st_mode,
                computed_at=datetime.now(),
            )
            
        except Exception:
            return None
    
    def verify_file(self, path: Path, expected_hash: str) -> Tuple[bool, Optional[str]]:
        """
        Verify a file's integrity against an expected hash.
        
        Args:
            path: Path to file to verify
            expected_hash: Hash the file should have
            
        Returns:
            Tuple of (is_valid, current_hash_or_error)
        """
        result = self.hash_file(path)
        
        if not result.success:
            return False, result.error
        
        is_valid = result.hash == expected_hash
        return is_valid, result.hash
    
    def quick_check(self, path: Path, expected_size: int, expected_mtime: float) -> bool:
        """
        Quick integrity check using size and modification time.
        
        This is a fast pre-check before full hash verification.
        If size or mtime differs, the file definitely changed.
        If they match, we still need to verify the hash (could be
        a clever attacker who preserved timestamps).
        
        Args:
            path: Path to file
            expected_size: Expected file size in bytes
            expected_mtime: Expected modification timestamp
            
        Returns:
            True if quick check passes (file might be unchanged)
        """
        try:
            stat_info = path.stat()
            return (
                stat_info.st_size == expected_size and
                stat_info.st_mtime == expected_mtime
            )
        except Exception:
            return False
    
    def compute_folder_manifest(self, path: Path) -> Dict[str, FileMetadata]:
        """
        Compute metadata for all files in a folder.
        
        Creates a manifest of all files with their hashes,
        useful for folder protection and bulk verification.
        
        Args:
            path: Path to folder
            
        Returns:
            Dictionary mapping relative paths to FileMetadata
        """
        path = Path(path)
        manifest = {}
        
        for file_path in self._walk_files(path):
            metadata = self.get_metadata(file_path)
            if metadata:
                relative = file_path.relative_to(path).as_posix()
                manifest[relative] = metadata
        
        return manifest
    
    def diff_manifests(
        self, 
        old_manifest: Dict[str, FileMetadata],
        new_manifest: Dict[str, FileMetadata]
    ) -> Dict[str, List[str]]:
        """
        Compare two folder manifests to find changes.
        
        Identifies:
        - Added files (in new but not old)
        - Removed files (in old but not new)
        - Modified files (hash changed)
        
        Args:
            old_manifest: Previous folder state
            new_manifest: Current folder state
            
        Returns:
            Dictionary with 'added', 'removed', 'modified' lists
        """
        old_paths = set(old_manifest.keys())
        new_paths = set(new_manifest.keys())
        
        added = list(new_paths - old_paths)
        removed = list(old_paths - new_paths)
        
        # Check for modifications in files that exist in both
        modified = []
        for path in old_paths & new_paths:
            if old_manifest[path].hash != new_manifest[path].hash:
                modified.append(path)
        
        return {
            'added': sorted(added),
            'removed': sorted(removed),
            'modified': sorted(modified),
        }
