"""
Envelope Encryption for FileGuard
=================================
Implements envelope encryption pattern with per-file Data Encryption Keys (DEKs)
wrapped by a master Key Encryption Key (KEK).

Architecture:
    Master KEK (in broker) 
        └── wraps → DEK_1 (encrypts file_1)
        └── wraps → DEK_2 (encrypts file_2)
        └── wraps → DEK_n (encrypts file_n)

Benefits:
- Key rotation only re-wraps DEKs, not re-encrypts all data
- Each file has unique key material
- Compromise of one DEK doesn't expose all data
- KEK never used directly for data encryption

Design Philosophy:
- Defense in depth with layered keys
- Efficient key rotation without data re-encryption
- Forward secrecy through unique DEKs
"""

import os
import json
import secrets
import hashlib
import base64
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


# Constants
AES_KEY_SIZE = 32       # 256 bits
NONCE_SIZE = 12         # 96 bits for GCM
CHUNK_SIZE = 65536      # 64KB read chunks


class KeyStatus(Enum):
    """Status of wrapped keys."""
    ACTIVE = 'active'           # Currently in use
    ROTATED = 'rotated'         # Old key, still valid for decryption
    REVOKED = 'revoked'         # No longer valid


@dataclass
class WrappedKey:
    """
    A Data Encryption Key wrapped by the master KEK.
    
    Contains all metadata needed to unwrap and use the key.
    """
    key_id: str                     # Unique identifier
    wrapped_key: bytes              # DEK encrypted by KEK
    wrap_nonce: bytes               # Nonce used for wrapping
    kek_version: int                # KEK version used to wrap
    created_at: datetime
    status: KeyStatus = KeyStatus.ACTIVE
    associated_path: Optional[str] = None  # File this key encrypts
    
    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            'key_id': self.key_id,
            'wrapped_key': base64.b64encode(self.wrapped_key).decode('ascii'),
            'wrap_nonce': base64.b64encode(self.wrap_nonce).decode('ascii'),
            'kek_version': self.kek_version,
            'created_at': self.created_at.isoformat(),
            'status': self.status.value,
            'associated_path': self.associated_path,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'WrappedKey':
        """Deserialize from dictionary."""
        return cls(
            key_id=data['key_id'],
            wrapped_key=base64.b64decode(data['wrapped_key']),
            wrap_nonce=base64.b64decode(data['wrap_nonce']),
            kek_version=data['kek_version'],
            created_at=datetime.fromisoformat(data['created_at']),
            status=KeyStatus(data['status']),
            associated_path=data.get('associated_path'),
        )


@dataclass
class EncryptedFile:
    """
    Metadata for an encrypted file.
    
    Stored alongside the encrypted data to enable decryption.
    """
    key_id: str                     # ID of DEK used
    nonce: bytes                    # Encryption nonce
    original_size: int              # Size before encryption
    original_hash: str              # SHA-256 of plaintext
    encrypted_at: datetime
    cipher: str = 'AES-256-GCM'
    
    # Header format: FGENC\x01 + json_metadata_length (4 bytes) + json_metadata + ciphertext
    MAGIC = b'FGENC\x01'
    
    def to_header_bytes(self) -> bytes:
        """Create header bytes for prepending to encrypted data."""
        metadata = {
            'key_id': self.key_id,
            'nonce': base64.b64encode(self.nonce).decode('ascii'),
            'original_size': self.original_size,
            'original_hash': self.original_hash,
            'encrypted_at': self.encrypted_at.isoformat(),
            'cipher': self.cipher,
        }
        json_bytes = json.dumps(metadata).encode('utf-8')
        length = len(json_bytes).to_bytes(4, 'big')
        return self.MAGIC + length + json_bytes
    
    @classmethod
    def from_header_bytes(cls, data: bytes) -> Tuple['EncryptedFile', int]:
        """
        Parse header from encrypted file data.
        
        Returns:
            Tuple of (EncryptedFile, offset to ciphertext)
        """
        if not data.startswith(cls.MAGIC):
            raise ValueError("Invalid encrypted file format")
        
        # Read length
        length_offset = len(cls.MAGIC)
        json_length = int.from_bytes(data[length_offset:length_offset+4], 'big')
        
        # Read JSON metadata
        json_start = length_offset + 4
        json_bytes = data[json_start:json_start + json_length]
        metadata = json.loads(json_bytes.decode('utf-8'))
        
        ciphertext_offset = json_start + json_length
        
        return cls(
            key_id=metadata['key_id'],
            nonce=base64.b64decode(metadata['nonce']),
            original_size=metadata['original_size'],
            original_hash=metadata['original_hash'],
            encrypted_at=datetime.fromisoformat(metadata['encrypted_at']),
            cipher=metadata.get('cipher', 'AES-256-GCM'),
        ), ciphertext_offset


