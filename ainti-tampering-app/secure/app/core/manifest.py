"""
Signed Manifest System for FileGuard
====================================
Cryptographically signed manifests using Ed25519 digital signatures.
Each manifest captures the complete state of protected files with
verifiable integrity.

Architecture:
    Manifest = {
        metadata: timestamp, version, signer_id
        entries: [file_path, hash, size, permissions, ...]
        signature: Ed25519(canonical_json(manifest_data))
    }

Design Philosophy:
- Manifests are immutable once signed
- Signatures use Ed25519 (fast, small signatures, high security)
- Canonical JSON for deterministic signing
- Version tracking for schema evolution
"""

import json
import hashlib
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum
import canonicaljson

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey
    )
    from cryptography.hazmat.primitives import serialization
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False


# Manifest schema version
MANIFEST_VERSION = "1.0"


class ManifestStatus(Enum):
    """Status of manifest verification."""
    VALID = 'valid'                 # Signature valid, no changes
    MODIFIED = 'modified'           # Files changed since signing
    SIGNATURE_INVALID = 'invalid'   # Signature doesn't match
    CORRUPTED = 'corrupted'         # Manifest data corrupted
    UNSIGNED = 'unsigned'           # No signature present


@dataclass
class ManifestEntry:
    """
    A single file entry in the manifest.
    
    Captures all verifiable attributes of a protected file.
    """
    path: str                           # Relative path from protected root
    hash: str                           # SHA-256 content hash
    size: int                           # File size in bytes
    modified_time: float                # Last modification timestamp
    permissions: int                    # File permissions (mode)
    file_type: str = 'file'            # 'file' or 'directory'
    chunk_hashes: List[str] = field(default_factory=list)  # For Merkle tree
    
    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        d = {
            'path': self.path,
            'hash': self.hash,
            'size': self.size,
            'modified_time': self.modified_time,
            'permissions': self.permissions,
            'file_type': self.file_type,
        }
        if self.chunk_hashes:
            d['chunk_hashes'] = self.chunk_hashes
        return d
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ManifestEntry':
        """Deserialize from dictionary."""
        return cls(
            path=data['path'],
            hash=data['hash'],
            size=data['size'],
            modified_time=data['modified_time'],
            permissions=data['permissions'],
            file_type=data.get('file_type', 'file'),
            chunk_hashes=data.get('chunk_hashes', []),
        )


@dataclass
class ManifestMetadata:
    """
    Metadata about the manifest itself.
    """
    version: str                        # Schema version
    created_at: datetime               # When manifest was created
    signed_at: Optional[datetime]       # When signature was added
    signer_id: Optional[str]           # Identifier of the signer
    root_path: str                      # Base path for all entries
    description: Optional[str] = None   # Human-readable description
    previous_manifest_hash: Optional[str] = None  # For chain verification
    
    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            'version': self.version,
            'created_at': self.created_at.isoformat(),
            'signed_at': self.signed_at.isoformat() if self.signed_at else None,
            'signer_id': self.signer_id,
            'root_path': self.root_path,
            'description': self.description,
            'previous_manifest_hash': self.previous_manifest_hash,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ManifestMetadata':
        """Deserialize from dictionary."""
        return cls(
            version=data['version'],
            created_at=datetime.fromisoformat(data['created_at']),
            signed_at=datetime.fromisoformat(data['signed_at']) if data.get('signed_at') else None,
            signer_id=data.get('signer_id'),
            root_path=data['root_path'],
            description=data.get('description'),
            previous_manifest_hash=data.get('previous_manifest_hash'),
        )


