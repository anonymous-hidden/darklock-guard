"""
Unified Security Service for FileGuard
======================================
Integrates all security components into a cohesive service:
- Secret Broker (DPAPI/OS keyring)
- Token Management
- Signed Manifests
- Envelope Encryption
- Merkle Tree Verification
- Append-Only Event Chain

This is the main entry point for security operations.

Usage:
    security = SecurityService(app_data_dir)
    security.initialize()
    
    # Protect a file
    security.protect_file(path, ProtectionMode.DETECT_RESTORE)
    
    # Create signed manifest
    manifest = security.create_manifest([path], "Baseline manifest")
    
    # Verify integrity
    result = security.verify_all()
"""

import os
import sys
import threading
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple, Callable
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum

from .broker import SecretBroker, Token, TokenType
from .manifest import (
    SignedManifest,
    ManifestBuilder,
    ManifestSigner,
    ManifestVerifier,
    ManifestStore,
    ManifestStatus
)
from .envelope import EnvelopeEncryption, KeyStore
from .merkle import MerkleHasher, MerkleTree, MerkleTreeStore
from .event_chain import EventChain, ChainEventType, create_event_chain


class ProtectionLevel(Enum):
    """
    Protection levels for files.
    """
    MONITOR = 'monitor'             # Hash verification only
    ENCRYPT_BACKUP = 'encrypt'      # Encrypted backup for restore
    SEALED = 'sealed'               # Locked, no modifications allowed


@dataclass
class ProtectedFile:
    """
    Information about a protected file.
    """
    path: str
    level: ProtectionLevel
    baseline_hash: str
    merkle_root: Optional[str]
    encrypted_backup: Optional[str]
    protection_started: datetime
    last_verified: Optional[datetime]
    
    def to_dict(self) -> dict:
        return {
            'path': self.path,
            'level': self.level.value,
            'baseline_hash': self.baseline_hash,
            'merkle_root': self.merkle_root,
            'encrypted_backup': self.encrypted_backup,
            'protection_started': self.protection_started.isoformat(),
            'last_verified': self.last_verified.isoformat() if self.last_verified else None,
        }


@dataclass
class VerificationReport:
    """
    Report from a verification operation.
    """
    timestamp: datetime
    total_files: int
    passed: int
    failed: int
    missing: int
    modified_files: List[str]
    chain_integrity: str  # 'valid', 'broken', etc.
    manifest_status: str  # 'valid', 'modified', etc.
    duration_ms: float