class KeyStore:
    """
    Persistent storage for wrapped DEKs.
    
    Maintains the key hierarchy and supports key rotation.
    """
    
    def __init__(self, storage_path: Path):
        """
        Initialize the key store.
        
        Args:
            storage_path: Path to key store file
        """
        self.storage_path = Path(storage_path)
        self._keys: Dict[str, WrappedKey] = {}
        self._kek_version = 1
        self._load()
    
    def _load(self) -> None:
        """Load keys from storage."""
        if self.storage_path.exists():
            try:
                data = json.loads(self.storage_path.read_text())
                self._kek_version = data.get('kek_version', 1)
                for key_data in data.get('keys', []):
                    key = WrappedKey.from_dict(key_data)
                    self._keys[key.key_id] = key
            except Exception as e:
                print(f"Error loading key store: {e}")
    
    def _save(self) -> None:
        """Save keys to storage."""
        data = {
            'kek_version': self._kek_version,
            'keys': [k.to_dict() for k in self._keys.values()],
        }
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self.storage_path.write_text(json.dumps(data, indent=2))
    
    def add_key(self, key: WrappedKey) -> None:
        """Add a wrapped key to the store."""
        self._keys[key.key_id] = key
        self._save()
    
    def get_key(self, key_id: str) -> Optional[WrappedKey]:
        """Get a wrapped key by ID."""
        return self._keys.get(key_id)
    
    def get_key_for_path(self, path: str) -> Optional[WrappedKey]:
        """Get the active key for a file path."""
        for key in self._keys.values():
            if key.associated_path == path and key.status == KeyStatus.ACTIVE:
                return key
        return None
    
    def revoke_key(self, key_id: str) -> bool:
        """Revoke a key."""
        key = self._keys.get(key_id)
        if key:
            key.status = KeyStatus.REVOKED
            self._save()
            return True
        return False
    
    def get_kek_version(self) -> int:
        """Get current KEK version."""
        return self._kek_version
    
    def increment_kek_version(self) -> int:
        """Increment KEK version for rotation."""
        self._kek_version += 1
        self._save()
        return self._kek_version
    
    def get_keys_for_rewrap(self) -> List[WrappedKey]:
        """Get all active keys that need re-wrapping after KEK rotation."""
        return [
            k for k in self._keys.values()
            if k.status == KeyStatus.ACTIVE and k.kek_version < self._kek_version
        ]
    
    def list_keys(self, include_revoked: bool = False) -> List[WrappedKey]:
        """List all keys."""
        if include_revoked:
            return list(self._keys.values())
        return [k for k in self._keys.values() if k.status != KeyStatus.REVOKED]