@dataclass
class SignedManifest:
    """
    A complete signed manifest containing file states.
    
    The manifest captures a point-in-time snapshot of all protected
    files with a cryptographic signature ensuring integrity.
    """
    metadata: ManifestMetadata
    entries: List[ManifestEntry]
    signature: Optional[str] = None     # Base64-encoded Ed25519 signature
    public_key: Optional[str] = None    # Base64-encoded public key
    
    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            'metadata': self.metadata.to_dict(),
            'entries': [e.to_dict() for e in self.entries],
            'signature': self.signature,
            'public_key': self.public_key,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'SignedManifest':
        """Deserialize from dictionary."""
        return cls(
            metadata=ManifestMetadata.from_dict(data['metadata']),
            entries=[ManifestEntry.from_dict(e) for e in data['entries']],
            signature=data.get('signature'),
            public_key=data.get('public_key'),
        )
    
    def to_json(self, indent: int = 2) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=indent, sort_keys=True)
    
    @classmethod
    def from_json(cls, json_str: str) -> 'SignedManifest':
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))
    
    def get_canonical_bytes(self) -> bytes:
        """
        Get canonical byte representation for signing.
        
        Uses canonical JSON to ensure deterministic ordering
        of keys and consistent formatting.
        """
        # Create signing data (exclude signature and public_key)
        signing_data = {
            'metadata': self.metadata.to_dict(),
            'entries': [e.to_dict() for e in self.entries],
        }
        return canonicaljson.encode_canonical_json(signing_data)
    
    def get_manifest_hash(self) -> str:
        """Get SHA-256 hash of the manifest for chaining."""
        return hashlib.sha256(self.get_canonical_bytes()).hexdigest()
    
    @property
    def is_signed(self) -> bool:
        """Check if manifest has a signature."""
        return self.signature is not None
    
    @property
    def entry_count(self) -> int:
        """Number of entries in the manifest."""
        return len(self.entries)
    
    @property
    def total_size(self) -> int:
        """Total size of all files in bytes."""
        return sum(e.size for e in self.entries)
    
    def find_entry(self, path: str) -> Optional[ManifestEntry]:
        """Find an entry by path."""
        for entry in self.entries:
            if entry.path == path:
                return entry
        return None


class ManifestSigner:
    """
    Handles Ed25519 signing and verification of manifests.
    
    The signer maintains a private key for creating signatures
    and can verify signatures using embedded or provided public keys.
    """
    
    def __init__(self, private_key_seed: Optional[bytes] = None):
        """
        Initialize the manifest signer.
        
        Args:
            private_key_seed: 32-byte seed for Ed25519 key (from broker)
        """
        if not CRYPTO_AVAILABLE:
            raise ImportError("cryptography library required for signing")
        
        if private_key_seed:
            self._private_key = Ed25519PrivateKey.from_private_bytes(private_key_seed)
        else:
            self._private_key = Ed25519PrivateKey.generate()
        
        self._public_key = self._private_key.public_key()
    
    def get_public_key_bytes(self) -> bytes:
        """Get the public key as bytes."""
        return self._public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw
        )
    
    def get_public_key_base64(self) -> str:
        """Get the public key as base64 string."""
        import base64
        return base64.b64encode(self.get_public_key_bytes()).decode('ascii')
    
    def sign_manifest(
        self,
        manifest: SignedManifest,
        signer_id: Optional[str] = None
    ) -> SignedManifest:
        """
        Sign a manifest with Ed25519.
        
        Args:
            manifest: The manifest to sign
            signer_id: Optional identifier for the signer
            
        Returns:
            The manifest with signature and public key added
        """
        import base64
        
        # Update metadata
        manifest.metadata.signed_at = datetime.utcnow()
        if signer_id:
            manifest.metadata.signer_id = signer_id
        
        # Get canonical bytes for signing
        canonical_bytes = manifest.get_canonical_bytes()
        
        # Create signature
        signature_bytes = self._private_key.sign(canonical_bytes)
        
        # Encode signature and public key
        manifest.signature = base64.b64encode(signature_bytes).decode('ascii')
        manifest.public_key = self.get_public_key_base64()
        
        return manifest
    
    @staticmethod
    def verify_manifest(
        manifest: SignedManifest,
        public_key_bytes: Optional[bytes] = None
    ) -> Tuple[bool, str]:
        """
        Verify a manifest's signature.
        
        Args:
            manifest: The signed manifest to verify
            public_key_bytes: Optional override for public key
            
        Returns:
            Tuple of (is_valid, message)
        """
        import base64
        
        if not CRYPTO_AVAILABLE:
            return False, "cryptography library not available"
        
        if not manifest.signature:
            return False, "Manifest has no signature"
        
        try:
            # Get public key
            if public_key_bytes:
                pub_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
            elif manifest.public_key:
                pub_key_bytes = base64.b64decode(manifest.public_key)
                pub_key = Ed25519PublicKey.from_public_bytes(pub_key_bytes)
            else:
                return False, "No public key available"
            
            # Decode signature
            signature_bytes = base64.b64decode(manifest.signature)
            
            # Get canonical bytes
            canonical_bytes = manifest.get_canonical_bytes()
            
            # Verify
            pub_key.verify(signature_bytes, canonical_bytes)
            return True, "Signature valid"
            
        except Exception as e:
            return False, f"Verification failed: {e}"


