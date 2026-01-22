"""
Cryptographic Engine for FileGuard
===================================
Handles all encryption/decryption operations using AES-256-GCM.
Key management uses platform-specific secure storage:
- Windows: DPAPI (Data Protection API)
- Linux: Permission-locked key file (0600)

Design Philosophy:
- Keys never leave this module in plaintext
- All encryption uses authenticated encryption (GCM)
- Platform detection is automatic
"""

import os
import sys
import base64
import secrets
import hashlib
from pathlib import Path
from typing import Optional, Tuple
from dataclasses import dataclass
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# Detect platform once at module load
IS_WINDOWS = sys.platform == 'win32'
IS_LINUX = sys.platform.startswith('linux')


@dataclass
class EncryptedBlob:
    """
    Container for encrypted data with all metadata needed for decryption.
    Stored as: nonce (12 bytes) || ciphertext || tag (16 bytes, appended by GCM)
    """
    nonce: bytes
    ciphertext: bytes
    
    def to_bytes(self) -> bytes:
        """Serialize for storage: nonce || ciphertext"""
        return self.nonce + self.ciphertext
    
    @classmethod
    def from_bytes(cls, data: bytes) -> 'EncryptedBlob':
        """Deserialize from storage format"""
        if len(data) < 12:
            raise ValueError("Encrypted data too short - missing nonce")
        return cls(nonce=data[:12], ciphertext=data[12:])


