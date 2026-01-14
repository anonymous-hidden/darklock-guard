"""
Secret Broker for FileGuard
===========================
Protected broker that holds master secrets and issues short-lived tokens.
Implements the principle of least privilege - secrets never leave the broker
in raw form, only as time-limited tokens.

Architecture:
    Agent <---> Broker <---> Secure Storage (DPAPI/Keyring)
                   |
                   └---> Token Manager (issues short-lived credentials)

Design Philosophy:
- Master secrets never exposed directly to application code
- All access through short-lived, revocable tokens
- OS-level protection for secret storage
- Clean separation of concerns
"""

import os
import sys
import json
import secrets
import threading
import hashlib
import hmac
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from enum import Enum
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


# Platform detection
IS_WINDOWS = sys.platform == 'win32'
IS_LINUX = sys.platform.startswith('linux')


class TokenType(Enum):
    """Types of tokens the broker can issue."""
    DATABASE = 'database'           # Short-lived DB credentials
    ENCRYPTION = 'encryption'       # Key material for file encryption
    SIGNING = 'signing'            # Ed25519 signing operations
    AUDIT_WRITE = 'audit_write'    # Permission to write audit logs
    BACKUP = 'backup'              # Permission to create/restore backups


class TokenStatus(Enum):
    """Status of issued tokens."""
    VALID = 'valid'
    EXPIRED = 'expired'
    REVOKED = 'revoked'


