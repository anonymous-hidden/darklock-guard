"""Access policy — enforces per-mode tool/connector/command permissions."""
from __future__ import annotations
from typing import Iterable
from ..utils.config import Config


class AccessPolicy:
    def __init__(self, policy_cfg: Config):
        self.cfg = policy_cfg

    # --- generic matrix lookup ---
    def _mode_cfg(self, mode: str) -> dict:
        return self.cfg.get(f"modes.{mode}", {}) or {}

    def allowed_tools(self, mode: str) -> list[str] | str:
        return self._mode_cfg(mode).get("tools_allowed", [])

    def allowed_connectors(self, mode: str) -> list[str] | str:
        return self._mode_cfg(mode).get("connectors_allowed", [])

    def shell_allowed(self, mode: str) -> bool:
        return bool(self._mode_cfg(mode).get("shell_allowed", False))

    def shell_auto_categories(self, mode: str) -> list[str]:
        return list(self._mode_cfg(mode).get("shell_categories_auto", []))

    def presets_allowed(self, mode: str) -> list[str] | str:
        return self._mode_cfg(mode).get("presets_allowed", [])

    def approval_required_for(self, mode: str) -> list[str]:
        return list(self._mode_cfg(mode).get("approval_required_for", []))

    # --- helpers ---
    @staticmethod
    def _is_allowed(value: str, allowlist: list[str] | str) -> bool:
        if allowlist == "*":
            return True
        return isinstance(allowlist, list) and value in allowlist

    def can_use_tool(self, mode: str, tool: str) -> bool:
        return self._is_allowed(tool, self.allowed_tools(mode))

    def can_use_connector(self, mode: str, connector: str) -> bool:
        return self._is_allowed(connector, self.allowed_connectors(mode))

    def can_run_preset(self, mode: str, preset: str) -> bool:
        return self._is_allowed(preset, self.presets_allowed(mode))

    def filtered(self, mode: str, names: Iterable[str], kind: str) -> list[str]:
        check = {"tool": self.can_use_tool, "connector": self.can_use_connector,
                 "preset": self.can_run_preset}[kind]
        return [n for n in names if check(mode, n)]

    # --- raw config access for classifier ---
    def fs_allowed_roots(self) -> list[str]:
        return list(self.cfg.get("fs.allowed_roots", []))

    def fs_denied(self) -> list[str]:
        return list(self.cfg.get("fs.denied_patterns", []))

    def shell_safe_allowlist(self) -> list[str]:
        return list(self.cfg.get("shell.safe_allowlist", []))

    def shell_elevated(self) -> list[str]:
        return list(self.cfg.get("shell.elevated_patterns", []))

    def shell_destructive(self) -> list[str]:
        return list(self.cfg.get("shell.destructive_patterns", []))

    def shell_hard_deny(self) -> list[str]:
        return list(self.cfg.get("shell.hard_deny_patterns", []))