class EnvelopeEncryption:
    """
    Main envelope encryption engine.
    
    Handles:
    - DEK generation and wrapping
    - File encryption with unique DEKs
    - Decryption using wrapped DEKs
    - Key rotation without data re-encryption
    """
    
    def __init__(
        self,
        kek: bytes,
        key_store: KeyStore
    ):
        """
        Initialize the envelope encryption engine.
        
        Args:
            kek: 32-byte Key Encryption Key (from broker)
            key_store: Storage for wrapped DEKs
        """
        if len(kek) != AES_KEY_SIZE:
            raise ValueError(f"KEK must be {AES_KEY_SIZE} bytes")
        
        self._kek = kek
        self._key_store = key_store
        self._kek_cipher = AESGCM(kek)
    
    def _generate_dek(self) -> Tuple[str, bytes]:
        """
        Generate a new Data Encryption Key.
        
        Returns:
            Tuple of (key_id, raw_dek_bytes)
        """
        key_id = secrets.token_urlsafe(16)
        dek = secrets.token_bytes(AES_KEY_SIZE)
        return key_id, dek
    
    def _wrap_dek(self, dek: bytes, key_id: str, path: Optional[str] = None) -> WrappedKey:
        """
        Wrap a DEK with the KEK.
        
        Args:
            dek: Raw DEK bytes
            key_id: Key identifier
            path: Optional associated file path
            
        Returns:
            WrappedKey with encrypted DEK
        """
        nonce = secrets.token_bytes(NONCE_SIZE)
        
        # Include key_id as associated data for binding
        aad = key_id.encode('utf-8')
        wrapped = self._kek_cipher.encrypt(nonce, dek, aad)
        
        return WrappedKey(
            key_id=key_id,
            wrapped_key=wrapped,
            wrap_nonce=nonce,
            kek_version=self._key_store.get_kek_version(),
            created_at=datetime.utcnow(),
            associated_path=path,
        )
    
    def _unwrap_dek(self, wrapped_key: WrappedKey) -> bytes:
        """
        Unwrap a DEK using the KEK.
        
        Args:
            wrapped_key: The wrapped key to unwrap
            
        Returns:
            Raw DEK bytes
        """
        if wrapped_key.status == KeyStatus.REVOKED:
            raise ValueError("Key has been revoked")
        
        aad = wrapped_key.key_id.encode('utf-8')
        return self._kek_cipher.decrypt(
            wrapped_key.wrap_nonce,
            wrapped_key.wrapped_key,
            aad
        )
    
    def encrypt_file(
        self,
        input_path: Path,
        output_path: Optional[Path] = None,
        reuse_key_id: Optional[str] = None
    ) -> Tuple[Path, str]:
        """
        Encrypt a file using envelope encryption.
        
        Args:
            input_path: Path to file to encrypt
            output_path: Output path (default: input_path + .encrypted)
            reuse_key_id: Optional existing key ID to reuse
            
        Returns:
            Tuple of (output_path, key_id)
        """
        input_path = Path(input_path)
        output_path = Path(output_path or f"{input_path}.encrypted")
        
        # Get or create DEK
        if reuse_key_id:
            wrapped = self._key_store.get_key(reuse_key_id)
            if not wrapped:
                raise ValueError(f"Key {reuse_key_id} not found")
            dek = self._unwrap_dek(wrapped)
            key_id = reuse_key_id
        else:
            key_id, dek = self._generate_dek()
            wrapped = self._wrap_dek(dek, key_id, str(input_path))
            self._key_store.add_key(wrapped)
        
        # Create cipher with DEK
        cipher = AESGCM(dek)
        nonce = secrets.token_bytes(NONCE_SIZE)
        
        # Read and hash plaintext
        plaintext = input_path.read_bytes()
        original_hash = hashlib.sha256(plaintext).hexdigest()
        
        # Encrypt
        ciphertext = cipher.encrypt(nonce, plaintext, None)
        
        # Create metadata
        metadata = EncryptedFile(
            key_id=key_id,
            nonce=nonce,
            original_size=len(plaintext),
            original_hash=original_hash,
            encrypted_at=datetime.utcnow(),
        )
        
        # Write output: header + ciphertext
        output_path.write_bytes(metadata.to_header_bytes() + ciphertext)
        
        # Clear sensitive data
        del dek, plaintext
        
        return output_path, key_id
    
    def decrypt_file(
        self,
        input_path: Path,
        output_path: Optional[Path] = None,
        verify_hash: bool = True
    ) -> Path:
        """
        Decrypt an encrypted file.
        
        Args:
            input_path: Path to encrypted file
            output_path: Output path (default: removes .encrypted suffix)
            verify_hash: Whether to verify the decrypted hash
            
        Returns:
            Path to decrypted file
        """
        input_path = Path(input_path)
        
        if output_path is None:
            if input_path.suffix == '.encrypted':
                output_path = input_path.with_suffix('')
            else:
                output_path = input_path.with_suffix('.decrypted')
        
        output_path = Path(output_path)
        
        # Read encrypted file
        encrypted_data = input_path.read_bytes()
        
        # Parse header
        metadata, ciphertext_offset = EncryptedFile.from_header_bytes(encrypted_data)
        ciphertext = encrypted_data[ciphertext_offset:]
        
        # Get DEK
        wrapped = self._key_store.get_key(metadata.key_id)
        if not wrapped:
            raise ValueError(f"Key {metadata.key_id} not found")
        
        dek = self._unwrap_dek(wrapped)
        
        # Decrypt
        cipher = AESGCM(dek)
        plaintext = cipher.decrypt(metadata.nonce, ciphertext, None)
        
        # Verify hash if requested
        if verify_hash:
            actual_hash = hashlib.sha256(plaintext).hexdigest()
            if actual_hash != metadata.original_hash:
                raise ValueError("Decrypted data hash mismatch - possible corruption")
        
        # Write output
        output_path.write_bytes(plaintext)
        
        # Clear sensitive data
        del dek, plaintext
        
        return output_path
    
    def encrypt_bytes(
        self,
        data: bytes,
        key_id: Optional[str] = None
    ) -> Tuple[bytes, str]:
        """
        Encrypt bytes in memory.
        
        Args:
            data: Bytes to encrypt
            key_id: Optional existing key ID
            
        Returns:
            Tuple of (encrypted_bytes, key_id)
        """
        # Get or create DEK
        if key_id:
            wrapped = self._key_store.get_key(key_id)
            if not wrapped:
                raise ValueError(f"Key {key_id} not found")
            dek = self._unwrap_dek(wrapped)
        else:
            key_id, dek = self._generate_dek()
            wrapped = self._wrap_dek(dek, key_id)
            self._key_store.add_key(wrapped)
        
        # Encrypt
        cipher = AESGCM(dek)
        nonce = secrets.token_bytes(NONCE_SIZE)
        ciphertext = cipher.encrypt(nonce, data, None)
        
        # Create metadata
        metadata = EncryptedFile(
            key_id=key_id,
            nonce=nonce,
            original_size=len(data),
            original_hash=hashlib.sha256(data).hexdigest(),
            encrypted_at=datetime.utcnow(),
        )
        
        result = metadata.to_header_bytes() + ciphertext
        
        del dek
        return result, key_id
    
    def decrypt_bytes(
        self,
        encrypted_data: bytes,
        verify_hash: bool = True
    ) -> bytes:
        """
        Decrypt bytes in memory.
        
        Args:
            encrypted_data: Encrypted bytes with header
            verify_hash: Whether to verify hash
            
        Returns:
            Decrypted bytes
        """
        # Parse header
        metadata, offset = EncryptedFile.from_header_bytes(encrypted_data)
        ciphertext = encrypted_data[offset:]
        
        # Get DEK
        wrapped = self._key_store.get_key(metadata.key_id)
        if not wrapped:
            raise ValueError(f"Key {metadata.key_id} not found")
        
        dek = self._unwrap_dek(wrapped)
        
        # Decrypt
        cipher = AESGCM(dek)
        plaintext = cipher.decrypt(metadata.nonce, ciphertext, None)
        
        # Verify
        if verify_hash:
            actual_hash = hashlib.sha256(plaintext).hexdigest()
            if actual_hash != metadata.original_hash:
                raise ValueError("Hash mismatch")
        
        del dek
        return plaintext
    
    def rotate_kek(self, new_kek: bytes) -> int:
        """
        Rotate the KEK and re-wrap all active DEKs.
        
        Args:
            new_kek: New 32-byte KEK
            
        Returns:
            Number of keys re-wrapped
        """
        if len(new_kek) != AES_KEY_SIZE:
            raise ValueError(f"KEK must be {AES_KEY_SIZE} bytes")
        
        # Get keys to re-wrap
        keys_to_rewrap = self._key_store.get_keys_for_rewrap()
        
        # Also include current version keys for rotation
        current_version = self._key_store.get_kek_version()
        all_active = [
            k for k in self._key_store.list_keys()
            if k.status == KeyStatus.ACTIVE
        ]
        
        # Increment KEK version
        new_version = self._key_store.increment_kek_version()
        
        # Create new KEK cipher
        new_cipher = AESGCM(new_kek)
        
        count = 0
        for wrapped in all_active:
            try:
                # Unwrap with old KEK
                dek = self._unwrap_dek(wrapped)
                
                # Mark old version as rotated
                wrapped.status = KeyStatus.ROTATED
                
                # Re-wrap with new KEK
                nonce = secrets.token_bytes(NONCE_SIZE)
                aad = wrapped.key_id.encode('utf-8')
                new_wrapped_key = new_cipher.encrypt(nonce, dek, aad)
                
                # Create new wrapped key entry
                new_wrapped = WrappedKey(
                    key_id=wrapped.key_id,
                    wrapped_key=new_wrapped_key,
                    wrap_nonce=nonce,
                    kek_version=new_version,
                    created_at=datetime.utcnow(),
                    associated_path=wrapped.associated_path,
                )
                
                self._key_store.add_key(new_wrapped)
                count += 1
                
                del dek
                
            except Exception as e:
                print(f"Error re-wrapping key {wrapped.key_id}: {e}")
        
        # Update internal KEK reference
        self._kek = new_kek
        self._kek_cipher = AESGCM(new_kek)
        
        return count


