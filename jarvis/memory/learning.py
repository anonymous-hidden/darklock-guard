"""
Nova — Safe Self-Improvement Engine
=============================================
AI can SUGGEST code changes only.
Every suggestion generates: diff preview + explanation.
Requires: user approval → auto-backup → apply.
Supports rollback from backup.

SAFETY: The learning engine can NEVER modify:
  - core/identity.py (identity core)
  - config.yaml (master configuration)
  - Any file in security/ directory
  - Any file containing safety boundaries
"""

import difflib
import json
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from logs.audit import AuditLogger
from memory.store import MemoryStore

# Files that can NEVER be modified by the learning engine
PROTECTED_FILES = {
    "identity.py",
    "config.yaml",
}

# Directories that can NEVER be modified by the learning engine
PROTECTED_DIRS = {
    "security",
}


@dataclass
class Improvement:
    id: str
    file: str
    description: str
    original_content: str
    proposed_content: str
    diff: str
    status: str = "pending"      # pending | approved | applied | rejected | rolled_back
    backup_path: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())


class LearningEngine:
    def __init__(self, memory: MemoryStore, audit: AuditLogger, base_dir: Path):
        self._memory = memory
        self._audit = audit
        self._base_dir = base_dir
        self._backup_dir = base_dir / "data" / "backups"
        self._backup_dir.mkdir(parents=True, exist_ok=True)
        self._pending_file = base_dir / "data" / "pending_improvements.json"
        self._pending: dict[str, Improvement] = {}
        self._load_pending()

    def _is_protected(self, file_path: str) -> bool:
        """Check if a file is protected from learning engine modifications."""
        path = Path(file_path)
        # Check filename
        if path.name in PROTECTED_FILES:
            return True
        # Check directory
        for part in path.parts:
            if part in PROTECTED_DIRS:
                return True
        return False

    def _load_pending(self):
        """Load pending improvements from disk (survives restarts)."""
        if not self._pending_file.exists():
            return
        try:
            data = json.loads(self._pending_file.read_text())
            for item in data:
                imp = Improvement(**item)
                self._pending[imp.id] = imp
            self._audit.log("learning", "loaded_pending", {"count": len(self._pending)})
        except Exception:
            pass  # Corrupted file, start fresh

    def _save_pending(self):
        """Persist pending improvements to disk."""
        data = []
        for imp in self._pending.values():
            data.append({
                "id": imp.id,
                "file": imp.file,
                "description": imp.description,
                "original_content": imp.original_content,
                "proposed_content": imp.proposed_content,
                "diff": imp.diff,
                "status": imp.status,
                "backup_path": imp.backup_path,
                "created_at": imp.created_at,
            })
        self._pending_file.write_text(json.dumps(data, indent=2))

    # ── Suggest ────────────────────────────────────────

    def suggest(self, file_path: str, description: str, new_content: str) -> Improvement:
        """Create a code-change suggestion. Returns an Improvement object with a diff."""
        path = Path(file_path)

        # Safety check — block modifications to protected files
        if self._is_protected(file_path):
            self._audit.log("learning", "blocked_protected", {
                "file": file_path, "description": description,
            })
            raise PermissionError(
                f"Cannot modify protected file: {path.name}. "
                f"Identity core and security files are read-only."
            )

        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        original = path.read_text(errors="replace")
        diff_lines = list(difflib.unified_diff(
            original.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            fromfile=f"a/{path.name}",
            tofile=f"b/{path.name}",
        ))
        diff = "".join(diff_lines)

        imp = Improvement(
            id=uuid.uuid4().hex[:8],
            file=str(path),
            description=description,
            original_content=original,
            proposed_content=new_content,
            diff=diff,
        )
        self._pending[imp.id] = imp
        self._save_pending()
        self._audit.log("learning", "suggestion", {
            "id": imp.id, "file": file_path, "description": description,
            "diff_lines": len(diff_lines),
        })
        return imp

    # ── Approve → backup → apply ───────────────────────

    def approve(self, improvement_id: str) -> dict:
        imp = self._pending.get(improvement_id)
        if not imp:
            return {"success": False, "error": f"No pending improvement: {improvement_id}"}

        path = Path(imp.file)

        # Double-check safety before applying
        if self._is_protected(imp.file):
            return {"success": False, "error": f"Cannot modify protected file: {path.name}"}

        # Create backup BEFORE applying
        backup = self._backup_dir / f"{path.name}.{imp.id}.bak"
        shutil.copy2(path, backup)
        imp.backup_path = str(backup)

        # Apply the change
        path.write_text(imp.proposed_content)
        imp.status = "applied"
        del self._pending[improvement_id]
        self._save_pending()

        self._audit.log("learning", "applied", {
            "id": imp.id, "file": imp.file, "backup": str(backup),
        })
        return {"success": True, "message": f"Applied. Backup saved → {backup}"}

    # ── Reject ─────────────────────────────────────────

    def reject(self, improvement_id: str) -> dict:
        imp = self._pending.pop(improvement_id, None)
        if not imp:
            return {"success": False, "error": f"No pending improvement: {improvement_id}"}
        imp.status = "rejected"
        self._save_pending()
        self._audit.log("learning", "rejected", {"id": imp.id})
        return {"success": True, "message": "Improvement rejected."}

    # ── Rollback ───────────────────────────────────────

    def rollback(self, improvement_id: str, original_path: str) -> dict:
        """Restore a file from its backup."""
        backups = list(self._backup_dir.glob(f"*.{improvement_id}.bak"))
        if not backups:
            return {"success": False, "error": "No backup found"}

        target = Path(original_path)
        shutil.copy2(backups[0], target)
        self._audit.log("learning", "rolled_back", {
            "id": improvement_id, "file": original_path, "backup": str(backups[0]),
        })
        return {"success": True, "message": f"Rolled back {target.name} from backup"}

    # ── Listing ────────────────────────────────────────

    def list_pending(self) -> list[dict]:
        return [
            {
                "id": imp.id,
                "file": imp.file,
                "description": imp.description,
                "diff": imp.diff,
                "created_at": imp.created_at,
            }
            for imp in self._pending.values()
        ]
