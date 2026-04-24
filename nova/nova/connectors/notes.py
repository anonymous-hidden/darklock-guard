"""Notes connector — flat-file notes provider (markdown folder)."""
from __future__ import annotations
import os
from pathlib import Path
from .base import BaseConnector, ConnectorAction


class NotesConnector(BaseConnector):
    name = "notes"
    description = "Read/append notes in a local notes folder."
    risk = "low"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.root = Path(os.environ.get(self.cfg.get("path_env", ""), "")
                         or "~/notes").expanduser()

    def is_configured(self) -> bool:
        return self.root.exists() or True    # auto-creates on write

    def _register_actions(self) -> None:
        self.register(ConnectorAction("list", "List notes", "read",
                                      handler=self._list))
        self.register(ConnectorAction("read", "Read a note", "read",
                                      handler=self._read))
        self.register(ConnectorAction("search", "Search notes (text contains)", "read",
                                      handler=self._search))
        self.register(ConnectorAction("append", "Append to a note", "write",
                                      requires_approval=True, handler=self._append))

    def _list(self, *, limit: int = 50) -> dict:
        if not self.root.exists():
            return {"ok": True, "notes": []}
        out = []
        for p in sorted(self.root.rglob("*.md"))[:limit]:
            out.append({"path": str(p), "bytes": p.stat().st_size})
        return {"ok": True, "notes": out, "root": str(self.root)}

    def _read(self, *, path: str) -> dict:
        p = Path(path).expanduser()
        try:
            p.relative_to(self.root.resolve())
        except Exception:
            return {"ok": False, "error": "outside notes root"}
        if not p.is_file():
            return {"ok": False, "error": "not found"}
        return {"ok": True, "path": str(p), "content": p.read_text(encoding="utf-8")}

    def _search(self, *, query: str, limit: int = 50) -> dict:
        hits = []
        if not self.root.exists():
            return {"ok": True, "hits": hits}
        for p in self.root.rglob("*.md"):
            try:
                t = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if query.lower() in t.lower():
                hits.append({"path": str(p)})
                if len(hits) >= limit:
                    break
        return {"ok": True, "hits": hits}

    def _append(self, *, name: str, content: str) -> dict:
        self.root.mkdir(parents=True, exist_ok=True)
        p = self.root / (name if name.endswith(".md") else name + ".md")
        with open(p, "a", encoding="utf-8") as f:
            f.write(("\n\n" if p.exists() and p.stat().st_size else "") + content)
        return {"ok": True, "path": str(p), "appended": len(content)}
