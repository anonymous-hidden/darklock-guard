"""Minimal Ollama HTTP client with JSON-mode support."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterable

import httpx


@dataclass
class OllamaClient:
    host: str = "http://localhost:11434"
    timeout: float = 180.0

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        options: dict[str, Any] | None = None,
        json_mode: bool = False,
        stream: bool = False,
    ) -> str:
        """Call /api/chat. Returns the full assistant message string.

        When json_mode is True, passes `format: "json"` which asks Ollama
        to constrain output to valid JSON.
        """
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": bool(stream),
            "options": options or {},
        }
        if json_mode:
            payload["format"] = "json"

        url = f"{self.host.rstrip('/')}/api/chat"

        if not stream:
            with httpx.Client(timeout=self.timeout) as client:
                r = client.post(url, json=payload)
                r.raise_for_status()
                data = r.json()
                return (data.get("message") or {}).get("content", "") or ""

        # Streaming path: concatenate content chunks.
        chunks: list[str] = []
        with httpx.Client(timeout=self.timeout) as client:
            with client.stream("POST", url, json=payload) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    piece = (obj.get("message") or {}).get("content", "")
                    if piece:
                        chunks.append(piece)
        return "".join(chunks)

    def list_models(self) -> list[str]:
        try:
            with httpx.Client(timeout=10.0) as client:
                r = client.get(f"{self.host.rstrip('/')}/api/tags")
                r.raise_for_status()
                return [m["name"] for m in r.json().get("models", [])]
        except Exception:
            return []

    def health(self) -> bool:
        try:
            with httpx.Client(timeout=5.0) as client:
                r = client.get(self.host)
                return r.status_code == 200
        except Exception:
            return False
