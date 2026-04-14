"""
Home AI Assistant - Permission System
======================================
Enforces risk-based approval for every command.
  - LOW risk:    auto-approved
  - MEDIUM risk: requires user confirmation
  - HIGH risk:   requires explicit manual approval

The AI cannot bypass or modify this system.
"""

import asyncio
from typing import Callable, Optional

from command_parser import ParsedCommand, RiskLevel
from logger import HomeAILogger


class PermissionManager:
    """Manages command approval based on risk levels."""

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("permissions", {})
        self._logger = logger

        self._auto_approve = set(self._config.get("auto_approve", ["low"]))
        self._require_approval = set(
            self._config.get("require_approval_for", ["medium", "high"])
        )

        # Callback for requesting user approval (set by UI layer)
        self._approval_callback: Optional[Callable] = None

        self._logger.info("permissions", "Permission manager initialized", {
            "auto_approve": list(self._auto_approve),
            "require_approval": list(self._require_approval),
        })

    def set_approval_callback(self, callback: Callable):
        """
        Register a callback for requesting user approval.
        The callback receives (command_name, risk_level, params, reasoning)
        and must return True/False.
        """
        self._approval_callback = callback

    async def check_permission(self, command: ParsedCommand) -> bool:
        """
        Check whether a command is approved for execution.
        Returns True if approved, False if denied.
        """
        risk = command.risk.value

        # Auto-approve low-risk commands
        if risk in self._auto_approve:
            command.approved = True
            self._logger.log_permission_decision(
                command.name, risk, True, "auto"
            )
            return True

        # Require user approval for medium/high risk
        if risk in self._require_approval:
            approved = await self._request_approval(command)
            command.approved = approved
            self._logger.log_permission_decision(
                command.name, risk, approved,
                "user_confirmation" if risk == "medium" else "manual_approval"
            )
            return approved

        # Default deny for unknown risk levels
        self._logger.log_permission_decision(command.name, risk, False, "default_deny")
        return False

    async def _request_approval(self, command: ParsedCommand) -> bool:
        """Request user approval via the registered callback."""
        if self._approval_callback is None:
            # No UI callback registered — deny by default for safety
            self._logger.warning("permissions",
                                 "No approval callback registered — denying command", {
                                     "command": command.name,
                                 })
            return False

        try:
            result = self._approval_callback(
                command.name,
                command.risk.value,
                command.params,
                command.reasoning,
            )
            # Support both sync and async callbacks
            if asyncio.iscoroutine(result):
                return await result
            return bool(result)
        except Exception as e:
            self._logger.error("permissions",
                               f"Approval callback failed: {e}", {
                                   "command": command.name,
                               })
            return False  # Fail closed
