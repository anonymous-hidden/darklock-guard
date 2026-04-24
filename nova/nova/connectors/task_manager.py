"""Task manager connector — scaffold for a REST-style tasks API."""
from __future__ import annotations
import os
import httpx
from .base import BaseConnector, ConnectorAction


class TaskManagerConnector(BaseConnector):
    name = "task_manager"
    description = "CRUD tasks against a REST task-manager service."
    risk = "medium"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.base = os.environ.get(self.cfg.get("url_env", ""), "").rstrip("/")

    def is_configured(self) -> bool:
        return bool(self.base)

    def _register_actions(self) -> None:
        self.register(ConnectorAction("list", "List tasks", "read", handler=self._list))
        self.register(ConnectorAction("create", "Create a task", "write",
                                      requires_approval=True, handler=self._create))
        self.register(ConnectorAction("complete", "Mark complete", "write",
                                      requires_approval=True, handler=self._complete))

    def _list(self) -> dict:
        try:
            r = httpx.get(f"{self.base}/tasks", timeout=10)
            return {"ok": r.status_code == 200, "tasks": r.json()
                    if r.status_code == 200 else []}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _create(self, *, title: str, notes: str = "", due: str = "") -> dict:
        try:
            r = httpx.post(f"{self.base}/tasks",
                           json={"title": title, "notes": notes, "due": due}, timeout=10)
            return {"ok": r.status_code < 400, "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _complete(self, *, id: str) -> dict:
        try:
            r = httpx.post(f"{self.base}/tasks/{id}/complete", timeout=10)
            return {"ok": r.status_code < 400, "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}