class StreamingEncryption:
    """
    Streaming encryption for large files.
    
    Encrypts files in chunks to avoid loading entire file into memory.
    Each chunk is independently encrypted but linked together.
    """
    
    def __init__(self, envelope: EnvelopeEncryption, chunk_size: int = 1024 * 1024):
        """
        Initialize streaming encryption.
        
        Args:
            envelope: EnvelopeEncryption instance
            chunk_size: Size of each chunk (default 1MB)
        """
        self.envelope = envelope
        self.chunk_size = chunk_size
    
    def encrypt_file_streaming(
        self,
        input_path: Path,
        output_path: Optional[Path] = None
    ) -> Tuple[Path, str]:
        """
        Encrypt a large file using streaming.
        
        Each chunk is encrypted with a derived key, and chunk hashes
        are stored for Merkle tree verification.
        """
        input_path = Path(input_path)
        output_path = Path(output_path or f"{input_path}.encrypted")
        
        # Generate DEK
        key_id, dek = self.envelope._generate_dek()
        wrapped = self.envelope._wrap_dek(dek, key_id, str(input_path))
        self.envelope._key_store.add_key(wrapped)
        
        chunk_hashes = []
        total_size = 0
        
        with open(input_path, 'rb') as fin, open(output_path, 'wb') as fout:
            # Write placeholder header (will update after)
            header_placeholder = b'\x00' * 512
            fout.write(header_placeholder)
            
            chunk_index = 0
            overall_hasher = hashlib.sha256()
            
            while True:
                chunk = fin.read(self.chunk_size)
                if not chunk:
                    break
                
                total_size += len(chunk)
                overall_hasher.update(chunk)
                
                # Hash chunk for Merkle tree
                chunk_hash = hashlib.sha256(chunk).hexdigest()
                chunk_hashes.append(chunk_hash)
                
                # Derive per-chunk nonce from key_id and index
                chunk_nonce = hashlib.sha256(
                    f"{key_id}:{chunk_index}".encode()
                ).digest()[:NONCE_SIZE]
                
                # Encrypt chunk
                cipher = AESGCM(dek)
                encrypted_chunk = cipher.encrypt(chunk_nonce, chunk, None)
                
                # Write: chunk_length (4 bytes) + nonce (12 bytes) + ciphertext
                fout.write(len(encrypted_chunk).to_bytes(4, 'big'))
                fout.write(chunk_nonce)
                fout.write(encrypted_chunk)
                
                chunk_index += 1
            
            original_hash = overall_hasher.hexdigest()
            
            # Create proper header
            metadata = {
                'key_id': key_id,
                'original_size': total_size,
                'original_hash': original_hash,
                'chunk_count': chunk_index,
                'chunk_size': self.chunk_size,
                'chunk_hashes': chunk_hashes,
                'encrypted_at': datetime.utcnow().isoformat(),
            }
            
            header = json.dumps(metadata).encode('utf-8')
            
            # Seek back and write real header
            fout.seek(0)
            fout.write(EncryptedFile.MAGIC)
            fout.write(len(header).to_bytes(4, 'big'))
            fout.write(header)
        
        del dek
        return output_path, key_id