class ManifestBuilder:
    """
    Builder for creating manifests from file system state.
    
    Scans files and collects their metadata into a manifest
    ready for signing.
    """
    
    def __init__(
        self,
        root_path: Path,
        hasher: Optional['IntegrityHasher'] = None
    ):
        """
        Initialize the manifest builder.
        
        Args:
            root_path: Base path for collecting files
            hasher: Optional hasher instance (creates one if not provided)
        """
        from .hasher import IntegrityHasher
        
        self.root_path = Path(root_path)
        self.hasher = hasher or IntegrityHasher()
    
    def build(
        self,
        paths: List[Path],
        description: Optional[str] = None,
        previous_manifest: Optional[SignedManifest] = None,
        include_chunk_hashes: bool = False,
        chunk_size: int = 1024 * 1024  # 1MB chunks
    ) -> SignedManifest:
        """
        Build a manifest from the given paths.
        
        Args:
            paths: List of files/folders to include
            description: Optional description
            previous_manifest: Previous manifest for chaining
            include_chunk_hashes: Whether to compute Merkle tree hashes
            chunk_size: Chunk size for Merkle tree
            
        Returns:
            An unsigned manifest ready for signing
        """
        entries: List[ManifestEntry] = []
        
        for path in paths:
            path = Path(path)
            
            if path.is_file():
                entry = self._create_file_entry(
                    path, include_chunk_hashes, chunk_size
                )
                if entry:
                    entries.append(entry)
                    
            elif path.is_dir():
                # Recursively process directory
                for file_path in path.rglob('*'):
                    if file_path.is_file():
                        entry = self._create_file_entry(
                            file_path, include_chunk_hashes, chunk_size
                        )
                        if entry:
                            entries.append(entry)
        
        # Sort entries for deterministic ordering
        entries.sort(key=lambda e: e.path)
        
        # Create metadata
        metadata = ManifestMetadata(
            version=MANIFEST_VERSION,
            created_at=datetime.utcnow(),
            signed_at=None,
            signer_id=None,
            root_path=str(self.root_path),
            description=description,
            previous_manifest_hash=previous_manifest.get_manifest_hash() if previous_manifest else None,
        )
        
        return SignedManifest(
            metadata=metadata,
            entries=entries,
        )
    
    def _create_file_entry(
        self,
        file_path: Path,
        include_chunks: bool,
        chunk_size: int
    ) -> Optional[ManifestEntry]:
        """Create a manifest entry for a single file."""
        try:
            # Get relative path
            try:
                rel_path = file_path.relative_to(self.root_path)
            except ValueError:
                rel_path = file_path
            
            # Get file stats
            stat = file_path.stat()
            
            # Compute hash
            result = self.hasher.hash_file(file_path)
            if not result.success:
                return None
            
            # Optionally compute chunk hashes
            chunk_hashes = []
            if include_chunks and stat.st_size > chunk_size:
                chunk_hashes = self._compute_chunk_hashes(file_path, chunk_size)
            
            return ManifestEntry(
                path=str(rel_path).replace('\\', '/'),  # Normalize path separators
                hash=result.hash,
                size=stat.st_size,
                modified_time=stat.st_mtime,
                permissions=stat.st_mode,
                file_type='file',
                chunk_hashes=chunk_hashes,
            )
            
        except Exception as e:
            print(f"Error creating entry for {file_path}: {e}")
            return None
    
    def _compute_chunk_hashes(
        self,
        file_path: Path,
        chunk_size: int
    ) -> List[str]:
        """Compute hashes for file chunks (for Merkle tree)."""
        hashes = []
        
        try:
            with open(file_path, 'rb') as f:
                while chunk := f.read(chunk_size):
                    chunk_hash = hashlib.sha256(chunk).hexdigest()
                    hashes.append(chunk_hash)
        except Exception:
            pass
        
        return hashes


