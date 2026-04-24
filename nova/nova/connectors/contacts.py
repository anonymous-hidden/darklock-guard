"""Contacts connector — JSON flat-file address book."""
from __future__ import annotations
import json
import os
from pathlib import Path
from .base import BaseConnector, ConnectorAction


class ContactsConnector(BaseConnector):
    name = "contacts"
    description = "Query and update a local JSON contacts file."
    risk = "low"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.path = Path(os.environ.get(self.cfg.get("file_env", ""), "")
                         or "~/.nova/contacts.json").expanduser()

    def is_configured(self) -> bool:
        return True  # auto-creates

    def _load(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save(self, data: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _register_actions(self) -> None:
        self.register(ConnectorAction("list", "List contacts", "read",
                                      handler=self._list))
        self.register(ConnectorAction("find", "Find contacts matching query", "read",
                                      handler=self._find))
        self.register(ConnectorAction("add", "Add a contact", "write",
                                      requires_approval=True, handler=self._add))

    def _list(self) -> dict:
        return {"ok": True, "contacts": self._load(), "path": str(self.path)}

    def _find(self, *, query: str) -> dict:
        q = query.lower()
        hits = [c for c in self._load()
                if q in json.dumps(c, ensure_ascii=False).lower()]
        return {"ok": True, "contacts": hits}

    def _add(self, *, name: str, email: str = "", phone: str = "",
             notes: str = "") -> dict:
        data = self._load()
        entry = {"name": name, "email": email, "phone": phone, "notes": notes}
        data.append(entry)
        self._save(data)
        return {"ok": True, "contact": entry, "total": len(data)}
