"""
Nova — Process Manager
========================
Spawns, monitors, and kills long-running processes.
Each process is tracked with a unique ID, stdout/stderr capture,
resource usage, and lifecycle state.

This is the core of Nova acting like JARVIS — managing things in the background.
"""

import asyncio
import logging
import os
import signal
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Callable

import psutil

logger = logging.getLogger(__name__)


class ProcessState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    KILLED = "killed"
    TIMEOUT = "timeout"


@dataclass
class ManagedProcess:
    """A single tracked process."""
    id: str
    name: str
    command: str
    state: ProcessState = ProcessState.PENDING
    pid: int | None = None
    exit_code: int | None = None
    stdout_lines: list[str] = field(default_factory=list)
    stderr_lines: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    timeout_seconds: int = 0
    cwd: str | None = None
    max_output_lines: int = 500

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "command": self.command,
            "state": self.state.value,
            "pid": self.pid,
            "exit_code": self.exit_code,
            "stdout_tail": self.stdout_lines[-50:],
            "stderr_tail": self.stderr_lines[-20:],
            "created_at": datetime.fromtimestamp(self.created_at).isoformat(),
            "started_at": datetime.fromtimestamp(self.started_at).isoformat() if self.started_at else None,
            "finished_at": datetime.fromtimestamp(self.finished_at).isoformat() if self.finished_at else None,
            "runtime_seconds": round(
                (self.finished_at or time.time()) - self.started_at, 1
            ) if self.started_at else 0,
            "cpu_percent": self.cpu_percent,
            "memory_mb": round(self.memory_mb, 1),
        }

    @property
    def is_alive(self) -> bool:
        return self.state in (ProcessState.PENDING, ProcessState.RUNNING)


