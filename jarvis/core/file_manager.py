"""
Nova — Controlled File Manager
================================
Safe file operations with:
  • Auto-backup before any modification
  • Unified diff generation for every change
  • All operations logged to the audit trail
  • Path restriction enforcement (via Guardian)

SECURITY: Only operates within allowed directories.  System-critical and
security-sensitive paths are always blocked.
"""

import os
import shutil
import time
import difflib
import hashlib
from pathlib import Path


class FileManager:
    """Controlled file create / read / modify with full logging."""

    BACKUP_DIR_NAME = ".nova-backups"

    # Always blocked regardless of config
    BLOCKED_PATTERNS = {
        "/etc/", "/usr/", "/bin/", "/sbin/", "/boot/", "/proc/", "/sys/",
        "/dev/", ".ssh/", ".gnupg/", "__pycache__/", ".git/objects/",
    }

    def __init__(self, config, audit, activity_tracker, guardian):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker
        self._guardian = guardian

        allowed = config.get("security.allowed_dirs") or ["~"]
        self._allowed_dirs = [
            os.path.expanduser(d) for d in allowed
        ]

    # ── Path validation ────────────────────────────

    def _validate_path(self, path: str) -> tuple[bool, str]:
        """Check if a path is allowed.  Returns (ok, reason)."""
        real = os.path.realpath(os.path.expanduser(path))

        # Block dangerous system paths
        for blocked in self.BLOCKED_PATTERNS:
            if blocked in real:
                return False, f"Blocked path pattern: {blocked}"

        # Must be under an allowed directory
        for allowed in self._allowed_dirs:
            allowed_real = os.path.realpath(allowed)
            if real.startswith(allowed_real):
                return True, ""

        return False, f"Path not under allowed directories: {self._allowed_dirs}"

    # ── Backup ─────────────────────────────────────

    def _backup(self, filepath: str) -> str | None:
        """Create a timestamped backup before modifying a file."""
        p = Path(filepath)
        if not p.exists():
            return None

        backup_dir = p.parent / self.BACKUP_DIR_NAME
        backup_dir.mkdir(exist_ok=True)

        ts = time.strftime("%Y%m%d_%H%M%S")
        backup_name = f"{p.name}.{ts}.bak"
        backup_path = backup_dir / backup_name

        shutil.copy2(str(p), str(backup_path))
        self._audit.log("file_manager", "backup_created", {
            "original": str(p), "backup": str(backup_path)})
        return str(backup_path)

    # ── Hash ───────────────────────────────────────

    @staticmethod
    def _hash_file(filepath: str) -> str:
        h = hashlib.sha256()
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()

    # ── Operations ─────────────────────────────────

    def read_file(self, filepath: str) -> dict:
        """Read a file's contents (text only, max 1MB)."""
        ok, reason = self._validate_path(filepath)
        if not ok:
            self._audit.log("file_manager", "read_blocked", {
                "path": filepath, "reason": reason})
            return {"ok": False, "error": reason}

        real = os.path.realpath(os.path.expanduser(filepath))
        if not os.path.isfile(real):
            return {"ok": False, "error": "File not found"}

        size = os.path.getsize(real)
        if size > 1_048_576:
            return {"ok": False, "error": f"File too large ({size} bytes, max 1MB)"}

        try:
            with open(real, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

        self._audit.log("file_manager", "read", {"path": real, "size": size})
        self._activity.action(f"📄 Read file: {filepath}", details={"size": size})
        return {"ok": True, "path": real, "content": content, "size": size}

    def create_file(self, filepath: str, content: str) -> dict:
        """Create a new file. Fails if file already exists."""
        ok, reason = self._validate_path(filepath)
        if not ok:
            self._audit.log("file_manager", "create_blocked", {
                "path": filepath, "reason": reason})
            return {"ok": False, "error": reason}

        real = os.path.realpath(os.path.expanduser(filepath))
        if os.path.exists(real):
            return {"ok": False, "error": "File already exists — use modify instead"}

        try:
            os.makedirs(os.path.dirname(real), exist_ok=True)
            with open(real, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

        file_hash = self._hash_file(real)
        self._audit.log("file_manager", "created", {
            "path": real, "size": len(content), "hash": file_hash})
        self._activity.action(f"📝 Created file: {filepath}",
                              details={"size": len(content)})
        return {"ok": True, "path": real, "hash": file_hash}

    def modify_file(self, filepath: str, new_content: str) -> dict:
        """Modify a file: backup → diff → write → log."""
        ok, reason = self._validate_path(filepath)
        if not ok:
            self._audit.log("file_manager", "modify_blocked", {
                "path": filepath, "reason": reason})
            return {"ok": False, "error": reason}

        real = os.path.realpath(os.path.expanduser(filepath))
        if not os.path.isfile(real):
            return {"ok": False, "error": "File not found — use create instead"}

        # Read original
        try:
            with open(real, "r", encoding="utf-8", errors="replace") as f:
                original = f.read()
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

        # Backup
        backup_path = self._backup(real)

        # Generate diff
        diff = list(difflib.unified_diff(
            original.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            fromfile=f"a/{os.path.basename(real)}",
            tofile=f"b/{os.path.basename(real)}",
        ))
        diff_text = "".join(diff)

        # Write new content
        try:
            with open(real, "w", encoding="utf-8") as f:
                f.write(new_content)
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

        new_hash = self._hash_file(real)
        self._audit.log("file_manager", "modified", {
            "path": real,
            "backup": backup_path,
            "diff_lines": len(diff),
            "hash": new_hash,
        })
        self._activity.action(
            f"✏️ Modified file: {filepath}",
            details={"diff_lines": len(diff), "backup": backup_path})

        return {
            "ok": True,
            "path": real,
            "diff": diff_text,
            "backup": backup_path,
            "hash": new_hash,
        }

    def delete_file(self, filepath: str) -> dict:
        """Delete a file (backup is created first)."""
        ok, reason = self._validate_path(filepath)
        if not ok:
            return {"ok": False, "error": reason}

        real = os.path.realpath(os.path.expanduser(filepath))
        if not os.path.isfile(real):
            return {"ok": False, "error": "File not found"}

        backup_path = self._backup(real)
        try:
            os.remove(real)
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

        self._audit.log("file_manager", "deleted", {
            "path": real, "backup": backup_path})
        self._activity.action(f"🗑️ Deleted file: {filepath}",
                              details={"backup": backup_path})
        return {"ok": True, "path": real, "backup": backup_path}

    def list_dir(self, dirpath: str) -> dict:
        """List directory contents (non-recursive)."""
        ok, reason = self._validate_path(dirpath)
        if not ok:
            return {"ok": False, "error": reason}

        real = os.path.realpath(os.path.expanduser(dirpath))
        if not os.path.isdir(real):
            return {"ok": False, "error": "Not a directory"}

        entries = []
        try:
            for entry in sorted(os.listdir(real)):
                full = os.path.join(real, entry)
                entries.append({
                    "name": entry,
                    "is_dir": os.path.isdir(full),
                    "size": os.path.getsize(full) if os.path.isfile(full) else 0,
                })
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

        self._audit.log("file_manager", "list_dir", {"path": real, "count": len(entries)})
        return {"ok": True, "path": real, "entries": entries}