@dataclass
class Token:
    """
    A short-lived credential token issued by the broker.
    
    Tokens provide time-limited access to specific operations
    without exposing the underlying master secrets.
    """
    id: str                         # Unique token identifier
    token_type: TokenType           # What this token grants access to
    issued_at: datetime             # When the token was created
    expires_at: datetime            # When the token becomes invalid
    claims: Dict[str, Any]          # Additional data (encrypted in storage)
    signature: str                  # HMAC signature for integrity
    
    # Derived key for operations (never stored, computed on demand)
    _derived_key: Optional[bytes] = field(default=None, repr=False)
    
    @property
    def is_valid(self) -> bool:
        """Check if token is still valid (not expired)."""
        return datetime.utcnow() < self.expires_at
    
    @property
    def ttl_seconds(self) -> int:
        """Remaining time to live in seconds."""
        remaining = self.expires_at - datetime.utcnow()
        return max(0, int(remaining.total_seconds()))
    
    def to_dict(self) -> dict:
        """Serialize for transmission (excludes internal fields)."""
        return {
            'id': self.id,
            'type': self.token_type.value,
            'issued_at': self.issued_at.isoformat(),
            'expires_at': self.expires_at.isoformat(),
            'claims': self.claims,
            'signature': self.signature,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'Token':
        """Deserialize from transmission format."""
        return cls(
            id=data['id'],
            token_type=TokenType(data['type']),
            issued_at=datetime.fromisoformat(data['issued_at']),
            expires_at=datetime.fromisoformat(data['expires_at']),
            claims=data['claims'],
            signature=data['signature'],
        )


class SecureStorage(ABC):
    """
    Abstract base class for OS-specific secure storage.
    
    Implementations use platform-native secret protection:
    - Windows: DPAPI (Data Protection API)
    - Linux: Secret Service API / encrypted file with locked permissions
    """
    
    @abstractmethod
    def store_secret(self, key: str, data: bytes) -> bool:
        """Store a secret under the given key."""
        pass
    
    @abstractmethod
    def retrieve_secret(self, key: str) -> Optional[bytes]:
        """Retrieve a secret by key, or None if not found."""
        pass
    
    @abstractmethod
    def delete_secret(self, key: str) -> bool:
        """Delete a stored secret."""
        pass
    
    @abstractmethod
    def has_secret(self, key: str) -> bool:
        """Check if a secret exists."""
        pass


class WindowsDPAPIStorage(SecureStorage):
    """
    Windows DPAPI-based secure storage.
    
    DPAPI ties encryption to the current Windows user account,
    providing transparent encryption without key management.
    """
    
    def __init__(self, storage_dir: Path):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_path(self, key: str) -> Path:
        """Get storage path for a key."""
        # Hash the key to prevent directory traversal
        key_hash = hashlib.sha256(key.encode()).hexdigest()[:32]
        return self.storage_dir / f"{key_hash}.dpapi"
    
    def store_secret(self, key: str, data: bytes) -> bool:
        """Store secret using DPAPI encryption."""
        try:
            import ctypes
            from ctypes import wintypes
            
            class DATA_BLOB(ctypes.Structure):
                _fields_ = [
                    ('cbData', wintypes.DWORD),
                    ('pbData', ctypes.POINTER(ctypes.c_char))
                ]
            
            crypt32 = ctypes.windll.crypt32
            kernel32 = ctypes.windll.kernel32
            
            # Prepare input blob
            input_blob = DATA_BLOB()
            input_blob.cbData = len(data)
            input_blob.pbData = ctypes.cast(
                ctypes.create_string_buffer(data, len(data)),
                ctypes.POINTER(ctypes.c_char)
            )
            
            output_blob = DATA_BLOB()
            
            # Encrypt with DPAPI (CRYPTPROTECT_UI_FORBIDDEN = 0x1)
            if not crypt32.CryptProtectData(
                ctypes.byref(input_blob),
                None,  # Optional description
                None,  # Optional entropy
                None,  # Reserved
                None,  # Optional prompt struct
                0x1,   # Flags
                ctypes.byref(output_blob)
            ):
                return False
            
            # Copy encrypted data
            encrypted = ctypes.string_at(output_blob.pbData, output_blob.cbData)
            
            # Free the allocated memory
            kernel32.LocalFree(output_blob.pbData)
            
            # Write to file
            path = self._get_path(key)
            path.write_bytes(encrypted)
            return True
            
        except Exception as e:
            print(f"DPAPI storage error: {e}")
            return False
    
    def retrieve_secret(self, key: str) -> Optional[bytes]:
        """Retrieve and decrypt secret using DPAPI."""
        try:
            import ctypes
            from ctypes import wintypes
            
            path = self._get_path(key)
            if not path.exists():
                return None
            
            encrypted = path.read_bytes()
            
            class DATA_BLOB(ctypes.Structure):
                _fields_ = [
                    ('cbData', wintypes.DWORD),
                    ('pbData', ctypes.POINTER(ctypes.c_char))
                ]
            
            crypt32 = ctypes.windll.crypt32
            kernel32 = ctypes.windll.kernel32
            
            # Prepare input blob
            input_blob = DATA_BLOB()
            input_blob.cbData = len(encrypted)
            input_blob.pbData = ctypes.cast(
                ctypes.create_string_buffer(encrypted, len(encrypted)),
                ctypes.POINTER(ctypes.c_char)
            )
            
            output_blob = DATA_BLOB()
            
            # Decrypt with DPAPI
            if not crypt32.CryptUnprotectData(
                ctypes.byref(input_blob),
                None,  # Optional description out
                None,  # Optional entropy
                None,  # Reserved
                None,  # Optional prompt struct
                0x1,   # Flags
                ctypes.byref(output_blob)
            ):
                return None
            
            # Copy decrypted data
            decrypted = ctypes.string_at(output_blob.pbData, output_blob.cbData)
            
            # Free allocated memory
            kernel32.LocalFree(output_blob.pbData)
            
            return decrypted
            
        except Exception as e:
            print(f"DPAPI retrieval error: {e}")
            return None
    
    def delete_secret(self, key: str) -> bool:
        """Delete a stored secret."""
        try:
            path = self._get_path(key)
            if path.exists():
                path.unlink()
            return True
        except Exception:
            return False
    
    def has_secret(self, key: str) -> bool:
        """Check if a secret exists."""
        return self._get_path(key).exists()


class LinuxSecureStorage(SecureStorage):
    """
    Linux secure storage with encrypted file and locked permissions.
    
    Uses a master key encrypted with a user-derived key,
    stored with restricted file permissions (0600).
    """
    
    def __init__(self, storage_dir: Path):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Ensure directory has restricted permissions
        os.chmod(self.storage_dir, 0o700)
    
    def _get_path(self, key: str) -> Path:
        """Get storage path for a key."""
        key_hash = hashlib.sha256(key.encode()).hexdigest()[:32]
        return self.storage_dir / f"{key_hash}.enc"
    
    def _get_machine_key(self) -> bytes:
        """
        Derive a machine-specific key from system identifiers.
        
        This provides some protection against copying the encrypted
        files to another machine.
        """
        import socket
        import uuid
        
        # Combine machine identifiers
        identifiers = [
            socket.gethostname(),
            str(uuid.getnode()),  # MAC address
            os.environ.get('USER', 'unknown'),
        ]
        
        combined = '|'.join(identifiers).encode()
        
        # Derive a key using HKDF
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'fileguard-linux-v1',
            info=b'machine-key',
        )
        return hkdf.derive(combined)
    
    def store_secret(self, key: str, data: bytes) -> bool:
        """Store secret encrypted with machine-specific key."""
        try:
            machine_key = self._get_machine_key()
            
            # Generate random nonce
            nonce = secrets.token_bytes(12)
            
            # Encrypt with AES-GCM
            aesgcm = AESGCM(machine_key)
            ciphertext = aesgcm.encrypt(nonce, data, key.encode())
            
            # Store nonce + ciphertext
            path = self._get_path(key)
            path.write_bytes(nonce + ciphertext)
            
            # Set restrictive permissions
            os.chmod(path, 0o600)
            
            return True
            
        except Exception as e:
            print(f"Linux storage error: {e}")
            return False
    
    def retrieve_secret(self, key: str) -> Optional[bytes]:
        """Retrieve and decrypt secret."""
        try:
            path = self._get_path(key)
            if not path.exists():
                return None
            
            # Read nonce + ciphertext
            encrypted = path.read_bytes()
            nonce = encrypted[:12]
            ciphertext = encrypted[12:]
            
            machine_key = self._get_machine_key()
            
            # Decrypt
            aesgcm = AESGCM(machine_key)
            return aesgcm.decrypt(nonce, ciphertext, key.encode())
            
        except Exception as e:
            print(f"Linux retrieval error: {e}")
            return None
    
    def delete_secret(self, key: str) -> bool:
        """Delete a stored secret."""
        try:
            path = self._get_path(key)
            if path.exists():
                # Overwrite before deletion for security
                path.write_bytes(secrets.token_bytes(path.stat().st_size))
                path.unlink()
            return True
        except Exception:
            return False
    
    def has_secret(self, key: str) -> bool:
        """Check if a secret exists."""
        return self._get_path(key).exists()


