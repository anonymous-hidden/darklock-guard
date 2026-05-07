"""Tool wiring: builds the registry from config + policies."""
from __future__ import annotations

from pathlib import Path

from ..utils.approval import ApprovalGate
from .ai_terminal_bridge import build_ai_terminal_memory_tool, build_ai_terminal_write_tool
from .file_tools import FsPolicy, build_fs_tools
from .memory_tools import build_log_tool, build_memory_tools
from .registry import ToolRegistry
from .shell_tool import ShellPolicy, build_shell_tool


def build_registry(cfg, memory_store, logger, approval: ApprovalGate, project_root: Path) -> ToolRegistry:
    reg = ToolRegistry()

    fs_policy = FsPolicy(
        allowed_roots=cfg.get("safety.fs_allowed_roots", ["."]),
        denied_patterns=cfg.get("safety.fs_denied_patterns", []),
        max_read=int(cfg.get("safety.fs_max_read_bytes", 262144)),
        max_write=int(cfg.get("safety.fs_max_write_bytes", 262144)),
        project_root=project_root,
    )
    for t in build_fs_tools(fs_policy):
        reg.register(t)

    for t in build_memory_tools(memory_store):
        reg.register(t)

    reg.register(build_log_tool(logger))
    reg.register(build_ai_terminal_memory_tool())
    reg.register(build_ai_terminal_write_tool())

    shell_policy = ShellPolicy(
        mode=cfg.get("safety.shell_mode", "approval"),
        allowlist=cfg.get("safety.shell_allowlist", []),
        deny_patterns=cfg.get("safety.shell_denylist_patterns", []),
        max_output_bytes=int(cfg.get("safety.shell_max_output_bytes", 16384)),
        timeout_seconds=int(cfg.get("safety.shell_timeout_seconds", 20)),
    )
    reg.register(build_shell_tool(shell_policy, approval, logger))

    return reg
