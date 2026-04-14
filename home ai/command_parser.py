"""
Home AI Assistant - Command Parser & Validator
===============================================
Parses structured JSON commands from AI output.
Validates commands against the whitelist.
Assigns risk levels and enforces permission rules.

The AI outputs JSON like:
{
  "command": "get_system_status",
  "params": {},
  "reasoning": "User asked about system health"
}

This module validates that structure, checks the whitelist,
and returns a validated command object or rejects it.
"""

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from logger import HomeAILogger


class RiskLevel(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass
class ParsedCommand:
    """A validated, parsed command ready for permission check and execution."""
    name: str
    params: dict = field(default_factory=dict)
    reasoning: str = ""
    risk: RiskLevel = RiskLevel.MEDIUM
    approved: bool = False
    raw_json: dict = field(default_factory=dict)


class CommandParser:
    """
    Extracts and validates structured commands from AI responses.
    Only whitelisted commands are accepted.
    """

    # Regex to find JSON blocks in AI text output
    JSON_BLOCK_RE = re.compile(
        r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL
    )
    # Fallback: find bare JSON objects
    BARE_JSON_RE = re.compile(r"(\{[^{}]*\"command\"[^{}]*\})", re.DOTALL)

    def __init__(self, config: dict, logger: HomeAILogger):
        self._logger = logger
        self._config = config

        # Build whitelist lookup: name -> command config
        self._whitelist: dict[str, dict] = {}
        for cmd in config.get("commands", {}).get("allowed", []):
            self._whitelist[cmd["name"]] = cmd

        self._logger.info("command_parser", "Command parser initialized", {
            "whitelisted_commands": list(self._whitelist.keys()),
        })

    def parse(self, ai_response: str) -> list[ParsedCommand]:
        """
        Extract commands from AI response text.
        Returns a list of validated ParsedCommand objects.
        Invalid or non-whitelisted commands are rejected and logged.
        """
        commands = []
        raw_jsons = self._extract_json_blocks(ai_response)

        if not raw_jsons:
            # No commands found — this is just a conversational response
            return commands

        for raw in raw_jsons:
            cmd = self._validate_command(raw)
            if cmd is not None:
                commands.append(cmd)

        return commands

    def _extract_json_blocks(self, text: str) -> list[dict]:
        """Extract JSON objects from AI response text."""
        results = []

        # Try fenced code blocks first
        for match in self.JSON_BLOCK_RE.finditer(text):
            try:
                obj = json.loads(match.group(1))
                if isinstance(obj, dict) and "command" in obj:
                    results.append(obj)
            except json.JSONDecodeError:
                continue

        # Fallback to bare JSON objects
        if not results:
            for match in self.BARE_JSON_RE.finditer(text):
                try:
                    obj = json.loads(match.group(1))
                    if isinstance(obj, dict) and "command" in obj:
                        results.append(obj)
                except json.JSONDecodeError:
                    continue

        return results

    def _validate_command(self, raw: dict) -> Optional[ParsedCommand]:
        """Validate a raw JSON command dict against the whitelist."""
        cmd_name = raw.get("command", "").strip()

        if not cmd_name:
            self._logger.log_security_event("empty_command", {"raw": raw})
            return None

        # Check whitelist
        if cmd_name not in self._whitelist:
            self._logger.log_security_event("command_not_whitelisted", {
                "command": cmd_name,
                "raw": raw,
            })
            return None

        whitelisted = self._whitelist[cmd_name]
        risk = RiskLevel(whitelisted.get("risk", "medium"))

        # Validate params is a dict (prevent injection of non-dict types)
        params = raw.get("params", {})
        if not isinstance(params, dict):
            self._logger.log_security_event("invalid_params_type", {
                "command": cmd_name,
                "params_type": type(params).__name__,
            })
            return None

        # Sanitize param values — reject if any value contains shell metacharacters
        # when the command might touch the filesystem or shell
        if not self._sanitize_params(cmd_name, params):
            return None

        parsed = ParsedCommand(
            name=cmd_name,
            params=params,
            reasoning=str(raw.get("reasoning", ""))[:500],
            risk=risk,
            raw_json=raw,
        )

        self._logger.log_parsed_command({
            "name": parsed.name,
            "params": parsed.params,
            "risk": parsed.risk.value,
            "reasoning": parsed.reasoning,
        })

        return parsed

    def _sanitize_params(self, cmd_name: str, params: dict) -> bool:
        """
        Basic sanitization of command parameters.
        Rejects params with dangerous shell metacharacters for
        commands that interact with the filesystem or shell.
        """
        # Commands that interact with shell/filesystem
        shell_commands = {"run_script", "ssh_command", "list_files", "read_file"}

        if cmd_name in shell_commands:
            dangerous_patterns = [";", "&&", "||", "|", "`", "$(", "${", "\n", "\r"]
            for key, value in params.items():
                if isinstance(value, str):
                    for pattern in dangerous_patterns:
                        if pattern in value:
                            self._logger.log_security_event("dangerous_param", {
                                "command": cmd_name,
                                "param": key,
                                "pattern": pattern,
                            })
                            return False
        return True

    def get_risk_level(self, command_name: str) -> RiskLevel:
        """Get the risk level for a whitelisted command."""
        if command_name in self._whitelist:
            return RiskLevel(self._whitelist[command_name].get("risk", "medium"))
        return RiskLevel.HIGH  # Unknown commands default to high risk

    def is_whitelisted(self, command_name: str) -> bool:
        return command_name in self._whitelist

    def list_commands(self) -> list[dict]:
        """Return list of all whitelisted commands (for help/display)."""
        return [
            {
                "name": cmd["name"],
                "risk": cmd.get("risk", "medium"),
                "description": cmd.get("description", ""),
            }
            for cmd in self._whitelist.values()
        ]
