"""NOVA bridge — embed the full NOVA stack inside other Python apps.

Usage:
    from nova.bridge import get_stack, run_once, set_mode
    task = run_once("summarize my notes", mode="agent")
    print(task.final.answer)
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

_cache: dict = {"stack": None}


def get_stack(*, config_dir: Optional[str | Path] = None,
              mode: Optional[str] = None,
              auto_deny_approvals: bool = False):
    """Return a cached NOVA Stack, building it on first call."""
    if _cache["stack"] is None:
        from .cli.terminal import build_stack
        _cache["stack"] = build_stack(
            config_dir=Path(config_dir) if config_dir else None,
            mode=mode,
            auto_deny_approvals=auto_deny_approvals,
        )
    elif mode:
        _cache["stack"].mode.set(mode)
        _reapply_mode(_cache["stack"])
    return _cache["stack"]


def reset_stack() -> None:
    _cache["stack"] = None


def set_mode(mode: str) -> str:
    s = get_stack()
    s.mode.set(mode)
    _reapply_mode(s)
    return s.mode.mode


def _reapply_mode(stack) -> None:
    stack.executor.mode = stack.mode.mode
    stack.executor.shell_allowed = stack.policy.shell_allowed(stack.mode.mode)
    stack.executor.auto_categories = set(
        stack.policy.shell_auto_categories(stack.mode.mode))


def run_once(prompt: str, *, mode: Optional[str] = None,
             config_dir: Optional[str | Path] = None,
             auto_deny_approvals: bool = False):
    """Run one user turn through the orchestrator and return the Task."""
    s = get_stack(config_dir=config_dir, mode=mode,
                  auto_deny_approvals=auto_deny_approvals)
    if mode and s.mode.mode != mode:
        s.mode.set(mode)
        _reapply_mode(s)
    return s.orchestrator.run(prompt)


def list_presets(mode: Optional[str] = None) -> list[dict]:
    s = get_stack()
    m = mode or s.mode.mode
    return [{"name": p.name, "description": p.description, "risk": p.risk,
             "approval_required": p.approval_required, "modes": p.modes}
            for p in s.presets.for_mode(m)]


def list_connectors() -> list[dict]:
    return get_stack().connectors.capabilities()


def health() -> dict:
    return get_stack().connectors.health_check_all()


def invoke_connector(name: str, action: str, **params) -> dict:
    r = get_stack().connectors.invoke(name, action, **params)
    return {"ok": r.ok, "data": r.data, "error": r.error, "meta": r.meta}


def run_preset(preset_name: str, user_input: str = "", *,
               mode: Optional[str] = None):
    """Force-run a specific preset regardless of supervisor decision."""
    s = get_stack(mode=mode)
    preset = s.presets.get(preset_name)
    if preset is None:
        raise KeyError(f"unknown preset: {preset_name}")
    if not s.policy.can_run_preset(s.mode.mode, preset_name):
        raise PermissionError(
            f"preset '{preset_name}' not allowed in mode '{s.mode.mode}'")
    from .schemas.models import Task, FinalAnswer
    task = Task(user_input=user_input or preset.description, mode=s.mode.mode,
                preset=preset_name)
    plan = s.orchestrator._plan_from_preset(preset, user_input or preset.description)
    task.plan = plan
    s.orchestrator._execute_plan(task)
    if not task.final:
        s.orchestrator._final_summarize(task)
    task.status = "done" if task.final else "failed"
    return task


def run_shell(cmd: str, *, purpose: str = "", dry_run: bool = False) -> dict:
    s = get_stack()
    r = s.executor.run(cmd, purpose=purpose, dry_run=dry_run)
    return {"cmd": r.cmd, "category": r.category, "approved": r.approved,
            "executed": r.executed, "exit_code": r.exit_code,
            "dry_run": r.dry_run, "stdout": r.stdout, "stderr": r.stderr,
            "error": r.error}