def get_secure_storage(storage_dir: Path) -> SecureStorage:
    """Factory function to get platform-appropriate secure storage."""
    if IS_WINDOWS:
        return WindowsDPAPIStorage(storage_dir)
    else:
        return LinuxSecureStorage(storage_dir)


@dataclass
class TokenRecord:
    """Record of an issued token for tracking and revocation."""
    token_id: str
    token_type: TokenType
    issued_at: datetime
    expires_at: datetime
    revoked: bool = False
    revoked_at: Optional[datetime] = None


class SecretBroker:
    """
    Central secret management broker.
    
    The broker:
    1. Holds master secrets in secure storage
    2. Issues short-lived tokens for operations
    3. Validates tokens and derives operational keys
    4. Manages credential rotation
    5. Tracks all issued tokens for revocation
    
    No master secret ever leaves the broker directly.
    """
    
    # Secret key names
    MASTER_KEY = 'fileguard_master_key'
    SIGNING_KEY = 'fileguard_signing_key'
    TOKEN_KEY = 'fileguard_token_key'
    
    # Default token lifetimes (in seconds)
    DEFAULT_TTL = {
        TokenType.DATABASE: 3600,       # 1 hour
        TokenType.ENCRYPTION: 1800,     # 30 minutes
        TokenType.SIGNING: 900,         # 15 minutes
        TokenType.AUDIT_WRITE: 3600,    # 1 hour
        TokenType.BACKUP: 1800,         # 30 minutes
    }
    
    def __init__(self, storage_dir: Path):
        """
        Initialize the secret broker.
        
        Args:
            storage_dir: Directory for secure storage
        """
        self.storage = get_secure_storage(storage_dir)
        self._lock = threading.RLock()
        
        # In-memory token tracking
        self._issued_tokens: Dict[str, TokenRecord] = {}
        
        # Cache for derived keys (never stored, computed on demand)
        self._key_cache: Dict[str, bytes] = {}
        
        # Initialize master secrets
        self._initialize_secrets()
    
    def _initialize_secrets(self) -> None:
        """Initialize master secrets if they don't exist."""
        with self._lock:
            # Master encryption key (KEK - Key Encryption Key)
            if not self.storage.has_secret(self.MASTER_KEY):
                master_key = secrets.token_bytes(32)  # 256 bits
                self.storage.store_secret(self.MASTER_KEY, master_key)
            
            # Ed25519 signing seed
            if not self.storage.has_secret(self.SIGNING_KEY):
                signing_seed = secrets.token_bytes(32)
                self.storage.store_secret(self.SIGNING_KEY, signing_seed)
            
            # Token signing key
            if not self.storage.has_secret(self.TOKEN_KEY):
                token_key = secrets.token_bytes(32)
                self.storage.store_secret(self.TOKEN_KEY, token_key)
    
    def _get_token_key(self) -> bytes:
        """Get the key used for signing tokens."""
        if 'token_key' not in self._key_cache:
            self._key_cache['token_key'] = self.storage.retrieve_secret(self.TOKEN_KEY)
        return self._key_cache['token_key']
    
    def _sign_token(self, token_data: str) -> str:
        """Create HMAC signature for token."""
        key = self._get_token_key()
        signature = hmac.new(key, token_data.encode(), hashlib.sha256).hexdigest()
        return signature
    
    def _verify_token_signature(self, token: Token) -> bool:
        """Verify token's HMAC signature."""
        # Recreate the signed data
        token_data = f"{token.id}|{token.token_type.value}|{token.issued_at.isoformat()}|{token.expires_at.isoformat()}|{json.dumps(token.claims, sort_keys=True)}"
        expected = self._sign_token(token_data)
        return hmac.compare_digest(token.signature, expected)
    
    def issue_token(
        self,
        token_type: TokenType,
        ttl_seconds: Optional[int] = None,
        claims: Optional[Dict[str, Any]] = None
    ) -> Token:
        """
        Issue a new short-lived token.
        
        Args:
            token_type: Type of access the token grants
            ttl_seconds: Token lifetime (uses default if not specified)
            claims: Additional claims to include in the token
            
        Returns:
            A new Token with derived credentials
        """
        with self._lock:
            now = datetime.utcnow()
            
            # Determine lifetime
            ttl = ttl_seconds or self.DEFAULT_TTL.get(token_type, 3600)
            expires = now + timedelta(seconds=ttl)
            
            # Generate unique token ID
            token_id = secrets.token_urlsafe(24)
            
            # Build token data for signing
            token_claims = claims or {}
            token_data = f"{token_id}|{token_type.value}|{now.isoformat()}|{expires.isoformat()}|{json.dumps(token_claims, sort_keys=True)}"
            signature = self._sign_token(token_data)
            
            # Create token
            token = Token(
                id=token_id,
                token_type=token_type,
                issued_at=now,
                expires_at=expires,
                claims=token_claims,
                signature=signature,
            )
            
            # Derive operational key for this token
            token._derived_key = self._derive_token_key(token)
            
            # Record the token
            self._issued_tokens[token_id] = TokenRecord(
                token_id=token_id,
                token_type=token_type,
                issued_at=now,
                expires_at=expires,
            )
            
            return token
    
    def _derive_token_key(self, token: Token) -> bytes:
        """
        Derive an operational key for a token.
        
        Uses HKDF to derive a unique key from the master key
        and the token's identity. This key is used for the
        actual cryptographic operations.
        """
        master_key = self.storage.retrieve_secret(self.MASTER_KEY)
        
        # Include token identity in derivation for uniqueness
        info = f"{token.id}|{token.token_type.value}".encode()
        
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=token.issued_at.isoformat().encode(),
            info=info,
        )
        return hkdf.derive(master_key)
    
    def validate_token(self, token: Token) -> Tuple[bool, str]:
        """
        Validate a token's authenticity and status.
        
        Returns:
            Tuple of (is_valid, reason)
        """
        with self._lock:
            # Check signature
            if not self._verify_token_signature(token):
                return False, "Invalid signature"
            
            # Check expiration
            if not token.is_valid:
                return False, "Token expired"
            
            # Check if revoked
            record = self._issued_tokens.get(token.id)
            if record and record.revoked:
                return False, "Token revoked"
            
            return True, "Valid"
    
    def revoke_token(self, token_id: str) -> bool:
        """
        Revoke a token, preventing further use.
        
        Args:
            token_id: ID of the token to revoke
            
        Returns:
            True if revoked successfully
        """
        with self._lock:
            record = self._issued_tokens.get(token_id)
            if record:
                record.revoked = True
                record.revoked_at = datetime.utcnow()
                return True
            return False
    
    def revoke_all_tokens(self, token_type: Optional[TokenType] = None) -> int:
        """
        Revoke all tokens, optionally filtering by type.
        
        Args:
            token_type: If specified, only revoke tokens of this type
            
        Returns:
            Number of tokens revoked
        """
        with self._lock:
            count = 0
            now = datetime.utcnow()
            
            for record in self._issued_tokens.values():
                if record.revoked:
                    continue
                    
                if token_type is None or record.token_type == token_type:
                    record.revoked = True
                    record.revoked_at = now
                    count += 1
            
            return count
    
    def cleanup_expired_tokens(self) -> int:
        """
        Remove expired token records to prevent memory growth.
        
        Returns:
            Number of records removed
        """
        with self._lock:
            now = datetime.utcnow()
            expired = [
                tid for tid, record in self._issued_tokens.items()
                if record.expires_at < now
            ]
            
            for tid in expired:
                del self._issued_tokens[tid]
            
            return len(expired)
    
    def get_encryption_key(self, token: Token) -> Optional[bytes]:
        """
        Get the derived encryption key for an encryption token.
        
        Only returns the key if the token is valid and of the
        correct type.
        """
        is_valid, _ = self.validate_token(token)
        if not is_valid:
            return None
        
        if token.token_type != TokenType.ENCRYPTION:
            return None
        
        return token._derived_key or self._derive_token_key(token)
    
    def get_signing_key(self, token: Token) -> Optional[bytes]:
        """
        Get the Ed25519 signing key seed for a signing token.
        
        The actual key material is derived from the stored seed
        and token identity for domain separation.
        """
        is_valid, _ = self.validate_token(token)
        if not is_valid:
            return None
        
        if token.token_type != TokenType.SIGNING:
            return None
        
        # Get the signing seed
        seed = self.storage.retrieve_secret(self.SIGNING_KEY)
        
        # Derive a token-specific key
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=token.id.encode(),
            info=b'ed25519-signing',
        )
        return hkdf.derive(seed)
    
    def rotate_master_key(self) -> bool:
        """
        Rotate the master encryption key.
        
        IMPORTANT: After rotation, all encrypted data must be
        re-encrypted with the new key. This method only replaces
        the key - data re-encryption must be handled separately.
        
        Returns:
            True if rotation successful
        """
        with self._lock:
            try:
                # Generate new key
                new_key = secrets.token_bytes(32)
                
                # Store old key temporarily (for re-encryption)
                old_key = self.storage.retrieve_secret(self.MASTER_KEY)
                self.storage.store_secret(f"{self.MASTER_KEY}_old", old_key)
                
                # Store new key
                self.storage.store_secret(self.MASTER_KEY, new_key)
                
                # Clear key cache
                self._key_cache.clear()
                
                # Revoke all encryption tokens (they use old key derivation)
                self.revoke_all_tokens(TokenType.ENCRYPTION)
                
                return True
                
            except Exception as e:
                print(f"Key rotation error: {e}")
                return False
    
    def get_token_stats(self) -> Dict[str, Any]:
        """Get statistics about issued tokens."""
        with self._lock:
            now = datetime.utcnow()
            
            total = len(self._issued_tokens)
            active = sum(
                1 for r in self._issued_tokens.values()
                if not r.revoked and r.expires_at > now
            )
            revoked = sum(1 for r in self._issued_tokens.values() if r.revoked)
            expired = sum(
                1 for r in self._issued_tokens.values()
                if not r.revoked and r.expires_at <= now
            )
            
            by_type = {}
            for token_type in TokenType:
                count = sum(
                    1 for r in self._issued_tokens.values()
                    if r.token_type == token_type and not r.revoked and r.expires_at > now
                )
                if count > 0:
                    by_type[token_type.value] = count
            
            return {
                'total': total,
                'active': active,
                'revoked': revoked,
                'expired': expired,
                'by_type': by_type,
            }
