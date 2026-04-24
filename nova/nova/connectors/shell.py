"""Shell connector — wraps CommandExecutor (policy + approval enforced)."""
from __future__ import annotations
from .base import BaseConnector, ConnectorAction, ConnectorResult


class ShellConnector(BaseConnector):
    name = "shell"
    description = "Run shell commands via the policy-gated executor."
    risk = "high"
    modes = ["agent"]

    def __init__(self, cfg=None, logger=None, executor=None):
        self.executor = executor
        super().__init__(cfg, logger)

    def _register_actions(self) -> None:
        self.register(ConnectorAction(
            "run", "Execute a shell command (policy + approval enforced)", "exec",
            requires_approval=True,
            handler=self._run,
        ))
        self.register(ConnectorAction(
            "dry_run", "Preview a shell command without executing", "read",
            handler=lambda **p: self._run(dry_run=True, **p),
        ))

    def _run(self, *, cmd: str, purpose: str = "", dry_run: bool = False) -> dict:
        if not self.executor:
            return {"ok": False, "error": "executor unavailable"}
        r = self.executor.run(cmd, purpose=purpose, dry_run=dry_run)
        return {
            "ok": r.executed or r.dry_run,
            "cmd": r.cmd, "category": r.category, "approved": r.approved,
            "executed": r.executed, "exit_code": r.exit_code, "dry_run": r.dry_run,
            "stdout": r.stdout, "stderr": r.stderr, "error": r.error,
        }

    def is_configured(self) -> bool:
        return self.executor is not None

    def health(self) -> ConnectorResult:
        return ConnectorResult(self.enabled and self.executor is not None)
