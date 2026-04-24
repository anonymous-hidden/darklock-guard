"""Bridge helpers: expose the orchestrator to other programs (e.g. ai-terminal.py).

Usage from outside this project:

    import sys
    sys.path.insert(0, "/abs/path/to/nova-agents")
    from nova.bridge import run_once

    task = run_once("summarize what's in ./src")
    print(task.final.answer if task.final else task.error)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .cli.terminal import build_stack
from .schemas.models import Task


_stack_cache: dict[str, Any] = {}


def get_stack(config_dir: Path | None = None, auto_deny_approvals: bool = False):
    """Build (and cache) the (cfg, orchestrator, ollama_client) stack."""
    key = f"{config_dir}|{auto_deny_approvals}"
    if key not in _stack_cache:
        _stack_cache[key] = build_stack(config_dir=config_dir, auto_deny_approvals=auto_deny_approvals)
    return _stack_cache[key]


def run_once(prompt: str, *, config_dir: Path | None = None, auto_deny_approvals: bool = False) -> Task:
    """Run a single prompt through the orchestrator and return the Task."""
    _cfg, orch, _client = get_stack(config_dir=config_dir, auto_deny_approvals=auto_deny_approvals)
    return orch.run(prompt)
