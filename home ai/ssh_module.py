"""
Home AI Assistant - SSH Execution Module
=========================================
Handles secure remote command execution via SSH.

SECURITY RULES:
- The AI NEVER opens SSH connections directly
- Only whitelisted hosts are reachable
- Only whitelisted commands per host are executable
- Authentication is key-based only (no passwords)
- All SSH activity is logged
- Connection timeouts are enforced
"""

import asyncio
import os
from pathlib import Path
from typing import Any, Optional

import asyncssh

from command_parser import ParsedCommand
from logger import HomeAILogger


class SSHModule:
    """
    Secure SSH execution layer.
    Only pre-approved commands on pre-approved hosts.
    """

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("ssh", {})
        self._logger = logger
        self._enabled = self._config.get("enabled", False)

        # Build host lookup: name -> host config
        self._hosts: dict[str, dict] = {}
        for host_cfg in self._config.get("allowed_hosts", []):
            name = host_cfg.get("name", host_cfg.get("host", ""))
            self._hosts[name] = host_cfg
            # Also allow lookup by IP/hostname
            self._hosts[host_cfg.get("host", "")] = host_cfg

        self._key_path = os.path.expanduser(
            self._config.get("key_path", "~/.ssh/home_ai_key")
        )
        self._conn_timeout = self._config.get("connection_timeout", 10)
        self._cmd_timeout = self._config.get("command_timeout", 30)

        self._logger.info("ssh_module", "SSH module initialized", {
            "enabled": self._enabled,
            "allowed_hosts": list(self._hosts.keys()),
        })

    async def execute(self, command: ParsedCommand) -> dict[str, Any]:
        """
        Execute an SSH command on a whitelisted remote host.
        The command must already be validated and approved.
        """
        if not self._enabled:
            return {"success": False, "error": "SSH module is disabled", "result": None}

        if not command.approved:
            self._logger.log_security_event("unapproved_ssh_attempt", {
                "command": command.name,
                "params": command.params,
            })
            return {"success": False, "error": "Command not approved", "result": None}

        host_name = command.params.get("host", "")
        remote_cmd = command.params.get("command", "")

        # Validate host
        host_cfg = self._hosts.get(host_name)
        if host_cfg is None:
            self._logger.log_security_event("ssh_host_not_whitelisted", {
                "host": host_name,
            })
            return {
                "success": False,
                "error": f"Host '{host_name}' is not whitelisted",
                "result": None,
            }

        # Validate command against host's allowed commands
        allowed_cmds = host_cfg.get("allowed_commands", [])
        if remote_cmd not in allowed_cmds:
            self._logger.log_security_event("ssh_command_not_allowed", {
                "host": host_name,
                "command": remote_cmd,
                "allowed": allowed_cmds,
            })
            return {
                "success": False,
                "error": f"Command '{remote_cmd}' not allowed on host '{host_name}'",
                "result": None,
            }

        # Execute the SSH command
        return await self._run_ssh(host_cfg, remote_cmd)

    async def _run_ssh(self, host_cfg: dict, remote_cmd: str) -> dict[str, Any]:
        """Execute a single command over SSH with key-based auth."""
        host = host_cfg["host"]
        user = host_cfg.get("user", "root")
        host_name = host_cfg.get("name", host)

        self._logger.info("ssh_module", f"SSH executing on {host_name}", {
            "host": host,
            "user": user,
            "command": remote_cmd,
        })

        # Verify key file exists
        if not Path(self._key_path).is_file():
            return {
                "success": False,
                "error": f"SSH key not found: {self._key_path}",
                "result": None,
            }

        try:
            async with asyncssh.connect(
                host,
                username=user,
                client_keys=[self._key_path],
                known_hosts=None,  # In production, use a known_hosts file
                connect_timeout=self._conn_timeout,
            ) as conn:
                result = await asyncio.wait_for(
                    conn.run(remote_cmd, check=False),
                    timeout=self._cmd_timeout,
                )

                output = {
                    "host": host_name,
                    "command": remote_cmd,
                    "exit_code": result.exit_status,
                    "stdout": (result.stdout or "")[:5000],
                    "stderr": (result.stderr or "")[:2000],
                }

                success = result.exit_status == 0
                self._logger.log_execution_result(
                    f"ssh:{host_name}:{remote_cmd}",
                    success, output, 0
                )

                return {"success": success, "result": output, "error": None}

        except asyncio.TimeoutError:
            error = f"SSH command timed out on {host_name}"
            self._logger.error("ssh_module", error)
            return {"success": False, "error": error, "result": None}
        except asyncssh.Error as e:
            error = f"SSH error on {host_name}: {e}"
            self._logger.error("ssh_module", error)
            return {"success": False, "error": error, "result": None}
        except OSError as e:
            error = f"Connection failed to {host_name}: {e}"
            self._logger.error("ssh_module", error)
            return {"success": False, "error": error, "result": None}

    def list_hosts(self) -> list[dict]:
        """Return list of whitelisted hosts and their allowed commands."""
        seen = set()
        hosts = []
        for cfg in self._config.get("allowed_hosts", []):
            name = cfg.get("name", cfg.get("host"))
            if name not in seen:
                seen.add(name)
                hosts.append({
                    "name": name,
                    "host": cfg["host"],
                    "allowed_commands": cfg.get("allowed_commands", []),
                })
        return hosts
