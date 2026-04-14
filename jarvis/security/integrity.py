"""
Nova — File Integrity Checker
=======================================
Hashes critical source files and periodically checks for unauthorized changes.
"""

import hashlib
import json
import threading
import time
from pathlib import Path

from logs.audit import AuditLogger

# Files whose integrity matters
_CRITICAL_FILES = [
    # Nova core
    "main.py", "config.py", "config.yaml",
    "core/ai_engine.py", "core/personality.py", "core/prompt_builder.py",
    "gateway/validator.py", "executor/sandbox.py",
    "security/process_watcher.py", "security/integrity.py",
    "logs/audit.py", "api/server.py", "api/routes.py",
]

# Darklock files — monitored as a separate group (relative to base_dir's parent)
_DARKLOCK_FILES = [
    "darklock/server.js",
    "darklock/start.js",
    "darklock/middleware/csrf.js",
    "darklock/middleware/rfid.js",
    "darklock/utils/security.js",
    "darklock/utils/rbac-middleware.js",
    "darklock/routes/auth.js",
    "darklock/routes/admin.js",
]


class IntegrityChecker:
    def __init__(self, base_dir: Path, audit: AuditLogger):
        self._base_dir = base_dir
        self._audit = audit
        self._hashes: dict[str, str] = {}
        self._hash_file = base_dir / "data" / "integrity.json"
        self._thread: threading.Thread | None = None
        self._running = False
        # Darklock files are relative to the workspace root (parent of jarvis/)
        self._workspace_dir = base_dir.parent
        self._darklock_callbacks: list = []
        self._load()

    def _load(self):
        if self._hash_file.exists():
            try:
                self._hashes = json.loads(self._hash_file.read_text())
            except json.JSONDecodeError:
                self._hashes = {}

    def _save(self):
        self._hash_file.parent.mkdir(parents=True, exist_ok=True)
        self._hash_file.write_text(json.dumps(self._hashes, indent=2))

    @staticmethod
    def _sha256(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def add_darklock_callback(self, fn):
        """Register a callback(changes: list[dict]) called on Darklock violations."""
        self._darklock_callbacks.append(fn)

    def baseline(self):
        """Create initial hashes for all critical files (Nova + Darklock)."""
        for rel in _CRITICAL_FILES:
            full = self._base_dir / rel
            if full.exists():
                self._hashes[rel] = self._sha256(full)
        # Baseline Darklock files from the workspace root
        for rel in _DARKLOCK_FILES:
            full = self._workspace_dir / rel
            if full.exists():
                self._hashes[f"darklock::{rel}"] = self._sha256(full)
        self._save()
        self._audit.log("security", "integrity_baseline", {"files": len(self._hashes)})

    def check(self) -> list[dict]:
        """Check all critical files.  Returns list of changed/missing files."""
        changes: list[dict] = []
        darklock_changes: list[dict] = []

        # ── Nova core files ──
        for rel in _CRITICAL_FILES:
            full = self._base_dir / rel
            if not full.exists():
                if rel in self._hashes:
                    changes.append({"file": rel, "status": "missing", "group": "nova"})
                continue
            current = self._sha256(full)
            stored = self._hashes.get(rel)
            if stored is None:
                self._hashes[rel] = current
                changes.append({"file": rel, "status": "new", "group": "nova"})
            elif current != stored:
                changes.append({"file": rel, "status": "modified", "group": "nova"})
                self._audit.log("security", "integrity_violation", {"file": rel, "group": "nova"})

        # ── Darklock files ──
        for rel in _DARKLOCK_FILES:
            full = self._workspace_dir / rel
            key = f"darklock::{rel}"
            if not full.exists():
                if key in self._hashes:
                    c = {"file": rel, "status": "missing", "group": "darklock"}
                    changes.append(c)
                    darklock_changes.append(c)
                continue
            current = self._sha256(full)
            stored = self._hashes.get(key)
            if stored is None:
                self._hashes[key] = current
                c = {"file": rel, "status": "new", "group": "darklock"}
                changes.append(c)
                darklock_changes.append(c)
            elif current != stored:
                c = {"file": rel, "status": "modified", "group": "darklock"}
                changes.append(c)
                darklock_changes.append(c)
                self._audit.log("security", "integrity_violation", {"file": rel, "group": "darklock"})

        if changes:
            self._save()

        # Fire Darklock-specific callbacks
        if darklock_changes:
            for fn in self._darklock_callbacks:
                try:
                    fn(darklock_changes)
                except Exception:
                    pass

        return changes

    def rescan(self) -> list[dict]:
        """Force an immediate integrity check outside the scheduled interval."""
        return self.check()

    def start(self, interval: float = 60.0):
        if not self._hashes:
            self.baseline()
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True,
        )
        self._thread.start()

    def stop(self):
        self._running = False

    def _loop(self, interval: float):
        while self._running:
            changes = self.check()
            if changes:
                self._audit.log("security", "integrity_changes", {"changes": changes})
            time.sleep(interval)

    def get_status(self) -> dict:
        nova_files = [k for k in self._hashes if not k.startswith("darklock::")]
        darklock_files = [k.replace("darklock::", "") for k in self._hashes if k.startswith("darklock::")]
        return {
            "running": self._running,
            "monitored_files": len(self._hashes),
            "nova_files": nova_files,
            "darklock_files": darklock_files,
            "files": list(self._hashes.keys()),
        }
