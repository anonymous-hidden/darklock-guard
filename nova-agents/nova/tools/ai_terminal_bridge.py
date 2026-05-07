"""Shared brain bridge — read/write access to ~/.ai-terminal/memory.db.

Since nova-agents/nova/memory/store.py now points directly at the shared
database, this module is kept for backward compatibility but the bridge
tool is no longer needed in isolation. All reads/writes happen through
MemoryStore. This file is retained so existing imports don't break.
"""
from __future__ import annotations

import os
import sqlite3
from typing import Any

from .registry import Tool


AI_TERMINAL_DB = os.path.expanduser("~/.ai-terminal/memory.db")


def _query(db_path: str, sql: str, params: tuple = ()) -> list[dict]:
    if not os.path.exists(db_path):
        return []
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(sql, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def build_ai_terminal_memory_tool(db_path: str = AI_TERMINAL_DB) -> Tool:
    """Returns a Tool for reading/writing the shared Nova brain.

    Now supports both read (recall) and write (remember) so all three Nova
    surfaces can contribute to and benefit from the same memory.
    """

    def recall_ai_terminal(query: str = "", key: str = "", limit: int = 10) -> dict[str, Any]:
        if not os.path.exists(db_path):
            return {"ok": False, "error": f"Shared Nova brain not found at {db_path}"}
        if key:
            rows = _query(
                db_path,
                "SELECT key, value, category, created_at FROM memory WHERE key = ? LIMIT ?",
                (key, int(limit)),
            )
        elif query:
            like = f"%{query.lower()}%"
            rows = _query(
                db_path,
                """SELECT key, value, category, created_at FROM memory
                   WHERE LOWER(key) LIKE ? OR LOWER(value) LIKE ? OR LOWER(category) LIKE ?
                   ORDER BY importance DESC, created_at DESC LIMIT ?""",
                (like, like, like, int(limit)),
            )
        else:
            rows = _query(
                db_path,
                "SELECT key, value, category, created_at FROM memory "
                "ORDER BY importance DESC, created_at DESC LIMIT ?",
                (int(limit),),
            )
        return {"ok": True, "source": db_path, "notes": rows}

    def write_ai_terminal(key: str, value: str, category: str = "general",
                          importance: int = 5) -> dict[str, Any]:
        """Write a key/value fact to the shared Nova brain."""
        try:
            os.makedirs(os.path.dirname(db_path), exist_ok=True)
            con = sqlite3.connect(db_path)
            con.execute("PRAGMA journal_mode=WAL")
            con.execute(
                """INSERT INTO memory (key, value, category, importance, created_at, updated_at)
                   VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                   ON CONFLICT(key) DO UPDATE SET
                     value      = excluded.value,
                     category   = excluded.category,
                     importance = excluded.importance,
                     updated_at = excluded.updated_at""",
                (key, value, category, importance),
            )
            con.commit()
            con.close()
            return {"ok": True, "key": key}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # Return a composite tool-like object that carries both functions.
    # Callers that only want one can call the function directly.
    return Tool(
        name="recall_ai_terminal_memory",
        description=(
            "Read from the shared Nova brain (~/.ai-terminal/memory.db). "
            "Searches everything stored by desktop chat, Jarvis, and nova-agents."
        ),
        input_schema={"query": "str?", "key": "str?", "limit": "int?"},
        permission="read",
        func=recall_ai_terminal,
    )


def build_ai_terminal_write_tool(db_path: str = AI_TERMINAL_DB) -> Tool:
    """Returns a Tool for writing to the shared Nova brain."""

    def write_ai_terminal(key: str, value: str, category: str = "general",
                          importance: int = 5) -> dict[str, Any]:
        try:
            os.makedirs(os.path.dirname(db_path), exist_ok=True)
            con = sqlite3.connect(db_path)
            con.execute("PRAGMA journal_mode=WAL")
            con.execute(
                """INSERT INTO memory (key, value, category, importance, created_at, updated_at)
                   VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
                   ON CONFLICT(key) DO UPDATE SET
                     value      = excluded.value,
                     category   = excluded.category,
                     importance = excluded.importance,
                     updated_at = excluded.updated_at""",
                (key, value, category, importance),
            )
            con.commit()
            con.close()
            return {"ok": True, "key": key}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    return Tool(
        name="write_ai_terminal_memory",
        description=(
            "Write a key/value fact to the shared Nova brain. "
            "All Nova surfaces (desktop chat, Jarvis, nova-agents) will see it immediately."
        ),
        input_schema={"key": "str", "value": "str",
                      "category": "str?", "importance": "int?"},
        permission="write",
        func=write_ai_terminal,
    )

