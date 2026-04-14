"""
Nova — Configuration
======================
Loads config.yaml and provides typed property accessors.
"""

import os
from pathlib import Path
from typing import Any

import yaml


class JarvisConfig:
    def __init__(self, config_path: Path):
        self._path = config_path
        self._data: dict = {}
        self._load()

    def _load(self):
        if self._path.exists():
            with open(self._path, "r") as f:
                self._data = yaml.safe_load(f) or {}

    # ── Server ─────────────────────────────────────────
    @property
    def host(self) -> str:
        return self._data.get("server", {}).get("host", "127.0.0.1")

    @property
    def port(self) -> int:
        return self._data.get("server", {}).get("port", 8950)

    # ── AI ─────────────────────────────────────────────
    @property
    def ai_model(self) -> str:
        return self._data.get("ai", {}).get("model", "llama3.2:3b")

    @property
    def ollama_url(self) -> str:
        return self._data.get("ai", {}).get("ollama_url", "http://127.0.0.1:11434")

    @property
    def ai_temperature(self) -> float:
        return self._data.get("ai", {}).get("temperature", 0.7)

    @property
    def ai_max_tokens(self) -> int:
        return self._data.get("ai", {}).get("max_tokens", 4096)

    # ── Dual Model Support ─────────────────────────────
    @property
    def ai_model_fast(self) -> str:
        return self._data.get("ai", {}).get("model_fast", "")

    @property
    def ai_auto_route(self) -> bool:
        return self._data.get("ai", {}).get("auto_route", False)

    def get_model_options(self, mode: str = "deep") -> dict:
        """Get Ollama options for a specific model mode (deep/fast)."""
        ai = self._data.get("ai", {})
        overrides = ai.get(mode, {})
        return {
            "temperature": overrides.get("temperature", ai.get("temperature", 0.7)),
            "num_predict": overrides.get("max_tokens", ai.get("max_tokens", 2048)),
            "num_ctx": overrides.get("num_ctx", ai.get("num_ctx", 4096)),
            **({"num_gpu": overrides["num_gpu"]} if "num_gpu" in overrides else
               ({"num_gpu": ai["num_gpu"]} if "num_gpu" in ai else {})),
        }

    # ── Voice ──────────────────────────────────────────
    @property
    def voice_enabled(self) -> bool:
        return self._data.get("voice", {}).get("enabled", False)

    @property
    def stt_model(self) -> str:
        return self._data.get("voice", {}).get("stt_model", "base.en")

    @property
    def tts_model(self) -> str:
        return self._data.get("voice", {}).get("tts_model", "en_US-lessac-medium")

    @property
    def hotword(self) -> str:
        return self._data.get("voice", {}).get("hotword", "jarvis")

    # ── Security ───────────────────────────────────────
    @property
    def allowed_dirs(self) -> list[str]:
        return self._data.get("security", {}).get("allowed_dirs", [str(Path.home())])

    @property
    def command_timeout(self) -> int:
        return self._data.get("security", {}).get("command_timeout", 30)

    @property
    def max_memory_mb(self) -> int:
        return self._data.get("security", {}).get("max_memory_mb", 512)

    # ── Generic accessor ───────────────────────────────
    def get(self, dotted_key: str, default: Any = None) -> Any:
        """Access nested config: get('ai.model')"""
        keys = dotted_key.split(".")
        val: Any = self._data
        for k in keys:
            if isinstance(val, dict):
                val = val.get(k)
            else:
                return default
        return val if val is not None else default
