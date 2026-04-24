"""Structured JSONL + rich console logger."""
from __future__ import annotations
import json
import threading
import time
from pathlib import Path
from typing import Any

try:
    from rich.console import Console
    _console = Console()
except Exception:
    _console = None


class JsonlLogger:
    def __init__(self, path: str | Path, level: str = "info", pretty_console: bool = True):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.level = level
        self.pretty = pretty_console and _console is not None
        self._lock = threading.Lock()

    def _write(self, record: dict) -> None:
        record.setdefault("ts", time.time())
        line = json.dumps(record, default=str)
        with self._lock, open(self.path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        if self.pretty:
            color = {"error": "red", "warn": "yellow", "info": "cyan", "debug": "dim"}.get(
                record.get("level", "info"), "white"
            )
            _console.print(f"[{color}][{record.get('level','info').upper()}][/] "
                           f"{record.get('event','')} "
                           f"[dim]{json.dumps({k: v for k, v in record.items() if k not in ('ts','level','event')}, default=str)[:400]}[/]")

    def log(self, level: str, event: str, **fields: Any) -> None:
        self._write({"level": level, "event": event, **fields})

    def info(self, event: str, **f: Any) -> None: self.log("info", event, **f)
    def warn(self, event: str, **f: Any) -> None: self.log("warn", event, **f)
    def error(self, event: str, **f: Any) -> None: self.log("error", event, **f)
    def debug(self, event: str, **f: Any) -> None: self.log("debug", event, **f)