class ManifestVerifier:
    """
    Verifies manifest entries against current file system state.
    
    Compares the signed manifest against actual files to detect
    any modifications, additions, or deletions.
    """
    
    @dataclass
    class VerificationResult:
        """Result of verifying a manifest entry."""
        path: str
        status: str  # 'unchanged', 'modified', 'missing', 'size_changed', 'permission_changed'
        expected_hash: str
        actual_hash: Optional[str]
        details: Dict[str, Any] = field(default_factory=dict)
    
    def __init__(self, hasher: Optional['IntegrityHasher'] = None):
        """Initialize the verifier."""
        from .hasher import IntegrityHasher
        self.hasher = hasher or IntegrityHasher()
    
    def verify(
        self,
        manifest: SignedManifest,
        root_path: Optional[Path] = None
    ) -> Tuple[ManifestStatus, List['ManifestVerifier.VerificationResult']]:
        """
        Verify all entries in a manifest against file system.
        
        Args:
            manifest: The manifest to verify
            root_path: Optional override for root path
            
        Returns:
            Tuple of (overall_status, list of per-entry results)
        """
        results: List[ManifestVerifier.VerificationResult] = []
        root = Path(root_path or manifest.metadata.root_path)
        
        # First verify signature if present
        if manifest.is_signed:
            sig_valid, sig_msg = ManifestSigner.verify_manifest(manifest)
            if not sig_valid:
                return ManifestStatus.SIGNATURE_INVALID, results
        else:
            overall_status = ManifestStatus.UNSIGNED
        
        # Verify each entry
        all_unchanged = True
        
        for entry in manifest.entries:
            file_path = root / entry.path
            
            if not file_path.exists():
                results.append(self.VerificationResult(
                    path=entry.path,
                    status='missing',
                    expected_hash=entry.hash,
                    actual_hash=None,
                ))
                all_unchanged = False
                continue
            
            # Check file hash
            result = self.hasher.hash_file(file_path)
            
            if not result.success:
                results.append(self.VerificationResult(
                    path=entry.path,
                    status='error',
                    expected_hash=entry.hash,
                    actual_hash=None,
                    details={'error': result.error},
                ))
                all_unchanged = False
                continue
            
            # Compare hashes
            if result.hash != entry.hash:
                results.append(self.VerificationResult(
                    path=entry.path,
                    status='modified',
                    expected_hash=entry.hash,
                    actual_hash=result.hash,
                ))
                all_unchanged = False
            else:
                # Check other attributes
                stat = file_path.stat()
                
                if stat.st_size != entry.size:
                    results.append(self.VerificationResult(
                        path=entry.path,
                        status='size_changed',
                        expected_hash=entry.hash,
                        actual_hash=result.hash,
                        details={
                            'expected_size': entry.size,
                            'actual_size': stat.st_size
                        },
                    ))
                    all_unchanged = False
                    
                elif stat.st_mode != entry.permissions:
                    results.append(self.VerificationResult(
                        path=entry.path,
                        status='permission_changed',
                        expected_hash=entry.hash,
                        actual_hash=result.hash,
                        details={
                            'expected_mode': oct(entry.permissions),
                            'actual_mode': oct(stat.st_mode)
                        },
                    ))
                    all_unchanged = False
                    
                else:
                    results.append(self.VerificationResult(
                        path=entry.path,
                        status='unchanged',
                        expected_hash=entry.hash,
                        actual_hash=result.hash,
                    ))
        
        # Determine overall status
        if manifest.is_signed:
            overall_status = ManifestStatus.VALID if all_unchanged else ManifestStatus.MODIFIED
        else:
            overall_status = ManifestStatus.UNSIGNED
        
        return overall_status, results


