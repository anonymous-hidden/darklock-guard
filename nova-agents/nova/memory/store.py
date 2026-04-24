"""SQLite-backed note store. Designed to swap in a vector backend later."""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Iterable


SCHEMA = """
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
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path))
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass

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
            """
            SELECT id, created_at, key, value, tags FROM notes
            WHERE LOWER(value) LIKE ?
               OR LOWER(COALESCE(key,'')) LIKE ?
               OR LOWER(tags) LIKE ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
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
