"""SQLite-backed memory store with notes, tags, and FTS-style LIKE search."""
from __future__ import annotations
import json
import sqlite3
import time
from pathlib import Path
from typing import Optional


class MemoryStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init()

    def _init(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at REAL NOT NULL,
              key TEXT NOT NULL,
              value TEXT NOT NULL,
              tags TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_notes_key ON notes(key);
            CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);
            CREATE TABLE IF NOT EXISTS task_summaries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_id TEXT NOT NULL,
              created_at REAL NOT NULL,
              mode TEXT NOT NULL,
              preset TEXT,
              summary TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    # ---- notes ----
    def add(self, key: str, value: str, tags: Optional[list[str]] = None) -> int:
        cur = self._conn.execute(
            "INSERT INTO notes(created_at, key, value, tags) VALUES (?, ?, ?, ?)",
            (time.time(), key, value, json.dumps(tags or [])),
        )
        self._conn.commit()
        return int(cur.lastrowid or 0)

    def by_key(self, key: str, limit: int = 20) -> list[dict]:
        cur = self._conn.execute(
            "SELECT * FROM notes WHERE key = ? ORDER BY created_at DESC LIMIT ?",
            (key, limit),
        )
        return [self._row(r) for r in cur.fetchall()]

    def search(self, query: str, limit: int = 20) -> list[dict]:
        q = f"%{query}%"
        cur = self._conn.execute(
            "SELECT * FROM notes WHERE key LIKE ? OR value LIKE ? OR tags LIKE ? "
            "ORDER BY created_at DESC LIMIT ?",
            (q, q, q, limit),
        )
        return [self._row(r) for r in cur.fetchall()]

    def recent(self, limit: int = 20) -> list[dict]:
        cur = self._conn.execute(
            "SELECT * FROM notes ORDER BY created_at DESC LIMIT ?", (limit,)
        )
        return [self._row(r) for r in cur.fetchall()]

    # ---- task summaries ----
    def save_task(self, task_id: str, mode: str, summary: str, preset: str = "") -> None:
        self._conn.execute(
            "INSERT INTO task_summaries(task_id, created_at, mode, preset, summary) "
            "VALUES (?, ?, ?, ?, ?)",
            (task_id, time.time(), mode, preset, summary),
        )
        self._conn.commit()

    @staticmethod
    def _row(r: sqlite3.Row) -> dict:
        d = dict(r)
        try:
            d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception:
            d["tags"] = []
        return d

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
