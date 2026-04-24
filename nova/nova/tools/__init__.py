"""Tool registry builder — wires all local tools with their dependencies."""
from __future__ import annotations
from functools import partial

from .registry import Tool, ToolRegistry
from .fs_tools import (FsPolicy, read_file, write_file, list_dir, search_files,
                       inspect_repo)
from .memory_tools import append_memory_note, retrieve_memory_notes, log_event
from .util_tools import parse_json, validate_output, run_local_analysis
from .shell_tool import run_shell_command


def build_registry(*, fs_policy: FsPolicy, memory_store, logger,
                   executor, connectors=None) -> ToolRegistry:
    r = ToolRegistry()
    # filesystem
    r.register(Tool("read_file",    "Read a file (sandboxed)",  "read",
                    partial(read_file, fs_policy)))
    r.register(Tool("write_file",   "Write a file (sandboxed)", "write",
                    partial(write_file, fs_policy),
                    modes=["agent"]))
    r.register(Tool("list_dir",     "List a directory",         "read",
                    partial(list_dir, fs_policy)))
    r.register(Tool("search_files", "Grep in files",            "read",
                    partial(search_files, fs_policy)))
    r.register(Tool("inspect_repo", "Inspect repo metadata",    "read",
                    partial(inspect_repo, fs_policy)))
    # memory
    r.register(Tool("append_memory_note",    "Append a memory note",    "write",
                    partial(append_memory_note, memory_store)))
    r.register(Tool("retrieve_memory_notes", "Retrieve memory notes",   "read",
                    partial(retrieve_memory_notes, memory_store)))
    r.register(Tool("log_event",             "Emit a structured log",   "write",
                    partial(log_event, logger)))
    # utilities
    r.register(Tool("parse_json",       "Parse text as JSON",      "read",  parse_json))
    r.register(Tool("validate_output",  "Validate structured output", "read",
                    validate_output))
    r.register(Tool("run_local_analysis", "Local read-only code analysis", "read",
                    run_local_analysis))
    # shell
    r.register(Tool("run_shell_command", "Run a shell command (policy-gated)", "exec",
                    partial(run_shell_command, executor),
                    modes=["agent"]))
    # connector bridge as a tool (so agents can call connectors generically)
    if connectors is not None:
        def _call_connector(*, name: str, action: str, params: dict | None = None):
            res = connectors.invoke(name, action, **(params or {}))
            return {"ok": res.ok, "data": res.data, "error": res.error, "meta": res.meta}
        r.register(Tool("call_connector", "Invoke a registered connector action",
                        "exec", _call_connector, modes=["agent"]))
    return r
