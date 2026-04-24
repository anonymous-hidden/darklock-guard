"""Ollama HTTP client — chat completions with JSON mode + health."""
from __future__ import annotations
import httpx
from typing import Any, Optional


class OllamaClient:
    def __init__(self, host: str = "http://localhost:11434", timeout: float = 180.0,
                 keep_alive: str = "10m"):
        self.host = host.rstrip("/")
        self.timeout = timeout
        self.keep_alive = keep_alive
        self._client = httpx.Client(timeout=timeout)

    def health(self) -> bool:
        try:
            r = self._client.get(self.host + "/api/tags")
            return r.status_code == 200
        except Exception:
            return False

    def list_models(self) -> list[str]:
        try:
            r = self._client.get(self.host + "/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
        except Exception:
            return []

    def chat(self, model: str, messages: list[dict], *,
             temperature: float = 0.2, json_mode: bool = False,
             options: Optional[dict[str, Any]] = None) -> str:
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "keep_alive": self.keep_alive,
            "options": {"temperature": temperature, **(options or {})},
        }
        if json_mode:
            payload["format"] = "json"
        r = self._client.post(self.host + "/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()
        return data.get("message", {}).get("content", "") or ""

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass
