"""Structured JSONL logger with optional rich console output."""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path
from typing import Any

try:
    from rich.console import Console
    _console: Console | None = Console(stderr=True)
except Exception:  # pragma: no cover
    _console = None


class JsonlLogger:
    def __init__(self, path: Path, level: str = "INFO", console: bool = True) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.level = level.upper()
        self.console = console
        self._lock = threading.Lock()
        self._fh = self.path.open("a", encoding="utf-8", buffering=1)

    def close(self) -> None:
        try:
            self._fh.close()
        except Exception:
            pass

    def log(self, event: str, level: str = "INFO", **fields: Any) -> None:
        record = {
            "ts": time.time(),
            "level": level.upper(),
            "event": event,
            **fields,
        }
        line = json.dumps(record, default=str, ensure_ascii=False)
        with self._lock:
            self._fh.write(line + "\n")
        if self.console:
            self._pretty(record)

    def _pretty(self, record: dict[str, Any]) -> None:
        level = record["level"]
        event = record["event"]
        extras = {k: v for k, v in record.items() if k not in ("ts", "level", "event")}
        msg = f"[{level}] {event} {extras}" if extras else f"[{level}] {event}"
        if _console is not None:
            color = {"ERROR": "red", "WARN": "yellow", "INFO": "cyan", "DEBUG": "dim"}.get(level, "white")
            _console.print(f"[{color}]{msg}[/{color}]")
        else:  # pragma: no cover
            print(msg, file=sys.stderr)

    # Convenience
    def info(self, event: str, **f: Any) -> None: self.log(event, "INFO", **f)
    def warn(self, event: str, **f: Any) -> None: self.log(event, "WARN", **f)
    def error(self, event: str, **f: Any) -> None: self.log(event, "ERROR", **f)
    def debug(self, event: str, **f: Any) -> None:
        if self.level == "DEBUG":
            self.log(event, "DEBUG", **f)
