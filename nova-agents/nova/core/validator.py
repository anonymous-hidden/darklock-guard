"""Output validation helpers for structured agent responses."""
from __future__ import annotations

import json
import re
from typing import TypeVar

from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)

_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def extract_json(raw: str) -> str:
    """Pull a JSON blob out of a model response, tolerating fences/prose."""
    raw = raw.strip()
    if not raw:
        return "{}"
    m = _JSON_FENCE.search(raw)
    if m:
        return m.group(1).strip()
    # Find the first { or [ and try to balance.
    start = None
    for i, ch in enumerate(raw):
        if ch in "{[":
            start = i
            break
    if start is None:
        return raw
    stack: list[str] = []
    pairs = {"}": "{", "]": "["}
    for i in range(start, len(raw)):
        ch = raw[i]
        if ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if stack and stack[-1] == pairs[ch]:
                stack.pop()
                if not stack:
                    return raw[start : i + 1]
    return raw[start:]


def parse_structured(raw: str, model: type[T]) -> tuple[T | None, str | None]:
    """Parse raw LLM output into a pydantic model. Returns (obj, error)."""
    try:
        blob = extract_json(raw)
        data = json.loads(blob)
        return model.model_validate(data), None
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        return None, f"{type(exc).__name__}: {exc}"
