"""Filesystem tools with sandboxed path resolution."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from .registry import Tool


class FsPolicy:
    def __init__(
        self,
        allowed_roots: list[str],
        denied_patterns: list[str],
        max_read: int,
        max_write: int,
        project_root: Path,
    ) -> None:
        self.project_root = project_root
        self.roots = [self._resolve(r) for r in allowed_roots]
        self.denied = [re.compile(p) for p in denied_patterns]
        self.max_read = max_read
        self.max_write = max_write

    def _resolve(self, p: str) -> Path:
        expanded = os.path.expanduser(p)
        pp = Path(expanded)
        if not pp.is_absolute():
            pp = (self.project_root / pp).resolve()
        else:
            pp = pp.resolve()
        return pp

    def check(self, path: str) -> Path:
        target = self._resolve(path)
        s = str(target)
        for pat in self.denied:
            if pat.search(s):
                raise PermissionError(f"Path blocked by denylist: {path}")
        if not any(
            str(target) == str(root) or str(target).startswith(str(root) + os.sep)
            for root in self.roots
        ):
            raise PermissionError(f"Path outside sandbox roots: {path}")
        return target


def build_fs_tools(policy: FsPolicy) -> list[Tool]:
    def read_file(path: str, max_bytes: int | None = None) -> dict[str, Any]:
        target = policy.check(path)
        if not target.exists() or not target.is_file():
            return {"ok": False, "error": f"not a file: {path}"}
        limit = min(max_bytes or policy.max_read, policy.max_read)
        data = target.read_bytes()[:limit]
        try:
            text = data.decode("utf-8")
            binary = False
        except UnicodeDecodeError:
            text = f"<{len(data)} bytes of binary data>"
            binary = True
        return {"ok": True, "path": str(target), "bytes": len(data), "binary": binary, "content": text}

    def write_file(path: str, content: str, create_parents: bool = True) -> dict[str, Any]:
        target = policy.check(path)
        if len(content.encode("utf-8")) > policy.max_write:
            return {"ok": False, "error": f"content exceeds max_write ({policy.max_write} bytes)"}
        if create_parents:
            target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": str(target), "bytes": len(content.encode("utf-8"))}

    def list_dir(path: str = ".") -> dict[str, Any]:
        target = policy.check(path)
        if not target.exists() or not target.is_dir():
            return {"ok": False, "error": f"not a directory: {path}"}
        entries = []
        for item in sorted(target.iterdir()):
            entries.append({"name": item.name, "type": "dir" if item.is_dir() else "file"})
        return {"ok": True, "path": str(target), "entries": entries}

    def search_files(pattern: str, path: str = ".", max_results: int = 100) -> dict[str, Any]:
        target = policy.check(path)
        if not target.exists():
            return {"ok": False, "error": f"no such path: {path}"}
        rx = re.compile(pattern)
        matches: list[dict[str, Any]] = []
        for root, _dirs, files in os.walk(target):
            for fname in files:
                full = Path(root) / fname
                try:
                    policy.check(str(full))
                except PermissionError:
                    continue
                try:
                    with full.open("r", encoding="utf-8", errors="ignore") as fh:
                        for i, line in enumerate(fh, 1):
                            if rx.search(line):
                                matches.append({"path": str(full), "line": i, "text": line.rstrip()[:400]})
                                if len(matches) >= max_results:
                                    return {"ok": True, "matches": matches, "truncated": True}
                except OSError:
                    continue
        return {"ok": True, "matches": matches, "truncated": False}

    return [
        Tool(
            name="read_file",
            description="Read a UTF-8 text file from within the sandbox.",
            input_schema={"path": "str", "max_bytes": "int?"},
            permission="read",
            func=read_file,
        ),
        Tool(
            name="write_file",
            description="Write or overwrite a text file in the sandbox.",
            input_schema={"path": "str", "content": "str", "create_parents": "bool?"},
            permission="write",
            func=write_file,
        ),
        Tool(
            name="list_dir",
            description="List entries of a directory inside the sandbox.",
            input_schema={"path": "str?"},
            permission="read",
            func=list_dir,
        ),
        Tool(
            name="search_files",
            description="Regex-search files under a path (first 400 chars per matching line).",
            input_schema={"pattern": "str", "path": "str?", "max_results": "int?"},
            permission="read",
            func=search_files,
        ),
    ]
