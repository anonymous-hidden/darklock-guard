"""Read-only bridge tool into the ai-terminal.py memory database.

This lets nova-agents specialists recall facts you stored via /remember in
ai-terminal.py (~/.ai-terminal/memory.db) without duplicating or migrating
the data. It is intentionally read-only — writes go through the native
append_memory_note tool in nova-agents/data/memory.sqlite.
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
    def recall_ai_terminal(query: str = "", key: str = "", limit: int = 10) -> dict[str, Any]:
        if not os.path.exists(db_path):
            return {"ok": False, "error": f"ai-terminal memory not found at {db_path}"}
        # The schema uses a `memory` table with key/value/category columns.
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
                   ORDER BY created_at DESC LIMIT ?""",
                (like, like, like, int(limit)),
            )
        else:
            rows = _query(
                db_path,
                "SELECT key, value, category, created_at FROM memory ORDER BY created_at DESC LIMIT ?",
                (int(limit),),
            )
        return {"ok": True, "source": db_path, "notes": rows}

    return Tool(
        name="recall_ai_terminal_memory",
        description="Read-only lookup into the ai-terminal.py memory DB (~/.ai-terminal/memory.db).",
        input_schema={"query": "str?", "key": "str?", "limit": "int?"},
        permission="read",
        func=recall_ai_terminal,
    )
