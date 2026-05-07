"""Unified memory store — reads and writes to the canonical shared brain.

All Nova surfaces (desktop chat via ai-terminal-server, Jarvis, nova-agents)
share the same SQLite database at ~/.ai-terminal/memory.db so every fact
Cayden tells any one of them is instantly known by all the others.

The store keeps its own local notes table (for long-form notes that don't
belong in the key/value brain) but key/value facts always go to shared memory.
"""
from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path
from typing import Iterable

# ── Canonical shared brain ────────────────────────────────────────────────────
_SHARED_DB = os.path.expanduser("~/.ai-terminal/memory.db")

_SHARED_SCHEMA = """
CREATE TABLE IF NOT EXISTS memory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL UNIQUE,
    value      TEXT    NOT NULL,
    category   TEXT    NOT NULL DEFAULT 'general',
    importance INTEGER NOT NULL DEFAULT 5,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key);
CREATE INDEX IF NOT EXISTS idx_memory_cat ON memory(category);
"""

# ── Local notes table schema (long-form notes, not key/value facts) ──────────
_LOCAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL    NOT NULL,
    key        TEXT,
    value      TEXT    NOT NULL,
    tags       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_notes_key  ON notes(key);
CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes(tags);
"""


class MemoryStore:
    """Unified memory store.

    Key-value facts are stored in and read from ~/.ai-terminal/memory.db
    (the shared brain). Long-form notes go to a local notes table in the
    same database so everything is co-located.
    """

    def __init__(self, path: Path) -> None:
        # path is kept for backwards compatibility but we always use the
        # shared brain as the primary database.
        self.path = Path(_SHARED_DB)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path))
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SHARED_SCHEMA)
        self._conn.executescript(_LOCAL_SCHEMA)

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass

    # ── Key/value facts (shared brain) ───────────────────────────────────────

    def remember(self, key: str, value: str, category: str = "general",
                 importance: int = 5) -> int:
        """Store a key-value fact in the shared brain. Upserts on key."""
        cur = self._conn.execute(
            """INSERT INTO memory (key, value, category, importance, created_at, updated_at)
               VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
               ON CONFLICT(key) DO UPDATE SET
                 value      = excluded.value,
                 category   = excluded.category,
                 importance = excluded.importance,
                 updated_at = excluded.updated_at""",
            (key, value, category, importance),
        )
        self._conn.commit()
        return int(cur.lastrowid or 0)

    def recall(self, query: str = "", key: str = "", limit: int = 20) -> list[dict]:
        """Retrieve facts from the shared brain."""
        if key:
            rows = self._conn.execute(
                "SELECT key, value, category, importance FROM memory WHERE key = ? LIMIT ?",
                (key, limit),
            ).fetchall()
        elif query:
            like = f"%{query.lower()}%"
            rows = self._conn.execute(
                """SELECT key, value, category, importance FROM memory
                   WHERE LOWER(key) LIKE ? OR LOWER(value) LIKE ?
                   ORDER BY importance DESC, updated_at DESC LIMIT ?""",
                (like, like, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT key, value, category, importance FROM memory "
                "ORDER BY importance DESC, updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def recent_facts(self, limit: int = 20) -> list[dict]:
        rows = self._conn.execute(
            "SELECT key, value, category FROM memory ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Long-form notes (local) ───────────────────────────────────────────────

    def add(self, value: str, key: str | None = None, tags: Iterable[str] | None = None) -> int:
        tags_s = ",".join(sorted({t.strip() for t in (tags or []) if t.strip()}))
        cur = self._conn.execute(
            "INSERT INTO notes(created_at, key, value, tags) VALUES (?, ?, ?, ?)",
            (time.time(), key, value, tags_s),
        )
        self._conn.commit()
        return int(cur.lastrowid or 0)

    def search(self, query: str, limit: int = 10) -> list[dict]:
        q = f"%{query.strip().lower()}%"
        rows = self._conn.execute(
            """SELECT id, created_at, key, value, tags FROM notes
               WHERE LOWER(value) LIKE ?
                  OR LOWER(COALESCE(key,'')) LIKE ?
                  OR LOWER(tags) LIKE ?
               ORDER BY created_at DESC LIMIT ?""",
            (q, q, q, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def recent(self, limit: int = 10) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id, created_at, key, value, tags FROM notes ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def by_key(self, key: str) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id, created_at, key, value, tags FROM notes WHERE key = ? ORDER BY created_at DESC",
            (key,),
        ).fetchall()
        return [dict(r) for r in rows]
