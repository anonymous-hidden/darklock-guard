"""File-system tools with sandboxed path resolution."""
from __future__ import annotations
import fnmatch
import os
from pathlib import Path
from typing import Optional


class FsPolicy:
    def __init__(self, allowed_roots: list[str], denied_patterns: list[str]):
        self.allowed_roots = [Path(p).expanduser().resolve() for p in (allowed_roots or [".", "~"])]
        self.denied = denied_patterns or []

    def resolve(self, path: str) -> Path:
        p = Path(path).expanduser().resolve()
        for pat in self.denied:
            if fnmatch.fnmatch(str(p), pat):
                raise PermissionError(f"denied by pattern: {pat}")
        for root in self.allowed_roots:
            try:
                p.relative_to(root)
                return p
            except ValueError:
                continue
        raise PermissionError(f"path outside allowed roots: {p}")


def read_file(policy: FsPolicy, *, path: str, max_bytes: int = 200_000) -> dict:
    p = policy.resolve(path)
    if not p.is_file():
        return {"ok": False, "error": "not a file", "path": str(p)}
    data = p.read_bytes()[:max_bytes]
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
    return {"ok": True, "path": str(p), "size": p.stat().st_size, "content": text}


def write_file(policy: FsPolicy, *, path: str, content: str, overwrite: bool = False) -> dict:
    p = policy.resolve(path)
    if p.exists() and not overwrite:
        return {"ok": False, "error": "file exists (overwrite=False)", "path": str(p)}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {"ok": True, "path": str(p), "bytes": len(content)}


def list_dir(policy: FsPolicy, *, path: str, max_entries: int = 500) -> dict:
    p = policy.resolve(path)
    if not p.is_dir():
        return {"ok": False, "error": "not a dir", "path": str(p)}
    entries = []
    for i, entry in enumerate(sorted(p.iterdir())):
        if i >= max_entries:
            break
        entries.append({"name": entry.name, "is_dir": entry.is_dir(),
                        "size": entry.stat().st_size if entry.is_file() else None})
    return {"ok": True, "path": str(p), "entries": entries}


def search_files(policy: FsPolicy, *, path: str, query: str,
                 glob: str = "**/*", max_hits: int = 200) -> dict:
    p = policy.resolve(path)
    hits: list[dict] = []
    for f in p.glob(glob):
        if not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if query in line:
                hits.append({"path": str(f), "line": lineno, "text": line.strip()[:400]})
                if len(hits) >= max_hits:
                    return {"ok": True, "hits": hits, "truncated": True}
    return {"ok": True, "hits": hits, "truncated": False}


def inspect_repo(policy: FsPolicy, *, path: str) -> dict:
    p = policy.resolve(path)
    info = {"path": str(p), "is_git": (p / ".git").is_dir(),
            "has_readme": any((p / n).exists() for n in ("README.md", "README", "readme.md")),
            "manifests": []}
    for m in ("package.json", "requirements.txt", "pyproject.toml", "Cargo.toml", "go.mod"):
        if (p / m).exists():
            info["manifests"].append(m)
    return {"ok": True, **info}
