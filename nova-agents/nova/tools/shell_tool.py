"""Safe shell execution tool with allowlist/denylist/approval enforcement."""
from __future__ import annotations

import re
import shlex
import subprocess
from typing import Any

from ..utils.approval import ApprovalGate
from .registry import Tool


class ShellPolicy:
    def __init__(
        self,
        mode: str,
        allowlist: list[str],
        deny_patterns: list[str],
        max_output_bytes: int,
        timeout_seconds: int,
    ) -> None:
        self.mode = mode  # "safe" | "approval" | "permissive"
        self.allowlist = set(allowlist)
        self.deny = [re.compile(p) for p in deny_patterns]
        self.max_output = max_output_bytes
        self.timeout = timeout_seconds

    def screen(self, command: str) -> tuple[bool, str]:
        """Return (ok_without_approval, reason). In approval mode, risky commands
        still return ok_without_approval=False -> caller prompts human."""
        for pat in self.deny:
            if pat.search(command):
                return False, f"denied: matches pattern /{pat.pattern}/"
        try:
            tokens = shlex.split(command)
        except ValueError as exc:
            return False, f"unparsable command: {exc}"
        if not tokens:
            return False, "empty command"
        base = tokens[0].rsplit("/", 1)[-1]
        in_allowlist = base in self.allowlist

        if self.mode == "safe":
            if not in_allowlist:
                return False, f"safe-mode: '{base}' not in allowlist"
            return True, "allowlisted"
        if self.mode == "permissive":
            return True, "permissive"
        # approval mode
        if in_allowlist:
            return True, "allowlisted"
        return False, f"approval required: '{base}' not allowlisted"


def build_shell_tool(policy: ShellPolicy, approval: ApprovalGate, logger) -> Tool:
    def run_shell_command(command: str, cwd: str | None = None) -> dict[str, Any]:
        logger.info("shell.request", command=command, cwd=cwd, mode=policy.mode)
        ok, reason = policy.screen(command)

        if not ok:
            # In approval mode we may still ask the human.
            if policy.mode == "approval" and not reason.startswith("denied:"):
                granted = approval.confirm(f"Run shell command: {command!r} ({reason})")
                if not granted:
                    logger.warn("shell.denied", command=command, reason="user rejected")
                    return {"ok": False, "error": "denied by user", "reason": reason}
                ok = True
            else:
                logger.warn("shell.denied", command=command, reason=reason)
                return {"ok": False, "error": reason}

        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                timeout=policy.timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            logger.error("shell.timeout", command=command)
            return {"ok": False, "error": f"timeout after {policy.timeout}s"}

        stdout = proc.stdout[: policy.max_output].decode("utf-8", errors="replace")
        stderr = proc.stderr[: policy.max_output].decode("utf-8", errors="replace")
        truncated = len(proc.stdout) > policy.max_output or len(proc.stderr) > policy.max_output
        logger.info("shell.done", command=command, rc=proc.returncode, truncated=truncated)
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "truncated": truncated,
        }

    return Tool(
        name="run_shell_command",
        description="Run a shell command. Subject to allowlist/denylist and approval policy.",
        input_schema={"command": "str", "cwd": "str?"},
        permission="exec",
        func=run_shell_command,
    )
