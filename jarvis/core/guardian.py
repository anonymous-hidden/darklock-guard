"""
Nova — Security Guardian
==========================
Central validation layer that all potentially dangerous actions pass through.

Rules:
  • No execution without logging
  • Restricted directory enforcement
  • Rate limiting on sensitive operations
  • Configurable action allow/deny lists
  • Every decision is logged with reasoning

This is the gatekeeper — if Guardian says no, the action does not happen.
"""

import os
import time
import threading
from pathlib import Path


class GuardianDecision:
    """Result of a security check."""
    __slots__ = ("allowed", "reason", "action", "path", "ts")

    def __init__(self, allowed: bool, reason: str, action: str = "",
                 path: str = ""):
        self.allowed = allowed
        self.reason = reason
        self.action = action
        self.path = path
        self.ts = time.time()

    def to_dict(self) -> dict:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "action": self.action,
            "path": self.path,
            "ts": round(self.ts, 3),
        }


class Guardian:
    """Security validation layer for all Nova actions."""

    # System-critical paths that are ALWAYS blocked
    SYSTEM_PATHS = frozenset({
        "/etc", "/usr", "/bin", "/sbin", "/boot", "/proc", "/sys",
        "/dev", "/root", "/var/log",
    })

    # Sensitive patterns always blocked for writes
    SENSITIVE_PATTERNS = frozenset({
        ".ssh", ".gnupg", ".env", "id_rsa", "id_ed25519",
        "shadow", "passwd", "sudoers",
    })

    # Operations that are always logged as critical
    CRITICAL_ACTIONS = frozenset({
        "delete_file", "modify_config", "execute_command",
        "restart_service", "modify_security",
    })

    MAX_DECISIONS = 200

    def __init__(self, config, audit, activity_tracker):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker

        self._lock = threading.Lock()
        self._decisions: list[GuardianDecision] = []
        self._action_counts: dict[str, int] = {}  # rate tracking
        self._rate_window_start = time.time()

        # Load allowed directories
        allowed = config.get("security.allowed_dirs") or ["~"]
        self._allowed_dirs = [
            os.path.realpath(os.path.expanduser(d)) for d in allowed
        ]

        self._command_timeout = config.get("security.command_timeout") or 30

    # ── Core validation ────────────────────────────

    def check_path(self, path: str, operation: str = "read") -> GuardianDecision:
        """Validate a file/directory path for the given operation."""
        real = os.path.realpath(os.path.expanduser(path))

        # Block system paths
        for sys_path in self.SYSTEM_PATHS:
            if real.startswith(sys_path) and not real.startswith(os.path.expanduser("~")):
                return self._deny(f"System path blocked: {sys_path}", operation, path)

        # Block sensitive patterns for write operations
        if operation in ("write", "delete", "modify"):
            basename = os.path.basename(real).lower()
            for pattern in self.SENSITIVE_PATTERNS:
                if pattern in real.lower():
                    return self._deny(
                        f"Sensitive pattern blocked: {pattern}", operation, path)

        # Check allowed directories
        in_allowed = any(real.startswith(d) for d in self._allowed_dirs)
        if not in_allowed:
            return self._deny(
                f"Path not in allowed directories", operation, path)

        return self._allow(f"Path validated under allowed dir", operation, path)

    def check_action(self, action: str, details: dict | None = None) -> GuardianDecision:
        """Validate a generic action (command execution, service restart, etc.)."""
        # Rate limiting: reset window every 60 seconds
        now = time.time()
        with self._lock:
            if now - self._rate_window_start > 60:
                self._action_counts.clear()
                self._rate_window_start = now

            count = self._action_counts.get(action, 0) + 1
            self._action_counts[action] = count

        # Rate limit: max 30 actions per minute for any single action type
        if count > 30:
            return self._deny(
                f"Rate limit exceeded for {action} ({count}/min)", action)

        # Critical actions get extra logging
        if action in self.CRITICAL_ACTIONS:
            self._audit.log("guardian", "critical_action", {
                "action": action, "details": details or {}})

        return self._allow(f"Action permitted", action)

    def check_command(self, command: str) -> GuardianDecision:
        """Validate a shell command before execution."""
        # Block obviously dangerous commands
        dangerous = ["rm -rf /", "mkfs", "dd if=", "> /dev/",
                      "chmod 777", "curl | sh", "wget | sh"]
        cmd_lower = command.lower().strip()
        for d in dangerous:
            if d in cmd_lower:
                return self._deny(f"Dangerous command blocked: {d}", "execute_command", command)

        return self._allow("Command permitted", "execute_command", command)

    # ── Decision helpers ───────────────────────────

    def _allow(self, reason: str, action: str = "",
               path: str = "") -> GuardianDecision:
        d = GuardianDecision(True, reason, action, path)
        self._record(d)
        return d

    def _deny(self, reason: str, action: str = "",
              path: str = "") -> GuardianDecision:
        d = GuardianDecision(False, reason, action, path)
        self._record(d)
        self._activity.system_event(
            f"🛡️ BLOCKED: {action} — {reason}",
            details={"action": action, "path": path})
        return d

    def _record(self, decision: GuardianDecision):
        self._audit.log("guardian",
                        "allowed" if decision.allowed else "blocked",
                        decision.to_dict())
        with self._lock:
            self._decisions.append(decision)
            if len(self._decisions) > self.MAX_DECISIONS:
                self._decisions = self._decisions[-self.MAX_DECISIONS:]

    # ── Queries ────────────────────────────────────

    def recent_decisions(self, count: int = 50,
                         blocked_only: bool = False) -> list[dict]:
        with self._lock:
            items = list(reversed(self._decisions))
        if blocked_only:
            items = [d for d in items if not d.allowed]
        return [d.to_dict() for d in items[:count]]

    def get_status(self) -> dict:
        with self._lock:
            total = len(self._decisions)
            blocked = sum(1 for d in self._decisions if not d.allowed)
        return {
            "total_checks": total,
            "blocked": blocked,
            "allowed_dirs": self._allowed_dirs,
            "command_timeout": self._command_timeout,
        }
