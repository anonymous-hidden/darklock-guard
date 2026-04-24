"""Memory and logging tools."""
from __future__ import annotations

from typing import Any

from ..memory.store import MemoryStore
from .registry import Tool


def build_memory_tools(store: MemoryStore) -> list[Tool]:
    def append_memory_note(value: str, key: str | None = None, tags: list[str] | None = None) -> dict[str, Any]:
        nid = store.add(value=value, key=key, tags=tags or [])
        return {"ok": True, "id": nid}

    def retrieve_memory_notes(query: str | None = None, key: str | None = None, limit: int = 10) -> dict[str, Any]:
        if key:
            notes = store.by_key(key)
        elif query:
            notes = store.search(query, limit=limit)
        else:
            notes = store.recent(limit=limit)
        return {"ok": True, "notes": notes}

    return [
        Tool(
            name="append_memory_note",
            description="Persist a note to local memory with optional key and tags.",
            input_schema={"value": "str", "key": "str?", "tags": "list[str]?"},
            permission="write",
            func=append_memory_note,
        ),
        Tool(
            name="retrieve_memory_notes",
            description="Recall notes by query (substring), key, or recency.",
            input_schema={"query": "str?", "key": "str?", "limit": "int?"},
            permission="read",
            func=retrieve_memory_notes,
        ),
    ]


def build_log_tool(logger) -> Tool:
    def log_event(event: str, level: str = "INFO", **fields: Any) -> dict[str, Any]:
        logger.log(event, level=level, **fields)
        return {"ok": True}

    return Tool(
        name="log_event",
        description="Emit a structured log entry for observability.",
        input_schema={"event": "str", "level": "str?", "...": "any"},
        permission="read",
        func=log_event,
    )
