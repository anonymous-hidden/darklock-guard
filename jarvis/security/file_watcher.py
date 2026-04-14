"""
Nova — File Watcher
============================
Monitors project directories for file changes in real time.
Uses polling (cross-platform) — checks every N seconds for modifications.

Security:
- NEVER watches restricted files (.env, keys, secrets, etc.)
- Read-only — only observes, never modifies
- Restricted path list is the same as the project indexer
- All alerts are logged to the audit trail
"""

import hashlib
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from config import JarvisConfig
from logs.audit import AuditLogger


@dataclass
class FileEvent:
    """A detected file system event."""
    event_type: str          # "created", "modified", "deleted"
    path: str                # relative path
    abs_path: str            # absolute path
    timestamp: str
    size: int = 0
    details: str = ""


@dataclass
class WatchState:
    """Stores file hashes + sizes for change detection."""
    files: dict = field(default_factory=dict)  # path → {"hash": str, "size": int, "mtime": float}


# Files/dirs that should NEVER be watched — security boundary
_RESTRICTED_PATTERNS = {
    ".env", ".env.local", ".env.production", ".env.development",
    "secrets", "private_key", "id_rsa", "id_ed25519",
    ".ssh", ".gnupg", ".password-store",
    "node_modules", "__pycache__", ".venv", "venv", ".git",
    "dist", "build", ".next", ".nuxt", "target",
    "jarvis.db", "jarvis.db-wal", "jarvis.db-shm",
    "audit.jsonl", "integrity.json",
}


class FileWatcher:
    """Polls directories for file changes and fires event callbacks."""

    def __init__(self, config: JarvisConfig, audit: AuditLogger):
        self._config = config
        self._audit = audit
        self._watch_dirs: list[str] = []
        self._state = WatchState()
        self._thread: threading.Thread | None = None
        self._running = False
        self._callbacks: list[Callable[[FileEvent], None]] = []
        self._recent_events: list[dict] = []  # Last N events for API access
        self._max_recent = 200

    def add_callback(self, fn: Callable[[FileEvent], None]):
        """Register a callback for file events."""
        self._callbacks.append(fn)

    def watch(self, directory: str):
        """Add a directory to the watch list."""
        resolved = os.path.realpath(os.path.expanduser(directory))
        if os.path.isdir(resolved) and resolved not in self._watch_dirs:
            self._watch_dirs.append(resolved)
            self._audit.log("watcher", "directory_added", {"path": resolved})

    def start(self, interval: float = 5.0):
        """Start the background watching thread."""
        if self._running:
            return
        self._running = True
        # Do initial scan to establish baseline
        self._baseline_scan()
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True,
        )
        self._thread.start()
        self._audit.log("watcher", "started", {
            "dirs": self._watch_dirs, "interval": interval,
        })

    def stop(self):
        self._running = False

    def get_recent_events(self, count: int = 50) -> list[dict]:
        """Return recent file events for the API."""
        return self._recent_events[-count:]

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "watching_dirs": self._watch_dirs,
            "tracked_files": len(self._state.files),
            "recent_events": len(self._recent_events),
        }

    # ── Internal ───────────────────────────────────────

    def _is_restricted(self, path: str) -> bool:
        parts = Path(path).parts
        name = Path(path).name.lower()
        for p in _RESTRICTED_PATTERNS:
            if p in parts or name == p or name.startswith(p):
                return True
        return False

    def _baseline_scan(self):
        """Scan all watched dirs to build the initial state (no events fired)."""
        for wdir in self._watch_dirs:
            for root, dirs, files in os.walk(wdir):
                dirs[:] = [d for d in dirs if not self._is_restricted(os.path.join(root, d))]
                for fname in files:
                    full = os.path.join(root, fname)
                    if self._is_restricted(full):
                        continue
                    try:
                        stat = os.stat(full)
                        self._state.files[full] = {
                            "size": stat.st_size,
                            "mtime": stat.st_mtime,
                        }
                    except OSError:
                        continue

    def _loop(self, interval: float):
        while self._running:
            try:
                self._poll()
            except Exception as e:
                self._audit.log("watcher", "error", {"error": str(e)})
            time.sleep(interval)

    def _poll(self):
        """Compare current filesystem state to stored state."""
        current_files: dict[str, dict] = {}

        for wdir in self._watch_dirs:
            if not os.path.isdir(wdir):
                continue
            for root, dirs, files in os.walk(wdir):
                dirs[:] = [d for d in dirs if not self._is_restricted(os.path.join(root, d))]
                for fname in files:
                    full = os.path.join(root, fname)
                    if self._is_restricted(full):
                        continue
                    try:
                        stat = os.stat(full)
                        current_files[full] = {
                            "size": stat.st_size,
                            "mtime": stat.st_mtime,
                        }
                    except OSError:
                        continue

        now = datetime.now().isoformat()

        # Detect new files
        for path, info in current_files.items():
            if path not in self._state.files:
                self._fire(FileEvent(
                    event_type="created",
                    path=self._rel(path),
                    abs_path=path,
                    timestamp=now,
                    size=info["size"],
                ))

        # Detect modified files
        for path, info in current_files.items():
            old = self._state.files.get(path)
            if old and old["mtime"] != info["mtime"]:
                self._fire(FileEvent(
                    event_type="modified",
                    path=self._rel(path),
                    abs_path=path,
                    timestamp=now,
                    size=info["size"],
                ))

        # Detect deleted files
        for path in self._state.files:
            if path not in current_files:
                self._fire(FileEvent(
                    event_type="deleted",
                    path=self._rel(path),
                    abs_path=path,
                    timestamp=now,
                ))

        self._state.files = current_files

    def _fire(self, event: FileEvent):
        """Fire an event to all callbacks and log it."""
        self._audit.log("watcher", f"file_{event.event_type}", {
            "path": event.path,
            "size": event.size,
        })
        evt_dict = {
            "type": event.event_type,
            "path": event.path,
            "timestamp": event.timestamp,
            "size": event.size,
        }
        self._recent_events.append(evt_dict)
        if len(self._recent_events) > self._max_recent:
            self._recent_events = self._recent_events[-self._max_recent:]

        for cb in self._callbacks:
            try:
                cb(event)
            except Exception:
                pass

    def _rel(self, path: str) -> str:
        """Make path relative to the first watch dir for readability."""
        for wdir in self._watch_dirs:
            if path.startswith(wdir):
                return os.path.relpath(path, wdir)
        return path
