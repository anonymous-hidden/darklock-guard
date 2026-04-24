"""Config + secrets loading with env-var interpolation."""
from __future__ import annotations
import os
import re
import yaml
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

_ENV_RE = re.compile(r"\$\{([A-Z0-9_]+)(?::([^}]*))?\}")


def _interp(val: Any) -> Any:
    if isinstance(val, str):
        def repl(m: re.Match) -> str:
            name, default = m.group(1), (m.group(2) or "")
            return os.environ.get(name, default)
        return _ENV_RE.sub(repl, val)
    if isinstance(val, dict):
        return {k: _interp(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_interp(v) for v in val]
    return val


class Config:
    def __init__(self, data: dict):
        self.data = data

    def get(self, path: str, default: Any = None) -> Any:
        cur: Any = self.data
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return _interp(yaml.safe_load(f) or {})


def load_all(config_dir: Path) -> dict[str, Config]:
    config_dir = Path(config_dir)
    return {
        "main": Config(load_yaml(config_dir / "config.yaml")),
        "agents": Config(load_yaml(config_dir / "agents.yaml")),
        "policy": Config(load_yaml(config_dir / "policy.yaml")),
        "connectors": Config(load_yaml(config_dir / "connectors.yaml")),
    }


def get_env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)
