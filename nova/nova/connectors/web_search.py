"""Web search connector — DuckDuckGo HTML or SearxNG JSON."""
from __future__ import annotations
import httpx
from urllib.parse import quote_plus
from .base import BaseConnector, ConnectorAction, ConnectorResult


class WebSearchConnector(BaseConnector):
    name = "web_search"
    description = "Search the web (read-only)."
    risk = "low"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.provider = (self.cfg.get("provider") or "duckduckgo").lower()
        self.searxng_url = (self.cfg.get("searxng_url") or "").rstrip("/")

    def _register_actions(self) -> None:
        self.register(ConnectorAction("search", "Web search", "read",
                                      handler=self._search))
        self.register(ConnectorAction("fetch", "Fetch a URL as text", "read",
                                      handler=self._fetch))

    def is_configured(self) -> bool:
        if self.provider == "searxng":
            return bool(self.searxng_url)
        return True

    def _search(self, *, query: str, limit: int = 5) -> dict:
        try:
            if self.provider == "searxng" and self.searxng_url:
                r = httpx.get(f"{self.searxng_url}/search",
                              params={"q": query, "format": "json"}, timeout=15)
                r.raise_for_status()
                results = r.json().get("results", [])[:limit]
                return {"ok": True, "results": [
                    {"title": x.get("title"), "url": x.get("url"),
                     "snippet": x.get("content")} for x in results]}
            # DuckDuckGo HTML fallback
            r = httpx.get(f"https://duckduckgo.com/html/?q={quote_plus(query)}",
                          headers={"User-Agent": "Mozilla/5.0 NOVA/2.0"}, timeout=15)
            r.raise_for_status()
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(r.text, "html.parser")
                results = []
                for a in soup.select("a.result__a")[:limit]:
                    results.append({"title": a.get_text(strip=True),
                                    "url": a.get("href", ""), "snippet": ""})
                return {"ok": True, "results": results}
            except Exception as e:
                return {"ok": False, "error": f"parse: {e}"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _fetch(self, *, url: str, max_chars: int = 20000) -> dict:
        try:
            r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0 NOVA/2.0"},
                          timeout=15, follow_redirects=True)
            r.raise_for_status()
            text = r.text[:max_chars]
            try:
                from bs4 import BeautifulSoup
                text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)[:max_chars]
            except Exception:
                pass
            return {"ok": True, "url": url, "text": text, "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}