class ManifestStore:
    """
    Persistent storage for manifests with versioning.
    
    Maintains a history of signed manifests for audit trails
    and rollback capabilities.
    """
    
    def __init__(self, storage_dir: Path):
        """
        Initialize the manifest store.
        
        Args:
            storage_dir: Directory for storing manifests
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self._index_file = self.storage_dir / 'manifest_index.json'
        self._index = self._load_index()
    
    def _load_index(self) -> Dict[str, Any]:
        """Load the manifest index."""
        if self._index_file.exists():
            return json.loads(self._index_file.read_text())
        return {'manifests': [], 'latest': None}
    
    def _save_index(self) -> None:
        """Save the manifest index."""
        self._index_file.write_text(json.dumps(self._index, indent=2))
    
    def _get_manifest_path(self, manifest_hash: str) -> Path:
        """Get file path for a manifest."""
        return self.storage_dir / f"manifest_{manifest_hash[:16]}.json"
    
    def store(self, manifest: SignedManifest) -> str:
        """
        Store a manifest.
        
        Args:
            manifest: The manifest to store
            
        Returns:
            The manifest hash (identifier)
        """
        manifest_hash = manifest.get_manifest_hash()
        
        # Write manifest file
        path = self._get_manifest_path(manifest_hash)
        path.write_text(manifest.to_json())
        
        # Update index
        entry = {
            'hash': manifest_hash,
            'created_at': manifest.metadata.created_at.isoformat(),
            'signed_at': manifest.metadata.signed_at.isoformat() if manifest.metadata.signed_at else None,
            'entry_count': manifest.entry_count,
            'total_size': manifest.total_size,
            'description': manifest.metadata.description,
        }
        
        self._index['manifests'].append(entry)
        self._index['latest'] = manifest_hash
        self._save_index()
        
        return manifest_hash
    
    def load(self, manifest_hash: str) -> Optional[SignedManifest]:
        """
        Load a manifest by hash.
        
        Args:
            manifest_hash: The manifest hash to load
            
        Returns:
            The manifest, or None if not found
        """
        path = self._get_manifest_path(manifest_hash)
        
        if not path.exists():
            return None
        
        return SignedManifest.from_json(path.read_text())
    
    def get_latest(self) -> Optional[SignedManifest]:
        """Get the most recent manifest."""
        if self._index['latest']:
            return self.load(self._index['latest'])
        return None
    
    def list_manifests(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List stored manifests.
        
        Args:
            limit: Maximum number to return
            
        Returns:
            List of manifest info dictionaries
        """
        return list(reversed(self._index['manifests']))[:limit]
    
    def delete(self, manifest_hash: str) -> bool:
        """
        Delete a manifest.
        
        Args:
            manifest_hash: The manifest to delete
            
        Returns:
            True if deleted
        """
        path = self._get_manifest_path(manifest_hash)
        
        if path.exists():
            path.unlink()
            
            # Update index
            self._index['manifests'] = [
                m for m in self._index['manifests']
                if m['hash'] != manifest_hash
            ]
            
            if self._index['latest'] == manifest_hash:
                # Set new latest
                if self._index['manifests']:
                    self._index['latest'] = self._index['manifests'][-1]['hash']
                else:
                    self._index['latest'] = None
            
            self._save_index()
            return True
        
        return False
