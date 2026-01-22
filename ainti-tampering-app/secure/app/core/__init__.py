# FileGuard Core - Security Engine
# All security logic lives here, isolated from UI concerns

from .crypto import CryptoEngine
from .hasher import IntegrityHasher
from .baseline import BaselineManager
from .policy import ProtectionPolicy, ProtectionMode
from .watcher import FileWatcher
from .restore import RestoreEngine
from .audit_log import AuditLog

__all__ = [
    'CryptoEngine',
    'IntegrityHasher', 
    'BaselineManager',
    'ProtectionPolicy',
    'ProtectionMode',
    'FileWatcher',
    'RestoreEngine',
    'AuditLog',
]
