"""
Nova — Command Gateway
===============================
Whitelist-based validation layer.  Every command the AI outputs must pass
through here BEFORE reaching the executor.
"""

import os
import re
from dataclasses import dataclass

from commands.registry import CommandRegistry
from config import JarvisConfig
from logs.audit import AuditLogger


@dataclass
class ValidationResult:
    approved: bool
    command: dict | None = None
    reason: str = ""
    requires_approval: bool = False


class CommandGateway:
    def __init__(self, registry: CommandRegistry, audit: AuditLogger, config: JarvisConfig):
        self._registry = registry
        self._audit = audit
        self._allowed_dirs = [os.path.expanduser(d) for d in config.allowed_dirs]

        # Patterns that are NEVER allowed in any argument value
        self._blocked_patterns = [
            r';\s*rm\s',            # rm after semicolon
            r'\|\s*rm\s',           # rm after pipe
            r'rm\s+-rf?\s+/',       # rm -rf /
            r'>\s*/dev/',           # write to /dev
            r'mkfs\.',              # format filesystem
            r'dd\s+if=',           # dd raw disk write
            r'\$\(',               # command substitution
            r'`[^`]+`',            # backtick execution
            r'\beval\s',            # eval
            r'\bexec\s',            # exec
            r'\bsudo\s',            # sudo
            r'\bsu\s+-',            # su switch user
            r'chmod\s+777',         # world-writable
            r'curl\s.*\|\s*bash',   # pipe to bash
            r'wget\s.*\|\s*bash',   # pipe to bash
            r'python\s.*-c\s',      # arbitrary python exec
            r'node\s.*-e\s',        # arbitrary node exec
        ]

    def validate(self, command: dict) -> ValidationResult:
        """Validate a parsed command dict against the whitelist and safety rules."""
        if not isinstance(command, dict):
            return self._reject("Invalid command format: not a dictionary")

        cmd_type = command.get("type")
        action = command.get("action")
        args = command.get("args", {})

        if cmd_type != "command":
            return self._reject(f"Unknown command type: {cmd_type}")
        if not action:
            return self._reject("Missing 'action' field")

        # Must be in the registry
        cmd_def = self._registry.get(action)
        if cmd_def is None:
            return self._reject(f"Unknown command '{action}' — not in whitelist")

        # Required arguments present
        for arg in cmd_def.required_args:
            if arg not in args:
                return self._reject(f"Missing required argument '{arg}' for {action}")

        # Scan every string argument for blocked patterns
        for key, value in args.items():
            if isinstance(value, str):
                violation = self._check_blocked(value)
                if violation:
                    return self._reject(
                        f"Blocked pattern in argument '{key}': {violation}"
                    )

        # Path safety
        if "path" in args:
            path_result = self._validate_path(args["path"])
            if not path_result.approved:
                return path_result

        # Script name safety
        if action == "run_script":
            if not re.match(r'^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$', args.get("script", "")):
                return self._reject(f"Invalid script name: {args.get('script')}")

        self._audit.log("gateway", "approved", {"action": action, "args": args})
        return ValidationResult(
            approved=True,
            command=command,
            requires_approval=cmd_def.requires_approval,
        )

    # ── Internal helpers ───────────────────────────────

    def _validate_path(self, path: str) -> ValidationResult:
        resolved = os.path.realpath(os.path.expanduser(path))

        if ".." in path:
            return self._reject(f"Path traversal detected: {path}")

        if not any(resolved.startswith(os.path.realpath(d)) for d in self._allowed_dirs):
            return self._reject(f"Path outside allowed directories: {path}")

        sensitive = ["/etc/shadow", "/etc/passwd", "/etc/sudoers", "/root", "/proc", "/sys"]
        if any(resolved.startswith(s) for s in sensitive):
            return self._reject(f"Access to sensitive path blocked: {path}")

        return ValidationResult(approved=True)

    def _check_blocked(self, value: str) -> str | None:
        for pattern in self._blocked_patterns:
            if re.search(pattern, value, re.IGNORECASE):
                return pattern
        return None

    def _reject(self, reason: str) -> ValidationResult:
        self._audit.log("gateway", "rejected", {"reason": reason})
        return ValidationResult(approved=False, reason=reason)