class CryptoEngine:
    """
    Central cryptographic operations handler.
    
    Uses AES-256-GCM for all encryption, which provides:
    - Confidentiality (AES-256)
    - Integrity (GCM authentication tag)
    - No padding oracle vulnerabilities
    
    Key derivation uses PBKDF2 with 600,000 iterations (OWASP 2023 recommendation).
    """
    
    # 12 bytes is the recommended nonce size for GCM
    NONCE_SIZE = 12
    
    # AES-256 requires 32-byte keys
    KEY_SIZE = 32
    
    # PBKDF2 iterations - high for offline attack resistance
    KDF_ITERATIONS = 600_000
    
    # Salt size for key derivation
    SALT_SIZE = 16
    
    def __init__(self, storage_dir: Path):
        """
        Initialize crypto engine with a storage directory for keys.
        
        Args:
            storage_dir: Directory where encrypted keys and salts are stored
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self._master_key: Optional[bytes] = None
        self._key_file = self.storage_dir / '.keystore'
        self._salt_file = self.storage_dir / '.salt'
    
    def initialize_keys(self, password: Optional[str] = None) -> bool:
        """
        Initialize or load the master encryption key.
        
        If no key exists, generates a new random key.
        If password is provided, derives key from password.
        Otherwise, uses platform-specific key protection.
        
        Returns:
            True if keys initialized successfully
        """
        if self._master_key is not None:
            return True  # Already initialized
        
        if password:
            # User provided a password - derive key from it
            self._master_key = self._derive_key_from_password(password)
            return True
        
        if self._key_file.exists():
            # Load existing protected key
            self._master_key = self._load_protected_key()
            return self._master_key is not None
        
        # First run - generate new random key and protect it
        self._master_key = secrets.token_bytes(self.KEY_SIZE)
        self._save_protected_key(self._master_key)
        return True
    
    def _derive_key_from_password(self, password: str) -> bytes:
        """
        Derive an encryption key from a user password using PBKDF2.
        
        Uses a stored salt (or generates one) to ensure consistent
        key derivation across sessions.
        """
        # Get or create salt
        if self._salt_file.exists():
            salt = self._salt_file.read_bytes()
        else:
            salt = secrets.token_bytes(self.SALT_SIZE)
            self._salt_file.write_bytes(salt)
            self._secure_file_permissions(self._salt_file)
        
        # Derive key using PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=self.KEY_SIZE,
            salt=salt,
            iterations=self.KDF_ITERATIONS,
        )
        return kdf.derive(password.encode('utf-8'))
    
    def _save_protected_key(self, key: bytes) -> None:
        """
        Save the master key using platform-specific protection.
        
        Windows: Encrypt with DPAPI (user-scope)
        Linux: Write with restricted permissions (0600)
        """
        if IS_WINDOWS:
            protected = self._dpapi_encrypt(key)
            self._key_file.write_bytes(protected)
        else:
            # Linux: base64 encode and lock permissions
            encoded = base64.b64encode(key)
            self._key_file.write_bytes(encoded)
            self._secure_file_permissions(self._key_file)
    
    def _load_protected_key(self) -> Optional[bytes]:
        """
        Load and decrypt the master key from storage.
        
        Returns:
            The decrypted master key, or None if loading failed
        """
        try:
            data = self._key_file.read_bytes()
            
            if IS_WINDOWS:
                return self._dpapi_decrypt(data)
            else:
                # Linux: base64 decode
                return base64.b64decode(data)
                
        except Exception as e:
            # Key loading failed - could be corruption or permission issue
            print(f"Warning: Failed to load encryption key: {e}")
            return None
    
    def _dpapi_encrypt(self, data: bytes) -> bytes:
        """
        Encrypt data using Windows DPAPI.
        
        DPAPI ties encryption to the current Windows user account,
        so the data can only be decrypted by the same user on the same machine.
        """
        if not IS_WINDOWS:
            raise RuntimeError("DPAPI is only available on Windows")
        
        import ctypes
        from ctypes import wintypes
        
        # DPAPI structures
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
        
        # Call CryptProtectData
        # Flags: CRYPTPROTECT_UI_FORBIDDEN (0x01) - no UI prompts
        success = crypt32.CryptProtectData(
            ctypes.byref(input_blob),
            None,  # description
            None,  # optional entropy
            None,  # reserved
            None,  # prompt struct
            0x01,  # flags
            ctypes.byref(output_blob)
        )
        
        if not success:
            raise RuntimeError(f"DPAPI encryption failed: {ctypes.GetLastError()}")
        
        # Copy output and free memory
        encrypted = ctypes.string_at(output_blob.pbData, output_blob.cbData)
        kernel32.LocalFree(output_blob.pbData)
        
        return encrypted
    
    def _dpapi_decrypt(self, data: bytes) -> bytes:
        """
        Decrypt data using Windows DPAPI.
        """
        if not IS_WINDOWS:
            raise RuntimeError("DPAPI is only available on Windows")
        
        import ctypes
        from ctypes import wintypes
        
        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ('cbData', wintypes.DWORD),
                ('pbData', ctypes.POINTER(ctypes.c_char))
            ]
        
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        
        input_blob = DATA_BLOB()
        input_blob.cbData = len(data)
        input_blob.pbData = ctypes.cast(
            ctypes.create_string_buffer(data, len(data)),
            ctypes.POINTER(ctypes.c_char)
        )
        
        output_blob = DATA_BLOB()
        
        # Call CryptUnprotectData
        success = crypt32.CryptUnprotectData(
            ctypes.byref(input_blob),
            None,
            None,
            None,
            None,
            0x01,
            ctypes.byref(output_blob)
        )
        
        if not success:
            raise RuntimeError(f"DPAPI decryption failed: {ctypes.GetLastError()}")
        
        decrypted = ctypes.string_at(output_blob.pbData, output_blob.cbData)
        kernel32.LocalFree(output_blob.pbData)
        
        return decrypted
    
    def _secure_file_permissions(self, path: Path) -> None:
        """
        Set secure file permissions (Linux only).
        Sets file to owner read/write only (0600).
        """
        if not IS_WINDOWS:
            import stat
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    
    def encrypt(self, plaintext: bytes) -> EncryptedBlob:
        """
        Encrypt data using AES-256-GCM.
        
        Each encryption uses a fresh random nonce, ensuring that
        encrypting the same data twice produces different ciphertext.
        
        Args:
            plaintext: Data to encrypt
            
        Returns:
            EncryptedBlob containing nonce and ciphertext
        """
        if self._master_key is None:
            raise RuntimeError("Crypto engine not initialized - call initialize_keys() first")
        
        # Generate fresh nonce for this encryption
        nonce = secrets.token_bytes(self.NONCE_SIZE)
        
        # Encrypt using GCM (includes authentication tag)
        aesgcm = AESGCM(self._master_key)
        ciphertext = aesgcm.encrypt(nonce, plaintext, associated_data=None)
        
        return EncryptedBlob(nonce=nonce, ciphertext=ciphertext)
    
    def decrypt(self, blob: EncryptedBlob) -> bytes:
        """
        Decrypt data using AES-256-GCM.
        
        Verifies the authentication tag to ensure data hasn't been tampered with.
        
        Args:
            blob: EncryptedBlob containing nonce and ciphertext
            
        Returns:
            Decrypted plaintext
            
        Raises:
            cryptography.exceptions.InvalidTag: If authentication fails
        """
        if self._master_key is None:
            raise RuntimeError("Crypto engine not initialized - call initialize_keys() first")
        
        aesgcm = AESGCM(self._master_key)
        return aesgcm.decrypt(blob.nonce, blob.ciphertext, associated_data=None)
    
    def encrypt_file(self, source_path: Path, dest_path: Path) -> bool:
        """
        Encrypt a file and write to destination.
        
        Reads the entire file into memory, encrypts it, and writes
        the encrypted blob to the destination. For very large files,
        a streaming approach would be needed, but for typical user
        files this is sufficient and simpler.
        
        Args:
            source_path: Path to file to encrypt
            dest_path: Path to write encrypted file
            
        Returns:
            True if encryption succeeded
        """
        try:
            plaintext = source_path.read_bytes()
            encrypted = self.encrypt(plaintext)
            dest_path.write_bytes(encrypted.to_bytes())
            return True
        except Exception as e:
            print(f"Encryption failed for {source_path}: {e}")
            return False
    
    def decrypt_file(self, source_path: Path, dest_path: Path) -> bool:
        """
        Decrypt a file and write to destination.
        
        Args:
            source_path: Path to encrypted file
            dest_path: Path to write decrypted file
            
        Returns:
            True if decryption succeeded
        """
        try:
            encrypted_data = source_path.read_bytes()
            blob = EncryptedBlob.from_bytes(encrypted_data)
            plaintext = self.decrypt(blob)
            dest_path.write_bytes(plaintext)
            return True
        except Exception as e:
            print(f"Decryption failed for {source_path}: {e}")
            return False
    
    def generate_hmac(self, data: bytes) -> bytes:
        """
        Generate HMAC-SHA256 for data integrity verification.
        
        Used for signing audit log entries to detect tampering.
        
        Args:
            data: Data to sign
            
        Returns:
            32-byte HMAC signature
        """
        if self._master_key is None:
            raise RuntimeError("Crypto engine not initialized")
        
        import hmac
        return hmac.new(self._master_key, data, hashlib.sha256).digest()
    
    def verify_hmac(self, data: bytes, signature: bytes) -> bool:
        """
        Verify HMAC signature for data.
        
        Uses constant-time comparison to prevent timing attacks.
        
        Args:
            data: Original data
            signature: HMAC to verify
            
        Returns:
            True if signature is valid
        """
        import hmac
        expected = self.generate_hmac(data)
        return hmac.compare_digest(expected, signature)
    
    def is_initialized(self) -> bool:
        """Check if the crypto engine has been initialized with keys."""
        return self._master_key is not None
    
    def change_password(self, old_password: str, new_password: str) -> bool:
        """
        Change the encryption password.
        
        Re-derives the key with the new password and updates stored salt.
        Note: This doesn't re-encrypt existing backups - they remain
        encrypted with the original key until manually re-protected.
        
        Returns:
            True if password change succeeded
        """
        try:
            # Verify old password by checking key derivation matches
            old_key = self._derive_key_from_password(old_password)
            if self._master_key and old_key != self._master_key:
                return False  # Old password incorrect
            
            # Generate new salt and derive new key
            new_salt = secrets.token_bytes(self.SALT_SIZE)
            self._salt_file.write_bytes(new_salt)
            self._secure_file_permissions(self._salt_file)
            
            # Derive and store new key
            self._master_key = self._derive_key_from_password(new_password)
            self._save_protected_key(self._master_key)
            
            return True
        except Exception as e:
            print(f"Password change failed: {e}")
            return False
