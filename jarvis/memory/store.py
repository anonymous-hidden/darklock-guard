"""
Nova — Memory Store
============================
SQLite-backed persistent memory: preferences, tasks, conversations, knowledge.
"""

import sqlite3
import threading
from datetime import datetime
from pathlib import Path


def _now() -> str:
    return datetime.now().isoformat()


class MemoryStore:
    """Thread-safe SQLite memory store."""

    def __init__(self, db_path: Path, audit=None):
        self._db_path = db_path
        self._audit = audit
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(str(self._db_path))
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
        return self._local.conn

    def _init_db(self):
        self._conn().executescript("""
            CREATE TABLE IF NOT EXISTS preferences (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                description TEXT DEFAULT '',
                status      TEXT DEFAULT 'todo',
                priority    TEXT DEFAULT 'medium',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT DEFAULT 'New Conversation',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS knowledge (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                category   TEXT NOT NULL,
                key        TEXT NOT NULL,
                value      TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(category, key)
            );
        """)
        self._conn().commit()

    # ── Preferences ────────────────────────────────────

    def set_preference(self, key: str, value: str):
        c = self._conn()
        c.execute("INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)",
                  (key, value, _now()))
        c.commit()

    def get_preference(self, key: str) -> str | None:
        row = self._conn().execute("SELECT value FROM preferences WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def get_preferences(self) -> dict[str, str]:
        rows = self._conn().execute("SELECT key, value FROM preferences").fetchall()
        return {r["key"]: r["value"] for r in rows}

    # ── Tasks ──────────────────────────────────────────

    def add_task(self, title: str, description: str = "", priority: str = "medium") -> int:
        c = self._conn()
        cur = c.execute(
            "INSERT INTO tasks (title, description, priority, status, created_at, updated_at) "
            "VALUES (?, ?, ?, 'todo', ?, ?)", (title, description, priority, _now(), _now()))
        c.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def update_task(self, task_id: int, status: str) -> bool:
        c = self._conn()
        cur = c.execute("UPDATE tasks SET status=?, updated_at=? WHERE id=?",
                        (status, _now(), task_id))
        c.commit()
        return cur.rowcount > 0

    def get_tasks(self, status: str | None = None) -> list[dict]:
        if status:
            rows = self._conn().execute(
                "SELECT * FROM tasks WHERE status=? ORDER BY created_at DESC", (status,)).fetchall()
        else:
            rows = self._conn().execute("SELECT * FROM tasks ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    def get_active_tasks(self) -> list[dict]:
        return self.get_tasks("todo") + self.get_tasks("in_progress")

    # ── Conversations ──────────────────────────────────

    def create_conversation(self, title: str = "New Conversation") -> int:
        c = self._conn()
        cur = c.execute("INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)",
                        (title, _now(), _now()))
        c.commit()
        return cur.lastrowid  # type: ignore[return-value]

    def add_message(self, conversation_id: int, role: str, content: str):
        c = self._conn()
        c.execute("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                  (conversation_id, role, content, _now()))
        c.execute("UPDATE conversations SET updated_at=? WHERE id=?", (_now(), conversation_id))
        c.commit()

    def get_messages(self, conversation_id: int) -> list[dict]:
        rows = self._conn().execute(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",
            (conversation_id,)).fetchall()
        return [dict(r) for r in rows]

    def list_conversations(self) -> list[dict]:
        rows = self._conn().execute(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def delete_conversation(self, conversation_id: int):
        c = self._conn()
        c.execute("DELETE FROM messages WHERE conversation_id=?", (conversation_id,))
        c.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
        c.commit()

    def rename_conversation(self, conversation_id: int, title: str):
        c = self._conn()
        c.execute("UPDATE conversations SET title=?, updated_at=? WHERE id=?",
                  (title, _now(), conversation_id))
        c.commit()

    # ── Knowledge ──────────────────────────────────────

    def store_knowledge(self, category: str, key: str, value: str):
        c = self._conn()
        c.execute("INSERT OR REPLACE INTO knowledge (category, key, value, created_at) VALUES (?, ?, ?, ?)",
                  (category, key, value, _now()))
        c.commit()

    def get_knowledge(self, category: str, key: str) -> str | None:
        row = self._conn().execute(
            "SELECT value FROM knowledge WHERE category=? AND key=?", (category, key)).fetchone()
        return row["value"] if row else None

    def search_knowledge(self, query: str) -> list[dict]:
        rows = self._conn().execute(
            "SELECT * FROM knowledge WHERE key LIKE ? OR value LIKE ? LIMIT 20",
            (f"%{query}%", f"%{query}%")).fetchall()
        return [dict(r) for r in rows]

    def checkpoint(self):
        """Flush WAL to main database file. Call before shutdown."""
        try:
            self._conn().execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass

    def close(self):
        """Checkpoint WAL and close the connection cleanly."""
        try:
            self.checkpoint()
            conn = getattr(self._local, "conn", None)
            if conn:
                conn.close()
                self._local.conn = None
        except Exception:
            pass
