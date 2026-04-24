"""Mode manager — Normal vs Agent, with runtime switching."""
from __future__ import annotations
from typing import Literal

Mode = Literal["normal", "agent"]


class ModeManager:
    def __init__(self, default: Mode = "normal", allow_switch: bool = True):
        self._mode: Mode = default if default in ("normal", "agent") else "normal"
        self._allow_switch = allow_switch

    @property
    def mode(self) -> Mode:
        return self._mode

    def set(self, mode: str) -> Mode:
        if not self._allow_switch:
            raise PermissionError("Runtime mode switching is disabled.")
        if mode not in ("normal", "agent"):
            raise ValueError(f"Unknown mode: {mode}")
        self._mode = mode  # type: ignore[assignment]
        return self._mode

    def is_agent(self) -> bool:
        return self._mode == "agent"
