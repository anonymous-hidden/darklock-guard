"""Preset loader — reads all YAMLs under config/presets/."""
from __future__ import annotations
import yaml
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Preset:
    name: str
    description: str = ""
    modes: list[str] = field(default_factory=lambda: ["agent"])
    risk: str = "low"
    approval_required: bool = False
    tools: list[str] = field(default_factory=list)
    connectors: list[str] = field(default_factory=list)
    steps: list[dict] = field(default_factory=list)
    validation: dict = field(default_factory=dict)
    retries: int = 1


class PresetLoader:
    def __init__(self, directory: str | Path):
        self.dir = Path(directory)
        self.presets: dict[str, Preset] = {}
        self._load()

    def _load(self) -> None:
        if not self.dir.exists():
            return
        for f in sorted(self.dir.glob("*.yaml")):
            try:
                data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            name = data.get("name") or f.stem
            p = Preset(
                name=name,
                description=data.get("description", ""),
                modes=list(data.get("modes", ["agent"])),
                risk=str(data.get("risk", "low")),
                approval_required=bool(data.get("approval_required", False)),
                tools=list(data.get("tools", [])),
                connectors=list(data.get("connectors", [])),
                steps=list(data.get("steps", [])),
                validation=dict(data.get("validation", {})),
                retries=int(data.get("retries", 1)),
            )
            self.presets[name] = p

    def get(self, name: str) -> Preset | None:
        return self.presets.get(name)

    def names(self) -> list[str]:
        return list(self.presets.keys())

    def for_mode(self, mode: str) -> list[Preset]:
        return [p for p in self.presets.values() if mode in p.modes]
