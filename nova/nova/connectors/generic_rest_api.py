"""Generic REST API connector — request wrapper for ad-hoc integrations."""
from __future__ import annotations
import os
import httpx
from .base import BaseConnector, ConnectorAction


class GenericRestConnector(BaseConnector):
    name = "generic_rest_api"
    description = "Call arbitrary JSON REST endpoints (bearer optional)."
    risk = "medium"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.base = os.environ.get(self.cfg.get("base_url_env", ""), "")
        self.bearer = os.environ.get(self.cfg.get("bearer_env", ""), "")

    def is_configured(self) -> bool:
        return True  # can be used without base; writes still gated by approval

    def _headers(self, extra: dict | None = None) -> dict:
        h = {"Accept": "application/json"}
        if self.bearer:
            h["Authorization"] = f"Bearer {self.bearer}"
        if extra:
            h.update(extra)
        return h

    def _url(self, path_or_url: str) -> str:
        if path_or_url.startswith(("http://", "https://")):
            return path_or_url
        if not self.base:
            raise ValueError("base URL not configured and no absolute URL given")
        return self.base.rstrip("/") + "/" + path_or_url.lstrip("/")

    def _register_actions(self) -> None:
        self.register(ConnectorAction("get", "HTTP GET", "read", handler=self._get))
        self.register(ConnectorAction("post", "HTTP POST", "write",
                                      requires_approval=True, handler=self._post))
        self.register(ConnectorAction("put", "HTTP PUT", "write",
                                      requires_approval=True, handler=self._put))
        self.register(ConnectorAction("delete", "HTTP DELETE", "write",
                                      requires_approval=True, handler=self._delete))

    def _req(self, method: str, url: str, **kwargs) -> dict:
        try:
            r = httpx.request(method, self._url(url), headers=self._headers(kwargs.pop("headers", None)),
                              timeout=kwargs.pop("timeout", 20), **kwargs)
            body: object
            try:
                body = r.json()
            except Exception:
                body = r.text[:2000]
            return {"ok": r.status_code < 400, "status": r.status_code, "body": body}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _get(self, *, url: str, params: dict | None = None) -> dict:
        return self._req("GET", url, params=params or {})

    def _post(self, *, url: str, json: dict | None = None) -> dict:
        return self._req("POST", url, json=json or {})

    def _put(self, *, url: str, json: dict | None = None) -> dict:
        return self._req("PUT", url, json=json or {})

    def _delete(self, *, url: str) -> dict:
        return self._req("DELETE", url)
