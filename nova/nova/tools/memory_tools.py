"""Memory tool handlers."""
from __future__ import annotations
from typing import Optional


def append_memory_note(store, *, key: str, value: str, tags: Optional[list[str]] = None) -> dict:
    nid = store.add(key, value, tags or [])
    return {"ok": True, "id": nid, "key": key}


def retrieve_memory_notes(store, *, query: str = "", key: str = "", limit: int = 20) -> dict:
    if key:
        return {"ok": True, "notes": store.by_key(key, limit=limit)}
    if query:
        return {"ok": True, "notes": store.search(query, limit=limit)}
    return {"ok": True, "notes": store.recent(limit=limit)}


def log_event(logger, *, event: str, **fields) -> dict:
    logger.info(event, **fields)
    return {"ok": True, "event": event}