class ProcessManager:
    """
    Manages spawned subprocesses with full lifecycle tracking.
    
    Features:
      - Spawn async subprocesses with stdout/stderr capture
      - Background monitor thread polls resource usage
      - Kill by ID, name pattern, or PID
      - Timeout enforcement
      - Max concurrent process limit
      - Blocked command patterns (security)
    """

    # Commands that are NEVER allowed no matter what
    _BLOCKED_PATTERNS = [
        "rm -rf /", "rm -rf /*", "mkfs", ":(){:|:&};:",
        "dd if=", "> /dev/sd", "chmod -R 777 /",
        "wget | sh", "curl | sh", "wget | bash", "curl | bash",
    ]

    def __init__(self, config, audit, activity_tracker, max_concurrent: int = 10):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker
        self._max_concurrent = max_concurrent
        self._processes: dict[str, ManagedProcess] = {}
        self._async_procs: dict[str, asyncio.subprocess.Process] = {}
        self._monitor_running: bool = False
        self._callbacks: list[Callable] = []

    # ── Lifecycle ──────────────────────────────────

    def on_process_change(self, callback: Callable):
        """Register a callback for process state changes: callback(process_dict)"""
        self._callbacks.append(callback)

    def _notify(self, proc: ManagedProcess):
        for cb in self._callbacks:
            try:
                cb(proc.to_dict())
            except Exception as e:
                logger.error(f"Process callback error: {e}")

    # ── Spawn ──────────────────────────────────────

    async def spawn(
        self,
        command: str,
        name: str = "",
        cwd: str | None = None,
        timeout: int = 0,
        env: dict | None = None,
    ) -> ManagedProcess:
        """Spawn a new tracked subprocess."""

        # Security: block dangerous commands
        cmd_lower = command.lower().strip()
        for blocked in self._BLOCKED_PATTERNS:
            if blocked in cmd_lower:
                self._audit.log("process_manager", "blocked", {
                    "command": command, "reason": f"matched blocked pattern: {blocked}",
                })
                raise PermissionError(f"Blocked dangerous command: {command}")

        # Limit concurrent
        alive = sum(1 for p in self._processes.values() if p.is_alive)
        if alive >= self._max_concurrent:
            raise RuntimeError(f"Max concurrent processes ({self._max_concurrent}) reached")

        proc_id = uuid.uuid4().hex[:10]
        managed = ManagedProcess(
            id=proc_id,
            name=name or command.split()[0] if command else "unknown",
            command=command,
            timeout_seconds=timeout,
            cwd=cwd,
        )
        self._processes[proc_id] = managed

        self._audit.log("process_manager", "spawning", {
            "id": proc_id, "name": managed.name, "command": command,
        })

        # Build environment
        proc_env = os.environ.copy()
        if env:
            proc_env.update(env)

        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd or os.path.expanduser("~"),
                env=proc_env,
                preexec_fn=os.setsid,  # own process group for clean kill
            )
            managed.pid = proc.pid
            managed.state = ProcessState.RUNNING
            managed.started_at = time.time()
            self._async_procs[proc_id] = proc

            self._audit.log("process_manager", "started", {
                "id": proc_id, "pid": proc.pid, "name": managed.name,
            })
            self._activity.system_event(
                f"Process started: {managed.name}",
                details={"id": proc_id, "pid": proc.pid, "command": command},
            )
            self._notify(managed)

            # Background task to read output and wait for completion
            asyncio.create_task(self._watch_process(proc_id))

        except Exception as e:
            managed.state = ProcessState.FAILED
            managed.stderr_lines.append(str(e))
            managed.finished_at = time.time()
            self._audit.log("process_manager", "spawn_failed", {
                "id": proc_id, "error": str(e),
            })
            self._notify(managed)

        return managed

    async def _watch_process(self, proc_id: str):
        """Background: read stdout/stderr and handle completion."""
        managed = self._processes.get(proc_id)
        proc = self._async_procs.get(proc_id)
        if not managed or not proc:
            return

        async def read_stream(stream, lines_list):
            while True:
                line = await stream.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip("\n")
                lines_list.append(text)
                # Trim to max
                if len(lines_list) > managed.max_output_lines:
                    lines_list[:] = lines_list[-managed.max_output_lines:]

        # Read stdout and stderr concurrently
        tasks = [
            asyncio.create_task(read_stream(proc.stdout, managed.stdout_lines)),
            asyncio.create_task(read_stream(proc.stderr, managed.stderr_lines)),
        ]

        # Handle timeout
        timeout = managed.timeout_seconds if managed.timeout_seconds > 0 else None
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            managed.state = ProcessState.TIMEOUT
            await self.kill(proc_id, reason="timeout")
            return

        # Wait for output readers to finish
        await asyncio.gather(*tasks, return_exceptions=True)

        managed.exit_code = proc.returncode
        managed.finished_at = time.time()
        managed.state = ProcessState.COMPLETED if proc.returncode == 0 else ProcessState.FAILED

        self._audit.log("process_manager", "finished", {
            "id": proc_id, "exit_code": proc.returncode,
            "runtime": round(managed.finished_at - (managed.started_at or managed.created_at), 1),
        })
        self._activity.system_event(
            f"Process finished: {managed.name} (exit {proc.returncode})",
            details={"id": proc_id, "exit_code": proc.returncode},
        )
        self._notify(managed)

        # Clean up async proc reference
        self._async_procs.pop(proc_id, None)

    # ── Kill ───────────────────────────────────────

    async def kill(self, proc_id: str, reason: str = "user_request") -> bool:
        """Kill a process by ID."""
        managed = self._processes.get(proc_id)
        if not managed:
            return False

        proc = self._async_procs.get(proc_id)
        if proc and proc.returncode is None:
            try:
                # Kill the entire process group
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                # Give it 3 seconds to die gracefully
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3)
                except asyncio.TimeoutError:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass

        managed.state = ProcessState.KILLED
        managed.finished_at = time.time()
        self._async_procs.pop(proc_id, None)

        self._audit.log("process_manager", "killed", {
            "id": proc_id, "pid": managed.pid, "reason": reason,
        })
        self._activity.system_event(
            f"Process killed: {managed.name}",
            details={"id": proc_id, "reason": reason},
        )
        self._notify(managed)
        return True

    async def kill_by_name(self, name_pattern: str) -> list[str]:
        """Kill all running processes matching a name pattern."""
        killed = []
        for pid, proc in list(self._processes.items()):
            if proc.is_alive and name_pattern.lower() in proc.name.lower():
                await self.kill(pid, reason=f"name_match:{name_pattern}")
                killed.append(pid)
        return killed

    # ── Query ──────────────────────────────────────

    def list_processes(self, include_dead: bool = False) -> list[dict]:
        """List all (or only alive) processes."""
        procs = []
        for p in self._processes.values():
            if include_dead or p.is_alive:
                procs.append(p.to_dict())
        return procs

    def get_process(self, proc_id: str) -> dict | None:
        p = self._processes.get(proc_id)
        return p.to_dict() if p else None

    def get_output(self, proc_id: str, tail: int = 100) -> dict | None:
        """Get stdout/stderr from a process."""
        p = self._processes.get(proc_id)
        if not p:
            return None
        return {
            "id": proc_id,
            "stdout": p.stdout_lines[-tail:],
            "stderr": p.stderr_lines[-tail:],
            "state": p.state.value,
        }

    @property
    def alive_count(self) -> int:
        return sum(1 for p in self._processes.values() if p.is_alive)

    # ── Resource monitoring ────────────────────────

    async def update_resource_usage(self):
        """Poll resource usage of all running processes."""
        for proc_id, managed in self._processes.items():
            if not managed.is_alive or not managed.pid:
                continue
            try:
                ps = psutil.Process(managed.pid)
                managed.cpu_percent = ps.cpu_percent(interval=0)
                managed.memory_mb = ps.memory_info().rss / (1024 * 1024)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

    def start_monitor(self, interval: float = 5.0):
        """Start background resource monitoring loop."""
        if self._monitor_running:
            return
        self._monitor_running = True
        import threading
        async def _loop():
            while self._monitor_running:
                await self.update_resource_usage()
                await asyncio.sleep(interval)
        def _run():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(_loop())
        t = threading.Thread(target=_run, daemon=True, name="process-monitor")
        t.start()

    # ── Cleanup ────────────────────────────────────

    async def kill_all(self, reason: str = "shutdown"):
        """Kill all running processes (used during shutdown)."""
        for proc_id in list(self._processes.keys()):
            if self._processes[proc_id].is_alive:
                await self.kill(proc_id, reason=reason)

    def cleanup_dead(self, max_age_seconds: int = 3600):
        """Remove completed/failed processes older than max_age."""
        now = time.time()
        to_remove = []
        for pid, proc in self._processes.items():
            if not proc.is_alive and proc.finished_at:
                if now - proc.finished_at > max_age_seconds:
                    to_remove.append(pid)
        for pid in to_remove:
            del self._processes[pid]