class SecurityService:
    """
    Unified security service coordinating all protection mechanisms.
    
    Components:
    - SecretBroker: Manages master secrets and issues tokens
    - EnvelopeEncryption: Per-file encryption with DEKs
    - MerkleHasher: Efficient large file verification
    - SignedManifest: Cryptographically signed file snapshots
    - EventChain: Tamper-evident audit log
    """
    
    def __init__(self, app_data_dir: Path):
        """
        Initialize the security service.
        
        Args:
            app_data_dir: Application data directory
        """
        self.app_data_dir = Path(app_data_dir)
        
        # Component directories
        self._storage_dir = self.app_data_dir / 'security'
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        
        self._broker_dir = self._storage_dir / 'broker'
        self._keys_dir = self._storage_dir / 'keys'
        self._manifests_dir = self._storage_dir / 'manifests'
        self._merkle_dir = self._storage_dir / 'merkle'
        self._chain_dir = self._storage_dir / 'chain'
        self._backups_dir = self._storage_dir / 'backups'
        
        # Create directories
        for d in [self._broker_dir, self._keys_dir, self._manifests_dir,
                  self._merkle_dir, self._chain_dir, self._backups_dir]:
            d.mkdir(exist_ok=True)
        
        # Components (initialized in initialize())
        self._broker: Optional[SecretBroker] = None
        self._key_store: Optional[KeyStore] = None
        self._envelope: Optional[EnvelopeEncryption] = None
        self._merkle: Optional[MerkleHasher] = None
        self._merkle_store: Optional[MerkleTreeStore] = None
        self._manifest_store: Optional[ManifestStore] = None
        self._event_chain: Optional[EventChain] = None
        
        # State
        self._initialized = False
        self._lock = threading.RLock()
        self._protected_files: Dict[str, ProtectedFile] = {}
        
        # Active tokens
        self._tokens: Dict[TokenType, Token] = {}
    
    def initialize(self) -> bool:
        """
        Initialize all security components.
        
        Returns:
            True if initialization successful
        """
        with self._lock:
            if self._initialized:
                return True
            
            try:
                # Initialize secret broker
                self._broker = SecretBroker(self._broker_dir)
                
                # Initialize key store for envelope encryption
                self._key_store = KeyStore(self._keys_dir / 'wrapped_keys.json')
                
                # Get encryption token and initialize envelope encryption
                enc_token = self._broker.issue_token(TokenType.ENCRYPTION)
                kek = self._broker.get_encryption_key(enc_token)
                
                if not kek:
                    raise RuntimeError("Failed to get encryption key")
                
                self._envelope = EnvelopeEncryption(kek, self._key_store)
                self._tokens[TokenType.ENCRYPTION] = enc_token
                
                # Initialize Merkle hasher
                self._merkle = MerkleHasher()
                self._merkle_store = MerkleTreeStore(self._merkle_dir)
                
                # Initialize manifest store
                self._manifest_store = ManifestStore(self._manifests_dir)
                
                # Initialize event chain with signing
                sign_token = self._broker.issue_token(TokenType.SIGNING)
                signing_key = self._broker.get_signing_key(sign_token)
                
                self._event_chain = create_event_chain(
                    self._chain_dir,
                    signing_key
                )
                self._tokens[TokenType.SIGNING] = sign_token
                
                # Log initialization
                self._event_chain.append(
                    ChainEventType.SERVICE_STARTED,
                    {'message': 'Security service initialized'}
                )
                
                # Load protected files state
                self._load_protected_files()
                
                self._initialized = True
                return True
                
            except Exception as e:
                print(f"Security service initialization error: {e}")
                return False
    
    def _load_protected_files(self) -> None:
        """Load protected files state from storage."""
        import json
        state_file = self._storage_dir / 'protected_files.json'
        
        if state_file.exists():
            try:
                data = json.loads(state_file.read_text())
                for item in data.get('files', []):
                    pf = ProtectedFile(
                        path=item['path'],
                        level=ProtectionLevel(item['level']),
                        baseline_hash=item['baseline_hash'],
                        merkle_root=item.get('merkle_root'),
                        encrypted_backup=item.get('encrypted_backup'),
                        protection_started=datetime.fromisoformat(item['protection_started']),
                        last_verified=datetime.fromisoformat(item['last_verified']) if item.get('last_verified') else None,
                    )
                    self._protected_files[pf.path] = pf
            except Exception as e:
                print(f"Error loading protected files: {e}")
    
    def _save_protected_files(self) -> None:
        """Save protected files state to storage."""
        import json
        state_file = self._storage_dir / 'protected_files.json'
        
        data = {
            'version': 1,
            'updated_at': datetime.utcnow().isoformat(),
            'files': [pf.to_dict() for pf in self._protected_files.values()],
        }
        
        state_file.write_text(json.dumps(data, indent=2))
    
    def _ensure_token(self, token_type: TokenType) -> Token:
        """Ensure we have a valid token of the given type."""
        token = self._tokens.get(token_type)
        
        if token and token.is_valid and token.ttl_seconds > 60:
            return token
        
        # Issue new token
        token = self._broker.issue_token(token_type)
        self._tokens[token_type] = token
        return token
    
    def protect_file(
        self,
        path: Path,
        level: ProtectionLevel = ProtectionLevel.MONITOR,
        create_backup: bool = True
    ) -> bool:
        """
        Add a file to protection.
        
        Args:
            path: Path to file to protect
            level: Protection level
            create_backup: Whether to create encrypted backup
            
        Returns:
            True if protection added successfully
        """
        if not self._initialized:
            return False
        
        path = Path(path)
        if not path.exists():
            return False
        
        with self._lock:
            try:
                path_str = str(path.absolute())
                
                # Compute baseline hash
                from .hasher import IntegrityHasher
                hasher = IntegrityHasher()
                result = hasher.hash_file(path)
                
                if not result.success:
                    return False
                
                # Build Merkle tree for large files
                merkle_root = None
                if path.stat().st_size > 1024 * 1024:  # > 1MB
                    tree = self._merkle.build_tree(path)
                    self._merkle_store.store(path_str, tree)
                    merkle_root = tree.root_hash
                
                # Create encrypted backup if requested
                encrypted_backup = None
                if create_backup and level in [ProtectionLevel.ENCRYPT_BACKUP, ProtectionLevel.SEALED]:
                    backup_path = self._backups_dir / f"{path.name}.encrypted"
                    self._envelope.encrypt_file(path, backup_path)
                    encrypted_backup = str(backup_path)
                
                # Create protected file entry
                pf = ProtectedFile(
                    path=path_str,
                    level=level,
                    baseline_hash=result.hash,
                    merkle_root=merkle_root,
                    encrypted_backup=encrypted_backup,
                    protection_started=datetime.utcnow(),
                    last_verified=None,
                )
                
                self._protected_files[path_str] = pf
                self._save_protected_files()
                
                # Log event
                self._event_chain.append(
                    ChainEventType.FILE_PROTECTED,
                    {
                        'path': path_str,
                        'level': level.value,
                        'hash': result.hash,
                        'merkle_root': merkle_root,
                    }
                )
                
                return True
                
            except Exception as e:
                print(f"Error protecting file: {e}")
                return False
    
    def unprotect_file(self, path: Path) -> bool:
        """
        Remove a file from protection.
        
        Args:
            path: Path to file
            
        Returns:
            True if removed
        """
        if not self._initialized:
            return False
        
        with self._lock:
            path_str = str(Path(path).absolute())
            
            if path_str not in self._protected_files:
                return False
            
            pf = self._protected_files[path_str]
            
            # Remove Merkle tree
            self._merkle_store.delete(path_str)
            
            # Remove encrypted backup
            if pf.encrypted_backup and Path(pf.encrypted_backup).exists():
                Path(pf.encrypted_backup).unlink()
            
            # Remove from state
            del self._protected_files[path_str]
            self._save_protected_files()
            
            # Log event
            self._event_chain.append(
                ChainEventType.FILE_UNPROTECTED,
                {'path': path_str}
            )
            
            return True
    
    def verify_file(self, path: Path) -> Tuple[bool, str]:
        """
        Verify a single protected file.
        
        Args:
            path: Path to file
            
        Returns:
            Tuple of (is_valid, message)
        """
        if not self._initialized:
            return False, "Service not initialized"
        
        path_str = str(Path(path).absolute())
        
        pf = self._protected_files.get(path_str)
        if not pf:
            return False, "File not protected"
        
        path_obj = Path(path_str)
        if not path_obj.exists():
            self._event_chain.append(
                ChainEventType.TAMPER_DETECTED,
                {'path': path_str, 'reason': 'File missing'}
            )
            return False, "File missing"
        
        # Check hash
        from .hasher import IntegrityHasher
        hasher = IntegrityHasher()
        result = hasher.hash_file(path_obj)
        
        if not result.success:
            return False, f"Hash computation failed: {result.error}"
        
        if result.hash != pf.baseline_hash:
            self._event_chain.append(
                ChainEventType.TAMPER_DETECTED,
                {
                    'path': path_str,
                    'reason': 'Content modified',
                    'expected_hash': pf.baseline_hash,
                    'actual_hash': result.hash,
                }
            )
            return False, "Content modified"
        
        # Update last verified
        pf.last_verified = datetime.utcnow()
        self._save_protected_files()
        
        return True, "Valid"
    
    def verify_all(self) -> VerificationReport:
        """
        Verify all protected files.
        
        Returns:
            VerificationReport with results
        """
        import time
        start = time.time()
        
        passed = 0
        failed = 0
        missing = 0
        modified_files = []
        
        for path_str, pf in self._protected_files.items():
            path = Path(path_str)
            
            if not path.exists():
                missing += 1
                modified_files.append(path_str)
                continue
            
            valid, msg = self.verify_file(path)
            
            if valid:
                passed += 1
            else:
                failed += 1
                modified_files.append(path_str)
        
        # Verify event chain
        chain_result = self._event_chain.verify_chain()
        
        # Get latest manifest status
        manifest_status = 'none'
        latest_manifest = self._manifest_store.get_latest()
        if latest_manifest:
            verifier = ManifestVerifier()
            status, _ = verifier.verify(latest_manifest)
            manifest_status = status.value
        
        duration = (time.time() - start) * 1000
        
        report = VerificationReport(
            timestamp=datetime.utcnow(),
            total_files=len(self._protected_files),
            passed=passed,
            failed=failed,
            missing=missing,
            modified_files=modified_files,
            chain_integrity=chain_result.integrity.value,
            manifest_status=manifest_status,
            duration_ms=duration,
        )
        
        # Log verification
        self._event_chain.append(
            ChainEventType.CHAIN_VERIFIED,
            {
                'total': report.total_files,
                'passed': passed,
                'failed': failed,
                'missing': missing,
            }
        )
        
        return report
    
    def create_manifest(
        self,
        paths: Optional[List[Path]] = None,
        description: Optional[str] = None
    ) -> SignedManifest:
        """
        Create a signed manifest of protected files.
        
        Args:
            paths: Specific paths to include (None = all protected)
            description: Optional description
            
        Returns:
            Signed manifest
        """
        if not self._initialized:
            raise RuntimeError("Service not initialized")
        
        # Determine paths
        if paths is None:
            paths = [Path(p) for p in self._protected_files.keys()]
        
        # Get signing key
        sign_token = self._ensure_token(TokenType.SIGNING)
        signing_key = self._broker.get_signing_key(sign_token)
        
        # Build manifest
        builder = ManifestBuilder(self.app_data_dir)
        manifest = builder.build(
            paths,
            description=description,
            previous_manifest=self._manifest_store.get_latest(),
            include_chunk_hashes=True,
        )
        
        # Sign manifest
        signer = ManifestSigner(signing_key)
        manifest = signer.sign_manifest(manifest, "FileGuard Security Service")
        
        # Store manifest
        self._manifest_store.store(manifest)
        
        # Log event
        self._event_chain.append(
            ChainEventType.FILE_PROTECTED,
            {
                'manifest_hash': manifest.get_manifest_hash(),
                'entry_count': manifest.entry_count,
                'description': description,
            }
        )
        
        return manifest
    
    def verify_manifest(
        self,
        manifest_hash: Optional[str] = None
    ) -> Tuple[ManifestStatus, List[Dict[str, Any]]]:
        """
        Verify a manifest against current file state.
        
        Args:
            manifest_hash: Specific manifest to verify (None = latest)
            
        Returns:
            Tuple of (status, results)
        """
        if not self._initialized:
            return ManifestStatus.CORRUPTED, []
        
        if manifest_hash:
            manifest = self._manifest_store.load(manifest_hash)
        else:
            manifest = self._manifest_store.get_latest()
        
        if not manifest:
            return ManifestStatus.CORRUPTED, []
        
        verifier = ManifestVerifier()
        status, results = verifier.verify(manifest)
        
        return status, [
            {
                'path': r.path,
                'status': r.status,
                'expected_hash': r.expected_hash,
                'actual_hash': r.actual_hash,
                'details': r.details,
            }
            for r in results
        ]
    
    def restore_file(self, path: Path) -> bool:
        """
        Restore a file from encrypted backup.
        
        Args:
            path: Path to file to restore
            
        Returns:
            True if restored successfully
        """
        if not self._initialized:
            return False
        
        path_str = str(Path(path).absolute())
        pf = self._protected_files.get(path_str)
        
        if not pf or not pf.encrypted_backup:
            return False
        
        backup_path = Path(pf.encrypted_backup)
        if not backup_path.exists():
            return False
        
        try:
            # Decrypt backup
            self._envelope.decrypt_file(backup_path, Path(path_str))
            
            # Log restoration
            self._event_chain.append(
                ChainEventType.FILE_RESTORED,
                {
                    'path': path_str,
                    'backup_used': str(backup_path),
                }
            )
            
            return True
            
        except Exception as e:
            print(f"Restore error: {e}")
            return False
    
    def rotate_keys(self) -> bool:
        """
        Rotate encryption keys.
        
        Re-wraps all DEKs with a new KEK without re-encrypting data.
        
        Returns:
            True if rotation successful
        """
        if not self._initialized:
            return False
        
        try:
            # Rotate master key in broker
            self._broker.rotate_master_key()
            
            # Get new encryption key
            enc_token = self._broker.issue_token(TokenType.ENCRYPTION)
            new_kek = self._broker.get_encryption_key(enc_token)
            
            # Re-wrap all DEKs
            count = self._envelope.rotate_kek(new_kek)
            
            self._tokens[TokenType.ENCRYPTION] = enc_token
            
            # Log rotation
            self._event_chain.append(
                ChainEventType.KEY_ROTATED,
                {'keys_rewrapped': count}
            )
            
            return True
            
        except Exception as e:
            print(f"Key rotation error: {e}")
            return False
    
    def get_event_chain(self) -> EventChain:
        """Get the event chain for direct access."""
        return self._event_chain
    
    def get_chain_stats(self) -> Dict[str, Any]:
        """Get event chain statistics."""
        if not self._event_chain:
            return {}
        return self._event_chain.get_chain_stats()
    
    def get_token_stats(self) -> Dict[str, Any]:
        """Get token statistics from broker."""
        if not self._broker:
            return {}
        return self._broker.get_token_stats()
    
    def get_protected_files(self) -> List[ProtectedFile]:
        """Get list of all protected files."""
        return list(self._protected_files.values())
    
    def get_protected_file(self, path: str) -> Optional[ProtectedFile]:
        """Get info for a specific protected file."""
        return self._protected_files.get(str(Path(path).absolute()))
    
    def shutdown(self) -> None:
        """Shutdown the security service."""
        if self._event_chain:
            self._event_chain.append(
                ChainEventType.SERVICE_STOPPED,
                {'message': 'Security service shutdown'}
            )
        
        self._initialized = False
