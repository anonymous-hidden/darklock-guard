"""Server monitor connector — pings a list of HTTP endpoints."""
from __future__ import annotations
import os
import time
import httpx
from .base import BaseConnector, ConnectorAction


class ServerMonitorConnector(BaseConnector):
    name = "server_monitor"
    description = "Check HTTP endpoints for availability and latency."
    risk = "low"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        raw = os.environ.get(self.cfg.get("endpoints_env", ""), "") or ""
        self.endpoints = [u.strip() for u in raw.split(",") if u.strip()]

    def is_configured(self) -> bool:
        return True

    def _register_actions(self) -> None:
        self.register(ConnectorAction("ping", "Ping one endpoint", "read",
                                      handler=self._ping))
        self.register(ConnectorAction("check_all", "Ping all configured endpoints",
                                      "read", handler=self._check_all))

    def _ping(self, *, url: str) -> dict:
        t = time.time()
        try:
            r = httpx.get(url, timeout=8, follow_redirects=True)
            return {"ok": r.status_code < 500, "url": url,
                    "status": r.status_code,
                    "latency_ms": int((time.time() - t) * 1000)}
        except Exception as e:
            return {"ok": False, "url": url, "error": str(e),
                    "latency_ms": int((time.time() - t) * 1000)}

    def _check_all(self) -> dict:
        return {"ok": True, "results": [self._ping(url=u) for u in self.endpoints]}
