"""Shell tool — thin wrapper that delegates to CommandExecutor."""
from __future__ import annotations


def run_shell_command(executor, *, cmd: str, purpose: str = "", dry_run: bool = False) -> dict:
    res = executor.run(cmd, purpose=purpose, dry_run=dry_run)
    return {
        "cmd": res.cmd, "category": res.category, "approved": res.approved,
        "executed": res.executed, "exit_code": res.exit_code,
        "stdout": res.stdout, "stderr": res.stderr, "dry_run": res.dry_run,
        "error": res.error,
    }
