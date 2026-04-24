"""Base connector interface + shared types."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class ConnectorAction:
    name: str
    description: str
    permission: str = "read"          # read | write | exec
    requires_approval: bool = False
    handler: Callable[..., Any] | None = None


@dataclass
class ConnectorResult:
    ok: bool
    data: Any = None
    error: str = ""
    meta: dict = field(default_factory=dict)


class BaseConnector:
    name: str = "base"
    description: str = ""
    risk: str = "low"                 # low | medium | high
    modes: list[str] = ["normal", "agent"]

    def __init__(self, cfg: dict | None = None, logger=None):
        self.cfg = cfg or {}
        self.enabled = bool(self.cfg.get("enabled", False))
        self.logger = logger
        self._actions: dict[str, ConnectorAction] = {}
        self._register_actions()

    # subclasses override
    def _register_actions(self) -> None:
        pass

    def register(self, action: ConnectorAction) -> None:
        self._actions[action.name] = action

    def actions(self) -> list[dict]:
        return [{"name": a.name, "description": a.description,
                 "permission": a.permission, "requires_approval": a.requires_approval}
                for a in self._actions.values()]

    def capabilities(self) -> dict:
        return {"name": self.name, "enabled": self.enabled, "risk": self.risk,
                "modes": self.modes, "actions": self.actions(),
                "configured": self.is_configured()}

    def is_configured(self) -> bool:
        return True

    def health(self) -> ConnectorResult:
        return ConnectorResult(self.enabled and self.is_configured(),
                               data={"enabled": self.enabled})

    def invoke(self, action: str, **params) -> ConnectorResult:
        if not self.enabled:
            return ConnectorResult(False, error=f"connector '{self.name}' disabled")
        if not self.is_configured():
            return ConnectorResult(False, error=f"connector '{self.name}' not configured")
        a = self._actions.get(action)
        if not a or not a.handler:
            return ConnectorResult(False, error=f"unknown action '{action}'")
        try:
            out = a.handler(**params)
            if isinstance(out, ConnectorResult):
                return out
            return ConnectorResult(True, data=out)
        except Exception as e:
            return ConnectorResult(False, error=f"{type(e).__name__}: {e}")
