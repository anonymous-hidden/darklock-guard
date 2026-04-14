"""
Nova — Pi5 SSH Connector
===========================
Manages SSH connections to the Raspberry Pi 5 running Darklock servers.
Supports:
  • Remote command execution (whitelisted)
  • Service management (systemctl)
  • Health checks (CPU, memory, disk, uptime)
  • Darklock server restart

Uses asyncssh for non-blocking SSH.  Falls back to subprocess ssh if needed.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Optional


# Commands that Nova is allowed to run on the Pi5
_ALLOWED_COMMANDS = {
    # Health / diagnostics
    "uptime", "free -m", "df -h", "top -bn1 | head -20",
    "cat /proc/loadavg", "vcgencmd measure_temp",
    "cat /proc/uptime",

    # Darklock process management (runs as node, not systemd)
    "pgrep -af 'darklock/start.js'",
    "pgrep -af 'node'",
    "pgrep -a node",

    # Logs (tail only — no cat of full log)
    "tail -n 30 /home/darklock/discord-bot/logs/darklock.log",
    "tail -n 50 /home/darklock/discord-bot/logs/darklock.log",
    "ls -lt /home/darklock/discord-bot/logs/ | head -10",
    "journalctl --user -n 30 --no-pager",

    # Network
    "ss -tlnp | grep -E '3001|3002'",
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/health",
}


@dataclass
class SSHResult:
    """Result of an SSH command execution."""
    command: str
    stdout: str
    stderr: str
    exit_code: int
    latency_ms: float
    success: bool

    def to_dict(self) -> dict:
        return {
            "command": self.command,
            "stdout": self.stdout[:2000],
            "stderr": self.stderr[:500],
            "exit_code": self.exit_code,
            "latency_ms": round(self.latency_ms, 1),
            "success": self.success,
        }


@dataclass
class Pi5Health:
    """Snapshot of Pi5 system health."""
    online: bool
    cpu_temp: Optional[str] = None
    load_avg: Optional[str] = None
    memory: Optional[str] = None
    disk: Optional[str] = None
    uptime: Optional[str] = None
    darklock_active: bool = False
    darklock_ports: Optional[str] = None
    latency_ms: float = 0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}

    def summary(self) -> str:
        if not self.online:
            return f"Pi5 is OFFLINE: {self.error or 'unreachable'}"
        parts = [f"Pi5 online (ping {self.latency_ms:.0f}ms)"]
        if self.cpu_temp:
            parts.append(f"CPU: {self.cpu_temp}")
        if self.load_avg:
            parts.append(f"Load: {self.load_avg}")
        if self.memory:
            parts.append(f"RAM: {self.memory}")
        if self.disk:
            parts.append(f"Disk: {self.disk}")
        if self.uptime:
            parts.append(f"Up: {self.uptime}")
        dl = "running" if self.darklock_active else "DOWN"
        parts.append(f"Darklock: {dl}")
        return " | ".join(parts)


class Pi5SSHClient:
    """SSH client for the Raspberry Pi 5."""

    def __init__(self, host: str, user: str, key_path: Optional[str] = None,
                 port: int = 22, audit=None):
        self.host = host
        self.user = user
        self.port = port
        self.key_path = key_path
        self._audit = audit
        self._asyncssh = None

    def _log(self, event: str, data: dict):
        if self._audit:
            self._audit.log("pi5_ssh", event, data)

    def _is_allowed(self, cmd: str) -> bool:
        """Check if command is in the whitelist."""
        cmd_stripped = cmd.strip()
        # Exact match
        if cmd_stripped in _ALLOWED_COMMANDS:
            return True
        # Prefix match for parameterized commands
        for allowed in _ALLOWED_COMMANDS:
            if cmd_stripped.startswith(allowed.split()[0]) and \
               cmd_stripped in _ALLOWED_COMMANDS:
                return True
        return False

    async def run(self, command: str) -> SSHResult:
        """Execute a whitelisted command on the Pi5 via SSH."""
        if not self._is_allowed(command):
            self._log("blocked", {"command": command, "reason": "not whitelisted"})
            return SSHResult(
                command=command, stdout="", stderr="Command not allowed",
                exit_code=-1, latency_ms=0, success=False,
            )

        self._log("execute", {"command": command, "host": self.host})
        t0 = time.time()

        try:
            # Try asyncssh first (cleaner, non-blocking)
            if self._asyncssh is None:
                try:
                    import asyncssh
                    self._asyncssh = asyncssh
                except ImportError:
                    self._asyncssh = False

            if self._asyncssh:
                return await self._run_asyncssh(command, t0)
            else:
                return await self._run_subprocess(command, t0)

        except Exception as e:
            latency = (time.time() - t0) * 1000
            self._log("error", {"command": command, "error": str(e)[:200]})
            return SSHResult(
                command=command, stdout="", stderr=str(e)[:500],
                exit_code=-1, latency_ms=latency, success=False,
            )

    async def _run_asyncssh(self, command: str, t0: float) -> SSHResult:
        """Execute via asyncssh."""
        connect_args = {
            "host": self.host,
            "port": self.port,
            "username": self.user,
            "known_hosts": None,  # Pi5 on local LAN
        }
        if self.key_path:
            connect_args["client_keys"] = [self.key_path]

        async with self._asyncssh.connect(**connect_args) as conn:
            result = await asyncio.wait_for(conn.run(command), timeout=30)
            latency = (time.time() - t0) * 1000
            success = result.exit_status == 0
            self._log("result", {
                "command": command, "exit_code": result.exit_status,
                "latency_ms": round(latency, 1), "success": success,
            })
            return SSHResult(
                command=command,
                stdout=(result.stdout or "").strip(),
                stderr=(result.stderr or "").strip(),
                exit_code=result.exit_status or 0,
                latency_ms=latency,
                success=success,
            )

    async def _run_subprocess(self, command: str, t0: float) -> SSHResult:
        """Fallback: execute via subprocess ssh."""
        ssh_cmd = ["ssh", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]
        if self.key_path:
            ssh_cmd += ["-i", self.key_path]
        ssh_cmd += ["-p", str(self.port), f"{self.user}@{self.host}", command]

        proc = await asyncio.create_subprocess_exec(
            *ssh_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            latency = (time.time() - t0) * 1000
            return SSHResult(command=command, stdout="", stderr="SSH timeout (30s)",
                             exit_code=-1, latency_ms=latency, success=False)

        latency = (time.time() - t0) * 1000
        success = proc.returncode == 0
        self._log("result", {
            "command": command, "exit_code": proc.returncode,
            "latency_ms": round(latency, 1), "success": success,
        })
        return SSHResult(
            command=command,
            stdout=stdout.decode(errors="replace").strip(),
            stderr=stderr.decode(errors="replace").strip(),
            exit_code=proc.returncode or 0,
            latency_ms=latency,
            success=success,
        )

    async def health_check(self) -> Pi5Health:
        """Run a comprehensive health check on the Pi5."""
        health = Pi5Health(online=False)
        t0 = time.time()

        # Quick connectivity check
        try:
            r = await self.run("cat /proc/uptime")
            if not r.success:
                health.error = r.stderr or "SSH connection failed"
                health.latency_ms = r.latency_ms
                return health
        except Exception as e:
            health.error = str(e)[:200]
            return health

        health.online = True
        health.latency_ms = r.latency_ms

        # Parse uptime
        try:
            secs = float(r.stdout.split()[0])
            days = int(secs // 86400)
            hours = int((secs % 86400) // 3600)
            health.uptime = f"{days}d {hours}h" if days else f"{hours}h {int((secs % 3600) // 60)}m"
        except Exception:
            pass

        # Gather remaining checks in parallel
        results = await asyncio.gather(
            self.run("vcgencmd measure_temp"),
            self.run("cat /proc/loadavg"),
            self.run("free -m"),
            self.run("df -h"),
            self.run("pgrep -af 'darklock/start.js'"),
            self.run("ss -tlnp | grep -E '3001|3002'"),
            return_exceptions=True,
        )

        # CPU temperature
        if isinstance(results[0], SSHResult) and results[0].success:
            health.cpu_temp = results[0].stdout.replace("temp=", "").strip()

        # Load average
        if isinstance(results[1], SSHResult) and results[1].success:
            health.load_avg = results[1].stdout.split()[:3]
            health.load_avg = " ".join(health.load_avg) if isinstance(health.load_avg, list) else str(health.load_avg)

        # Memory
        if isinstance(results[2], SSHResult) and results[2].success:
            lines = results[2].stdout.splitlines()
            for line in lines:
                if line.startswith("Mem:"):
                    parts = line.split()
                    if len(parts) >= 3:
                        health.memory = f"{parts[2]}MB / {parts[1]}MB used"
                    break

        # Disk
        if isinstance(results[3], SSHResult) and results[3].success:
            lines = results[3].stdout.splitlines()
            for line in lines:
                if line.strip().endswith("/"):
                    parts = line.split()
                    if len(parts) >= 5:
                        health.disk = f"{parts[4]} used ({parts[2]} / {parts[1]})"
                    break

        # Darklock process (detected via pgrep, not systemd)
        if isinstance(results[4], SSHResult) and results[4].success:
            health.darklock_active = len(results[4].stdout.strip()) > 0

        # Ports
        if isinstance(results[5], SSHResult) and results[5].success:
            health.darklock_ports = results[5].stdout.strip() or "no listening ports"

        health.latency_ms = (time.time() - t0) * 1000
        self._log("health_check", health.to_dict())
        return health

    async def restart_darklock(self) -> SSHResult:
        """Restart Darklock by killing and re-launching the node process."""
        self._log("restart_darklock", {"host": self.host})
        # Kill existing, then re-launch from the discord-bot dir
        restart_cmd = (
            "pkill -f 'darklock/start.js'; "
            "sleep 2; "
            "cd /home/darklock/discord-bot && "
            "nohup node darklock/start.js > logs/darklock.log 2>&1 &"
        )
        _ALLOWED_COMMANDS.add(restart_cmd)
        return await self.run(restart_cmd)

    async def darklock_status(self) -> SSHResult:
        """Check if Darklock node process is running."""
        return await self.run("pgrep -af 'darklock/start.js'")

    async def darklock_logs(self, lines: int = 30) -> SSHResult:
        """Get recent Darklock logs."""
        n = min(lines, 50)
        cmd = f"tail -n {n} /home/darklock/discord-bot/logs/darklock.log"
        if cmd not in _ALLOWED_COMMANDS:
            _ALLOWED_COMMANDS.add(cmd)
        return await self.run(cmd)
