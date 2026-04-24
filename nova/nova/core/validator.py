"""JSON validator — tolerates fences and prose; returns (obj, error)."""
from __future__ import annotations
import json
from typing import Any


def extract_json(text: str) -> str:
    if not text:
        return ""
    s = text.strip()
    if s.startswith("```"):
        # strip code fences
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip()
    # try to balance
    start = s.find("{")
    if start == -1:
        return s
    depth = 0
    end = -1
    in_str = False
    esc = False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        return s[start:]
    return s[start:end + 1]


def parse_structured(text: str, schema) -> tuple[Any | None, str]:
    raw = extract_json(text)
    if not raw:
        return None, "empty output"
    try:
        obj = json.loads(raw)
    except Exception as e:
        return None, f"json parse error: {e}"
    try:
        return schema.model_validate(obj), ""
    except Exception as e:
        # Fallback: if FinalAnswer is expected but "answer" key missing,
        # try to salvage any string value as the answer
        try:
            schema_name = getattr(schema, "__name__", "")
            if schema_name == "FinalAnswer" and isinstance(obj, dict) and "answer" not in obj:
                # Use the longest string value, or serialize the whole dict
                best = max(
                    (v for v in obj.values() if isinstance(v, str)),
                    key=len, default=None
                )
                answer = best if best else str(obj)
                return schema.model_validate({"answer": answer,
                                              "bullets": [], "followups": []}), ""
        except Exception:
            pass
        return None, f"schema error: {e}"
