"""Memory and logging tools — unified shared brain."""
from __future__ import annotations

from typing import Any

from ..memory.store import MemoryStore
from .registry import Tool


def build_memory_tools(store: MemoryStore) -> list[Tool]:

    # ── Shared brain: key/value facts ─────────────────────────────────────────

    def remember_fact(key: str, value: str, category: str = "general",
                      importance: int = 5) -> dict[str, Any]:
        """Write a key/value fact to the shared brain (all Nova surfaces will see it)."""
        nid = store.remember(key=key, value=value, category=category, importance=importance)
        return {"ok": True, "id": nid, "key": key}

    def recall_facts(query: str | None = None, key: str | None = None,
                     limit: int = 20) -> dict[str, Any]:
        """Read facts from the shared brain — searches all Nova surfaces' memories."""
        facts = store.recall(query=query or "", key=key or "", limit=limit)
        return {"ok": True, "facts": facts}

    # ── Local long-form notes ─────────────────────────────────────────────────

    def append_memory_note(value: str, key: str | None = None,
                           tags: list[str] | None = None) -> dict[str, Any]:
        nid = store.add(value=value, key=key, tags=tags or [])
        return {"ok": True, "id": nid}

    def retrieve_memory_notes(query: str | None = None, key: str | None = None,
                               limit: int = 10) -> dict[str, Any]:
        if key:
            notes = store.by_key(key)
        elif query:
            notes = store.search(query, limit=limit)
        else:
            notes = store.recent(limit=limit)
        return {"ok": True, "notes": notes}

    return [
        Tool(
            name="remember_fact",
            description=(
                "Store a key/value fact in the SHARED Nova brain "
                "(desktop chat, Jarvis, and nova-agents all see it). "
                "Use for preferences, personal details, and project facts."
            ),
            input_schema={"key": "str", "value": "str",
                          "category": "str?", "importance": "int?"},
            permission="write",
            func=remember_fact,
        ),
        Tool(
            name="recall_facts",
            description=(
                "Retrieve facts from the shared Nova brain. "
                "Searches across everything stored by the desktop chat, Jarvis, and nova-agents."
            ),
            input_schema={"query": "str?", "key": "str?", "limit": "int?"},
            permission="read",
            func=recall_facts,
        ),
        Tool(
            name="append_memory_note",
            description="Persist a long-form note with optional key and tags.",
            input_schema={"value": "str", "key": "str?", "tags": "list[str]?"},
            permission="write",
            func=append_memory_note,
        ),
        Tool(
            name="retrieve_memory_notes",
            description="Recall long-form notes by query (substring), key, or recency.",
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
