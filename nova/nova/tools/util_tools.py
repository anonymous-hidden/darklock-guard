"""Utility tools: parse_json, validate_output, run_local_analysis."""
from __future__ import annotations
import ast
import json
from typing import Any


def parse_json(*, text: str) -> dict:
    try:
        return {"ok": True, "value": json.loads(text)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def validate_output(*, text: str, expected_keys: list[str] | None = None) -> dict:
    try:
        obj = json.loads(text)
    except Exception as e:
        return {"ok": False, "error": f"json: {e}"}
    missing = [k for k in (expected_keys or []) if k not in obj]
    return {"ok": not missing, "missing": missing, "value": obj}


def run_local_analysis(*, path: str) -> dict:
    """Light read-only python syntax check (Normal-Mode-safe)."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            src = f.read()
        ast.parse(src)
        return {"ok": True, "path": path, "lines": src.count("\n") + 1, "syntax": "ok"}
    except SyntaxError as e:
        return {"ok": False, "path": path, "syntax": "error", "error": str(e),
                "line": e.lineno, "col": e.offset}
    except Exception as e:
        return {"ok": False, "error": str(e)}
