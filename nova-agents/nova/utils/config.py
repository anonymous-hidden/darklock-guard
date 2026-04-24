"""Typed config loader with small dotted-path access."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


class Config:
    def __init__(self, data: dict[str, Any], root: Path) -> None:
        self._data = data
        self.root = root

    def get(self, path: str, default: Any = None) -> Any:
        cur: Any = self._data
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    def as_dict(self) -> dict[str, Any]:
        return self._data

    def resolve_path(self, value: str) -> Path:
        expanded = os.path.expanduser(value)
        p = Path(expanded)
        if not p.is_absolute():
            p = (self.root / p).resolve()
        return p


def load_config(config_dir: Path | str | None = None) -> tuple[Config, Config, Config]:
    """Load (main, agents, tools) configs. Returns three Config objects."""
    if config_dir is None:
        config_dir = Path(__file__).resolve().parents[2] / "config"
    config_dir = Path(config_dir)
    project_root = config_dir.parent

    def _read(name: str) -> Config:
        with (config_dir / name).open("r", encoding="utf-8") as fh:
            return Config(yaml.safe_load(fh) or {}, project_root)

    return _read("config.yaml"), _read("agents.yaml"), _read("tools.yaml")
