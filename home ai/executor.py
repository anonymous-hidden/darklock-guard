"""
Home AI Assistant - Command Executor
=====================================
Executes validated, approved commands by dispatching
to the appropriate backend function.

SAFETY:
- Only executes commands that passed whitelist validation
- Only executes commands that have been approved by the permission system
- Each command maps to a specific, hardcoded backend function
- No arbitrary shell execution
- All results are logged
"""

import os
import platform
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from command_parser import ParsedCommand
from logger import HomeAILogger


class CommandExecutor:
    """
    Dispatches validated commands to their backend implementations.
    The AI never calls this directly — the orchestrator does after
    validation and permission checks.
    """

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config
        self._logger = logger

        # Whitelisted filesystem paths
        self._allowed_paths = [
            Path(p).resolve()
            for p in config.get("filesystem", {}).get("allowed_paths", [])
        ]
        self._blocked_paths = [
            Path(p).resolve()
            for p in config.get("filesystem", {}).get("blocked_paths", [])
        ]

        # Pre-approved scripts directory
        self._scripts_dir = Path(config.get("scripts_dir", "scripts")).resolve()

        # Command dispatch table — maps command names to handler methods
        self._handlers = {
            "get_system_status": self._handle_system_status,
            "get_time": self._handle_get_time,
            "list_files": self._handle_list_files,
            "read_file": self._handle_read_file,
            "run_script": self._handle_run_script,
            "restart_service": self._handle_restart_service,
            "send_notification": self._handle_send_notification,
            "smart_home_control": self._handle_smart_home,
        }
        # Note: ssh_command is handled by ssh_module.py, not here

        self._logger.info("executor", "Command executor initialized", {
            "available_handlers": list(self._handlers.keys()),
        })

    async def execute(self, command: ParsedCommand) -> dict[str, Any]:
        """
        Execute a validated and approved command.
        Returns a result dict with 'success', 'result', and 'error' keys.
        """
        if not command.approved:
            self._logger.log_security_event("unapproved_execution_attempt", {
                "command": command.name,
            })
            return {"success": False, "error": "Command not approved", "result": None}

        handler = self._handlers.get(command.name)
        if handler is None:
            # Command might be handled by another module (e.g., SSH)
            return {
                "success": False,
                "error": f"No local handler for '{command.name}'",
                "result": None,
            }

        start = time.monotonic()
        try:
            result = await handler(command.params)
            duration_ms = (time.monotonic() - start) * 1000
            self._logger.log_execution_result(
                command.name, True, result, duration_ms
            )
            return {"success": True, "result": result, "error": None}
        except Exception as e:
            duration_ms = (time.monotonic() - start) * 1000
            self._logger.log_execution_result(
                command.name, False, str(e), duration_ms
            )
            return {"success": False, "result": None, "error": str(e)}

    def _is_path_allowed(self, path_str: str) -> bool:
        """Check if a filesystem path is within allowed directories."""
        try:
            resolved = Path(path_str).resolve()
        except (ValueError, OSError):
            return False

        # Check blocked paths first
        for blocked in self._blocked_paths:
            if resolved == blocked or blocked in resolved.parents:
                return False

        # Check allowed paths
        for allowed in self._allowed_paths:
            if resolved == allowed or allowed in resolved.parents:
                return True

        return False

    # ── Command Handlers ────────────────────────────────────

    async def _handle_system_status(self, params: dict) -> dict:
        """Get local system status — CPU, memory, disk."""
        import psutil

        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage("/")

        return {
            "cpu_percent": cpu_percent,
            "memory": {
                "total_gb": round(memory.total / (1024**3), 2),
                "used_gb": round(memory.used / (1024**3), 2),
                "percent": memory.percent,
            },
            "disk": {
                "total_gb": round(disk.total / (1024**3), 2),
                "used_gb": round(disk.used / (1024**3), 2),
                "percent": round(disk.percent, 1),
            },
            "platform": platform.platform(),
            "hostname": platform.node(),
        }

    async def _handle_get_time(self, params: dict) -> dict:
        """Get current date and time."""
        now = datetime.now(timezone.utc)
        local_now = datetime.now()
        return {
            "utc": now.isoformat(),
            "local": local_now.isoformat(),
            "timezone": str(time.tzname),
        }

    async def _handle_list_files(self, params: dict) -> dict:
        """List files in a whitelisted directory."""
        path_str = params.get("path", "")
        if not path_str:
            return {"error": "No path provided"}

        if not self._is_path_allowed(path_str):
            self._logger.log_security_event("path_not_allowed", {
                "path": path_str, "command": "list_files",
            })
            return {"error": f"Path not in allowed directories: {path_str}"}

        path = Path(path_str)
        if not path.is_dir():
            return {"error": f"Not a directory: {path_str}"}

        entries = []
        for entry in sorted(path.iterdir()):
            entries.append({
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "size": entry.stat().st_size if entry.is_file() else None,
            })
        return {"path": path_str, "entries": entries}

    async def _handle_read_file(self, params: dict) -> dict:
        """Read contents of a whitelisted file."""
        path_str = params.get("path", "")
        if not path_str:
            return {"error": "No path provided"}

        if not self._is_path_allowed(path_str):
            self._logger.log_security_event("path_not_allowed", {
                "path": path_str, "command": "read_file",
            })
            return {"error": f"Path not in allowed directories: {path_str}"}

        path = Path(path_str)
        if not path.is_file():
            return {"error": f"Not a file: {path_str}"}

        # Limit file size to prevent memory issues
        max_size = 1024 * 1024  # 1 MB
        if path.stat().st_size > max_size:
            return {"error": f"File too large (>{max_size} bytes)"}

        content = path.read_text(errors="replace")
        return {"path": path_str, "content": content, "size": len(content)}

    async def _handle_run_script(self, params: dict) -> dict:
        """Run a pre-approved script from the scripts directory."""
        script_name = params.get("script_name", "")
        if not script_name:
            return {"error": "No script_name provided"}

        # Only allow alphanumeric + underscore/hyphen in script names
        import re
        if not re.match(r'^[a-zA-Z0-9_\-]+\.sh$', script_name):
            self._logger.log_security_event("invalid_script_name", {
                "script_name": script_name,
            })
            return {"error": "Invalid script name (must be alphanumeric .sh)"}

        script_path = self._scripts_dir / script_name
        if not script_path.is_file():
            return {"error": f"Script not found: {script_name}"}

        # Execute with a timeout, capture output
        try:
            result = subprocess.run(
                ["/bin/bash", str(script_path)],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self._scripts_dir),
                env={**os.environ, "HOME_AI_SCRIPT": "1"},
            )
            return {
                "script": script_name,
                "exit_code": result.returncode,
                "stdout": result.stdout[:5000],
                "stderr": result.stderr[:2000],
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Script timed out: {script_name}"}

    async def _handle_restart_service(self, params: dict) -> dict:
        """Restart a whitelisted systemd service."""
        service = params.get("service", "")
        if not service:
            return {"error": "No service name provided"}

        # Only allow simple service names
        import re
        if not re.match(r'^[a-zA-Z0-9_\-]+$', service):
            self._logger.log_security_event("invalid_service_name", {
                "service": service,
            })
            return {"error": "Invalid service name"}

        # Allowed services should be further restricted via config
        allowed_services = {"nginx", "docker", "home-assistant"}
        if service not in allowed_services:
            return {"error": f"Service '{service}' not in allowed list"}

        try:
            result = subprocess.run(
                ["systemctl", "restart", service],
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "service": service,
                "exit_code": result.returncode,
                "stdout": result.stdout[:2000],
                "stderr": result.stderr[:2000],
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Service restart timed out: {service}"}

    async def _handle_send_notification(self, params: dict) -> dict:
        """Send a notification (placeholder — wire to actual notification system)."""
        message = params.get("message", "")
        if not message:
            return {"error": "No message provided"}

        # Truncate to prevent abuse
        message = message[:500]

        # Placeholder: log the notification
        self._logger.info("notification", f"Notification sent: {message}")
        return {"sent": True, "message": message}

    async def _handle_smart_home(self, params: dict) -> dict:
        """Control smart home devices (placeholder)."""
        device = params.get("device", "")
        action = params.get("action", "")

        if not device or not action:
            return {"error": "device and action are required"}

        # Placeholder: would integrate with Home Assistant, etc.
        self._logger.info("smart_home", f"Smart home: {device} → {action}")
        return {
            "device": device,
            "action": action,
            "status": "executed (placeholder)",
        }
