"""
Nova — Service Overseer
========================
Manages long-running services with health checks, auto-restart,
dependency ordering, and uptime tracking. Think JARVIS keeping
every system in Stark Tower running.

Services are registered with:
  - name, start command, working directory
  - health check (HTTP endpoint, TCP port, or process-alive)
  - restart policy (max retries, backoff)
  - dependencies (start after X, stop before X)
"""

import asyncio
import enum
import json
import socket
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx


class ServiceState(str, enum.Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    UNHEALTHY = "unhealthy"
    RESTARTING = "restarting"
    FAILED = "failed"       # exceeded max retries


class HealthCheckType(str, enum.Enum):
    HTTP = "http"           # GET url, expect 2xx
    TCP = "tcp"             # connect to host:port
    PROCESS = "process"     # just check PID alive


@dataclass
class HealthCheck:
    check_type: HealthCheckType = HealthCheckType.PROCESS
    url: str = ""             # for HTTP
    host: str = "127.0.0.1"  # for TCP
    port: int = 0             # for TCP
    timeout_seconds: float = 5.0
    interval_seconds: float = 15.0
    unhealthy_threshold: int = 3    # consecutive fails before UNHEALTHY


@dataclass
class RestartPolicy:
    max_retries: int = 5
    backoff_base: float = 2.0       # seconds — doubles each retry
    backoff_max: float = 60.0
    cooldown_after_failure: float = 300.0   # 5 min before retrying a FAILED service


@dataclass
class ServiceDef:
    """Immutable definition of a service."""
    name: str
    command: str
    cwd: str = ""
    env: dict = field(default_factory=dict)
    health: HealthCheck = field(default_factory=HealthCheck)
    restart: RestartPolicy = field(default_factory=RestartPolicy)
    depends_on: list[str] = field(default_factory=list)
    autostart: bool = True
    description: str = ""


@dataclass
class ServiceRuntime:
    """Mutable runtime state for a service."""
    state: ServiceState = ServiceState.STOPPED
    pid: int | None = None
    proc_id: str | None = None          # ProcessManager ID
    started_at: float | None = None
    last_healthy: float | None = None
    consecutive_failures: int = 0
    total_restarts: int = 0
    retry_count: int = 0
    last_error: str = ""
    uptime_seconds: float = 0.0

    def to_dict(self) -> dict:
        return {
            "state": self.state.value,
            "pid": self.pid,
            "proc_id": self.proc_id,
            "started_at": self.started_at,
            "last_healthy": self.last_healthy,
            "consecutive_failures": self.consecutive_failures,
            "total_restarts": self.total_restarts,
            "retry_count": self.retry_count,
            "last_error": self.last_error,
            "uptime_seconds": round(self.uptime_seconds, 1),
        }


class ServiceOverseer:
    """
    Central service manager — registers, starts, monitors, and
    auto-restarts services with dependency ordering and backoff.
    """

    def __init__(self, process_manager, audit, activity_tracker):
        self._pm = process_manager
        self._audit = audit
        self._activity = activity_tracker

        self._services: dict[str, ServiceDef] = {}
        self._runtime: dict[str, ServiceRuntime] = {}
        self._callbacks: list[Callable] = []

        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    # ── Registration ──────────────────────────────

    def register(self, svc: ServiceDef):
        """Register a service definition."""
        with self._lock:
            self._services[svc.name] = svc
            if svc.name not in self._runtime:
                self._runtime[svc.name] = ServiceRuntime()
        self._audit.log("overseer", "registered", {"service": svc.name})

    def register_from_config(self, services_config: list[dict]):
        """Bulk-register from config.yaml services list."""
        for s in (services_config or []):
            health_cfg = s.get("health", {})
            restart_cfg = s.get("restart", {})
            svc = ServiceDef(
                name=s["name"],
                command=s.get("command", ""),
                cwd=s.get("cwd", ""),
                env=s.get("env", {}),
                health=HealthCheck(
                    check_type=HealthCheckType(health_cfg.get("type", "process")),
                    url=health_cfg.get("url", ""),
                    host=health_cfg.get("host", "127.0.0.1"),
                    port=health_cfg.get("port", 0),
                    timeout_seconds=health_cfg.get("timeout", 5),
                    interval_seconds=health_cfg.get("interval", 15),
                    unhealthy_threshold=health_cfg.get("unhealthy_threshold", 3),
                ),
                restart=RestartPolicy(
                    max_retries=restart_cfg.get("max_retries", 5),
                    backoff_base=restart_cfg.get("backoff_base", 2.0),
                    backoff_max=restart_cfg.get("backoff_max", 60.0),
                ),
                depends_on=s.get("depends_on", []),
                autostart=s.get("autostart", True),
                description=s.get("description", ""),
            )
            self.register(svc)

    def on_state_change(self, callback: Callable):
        """Register callback: fn(service_name, old_state, new_state, runtime_dict)"""
        self._callbacks.append(callback)

    # ── Start / Stop ──────────────────────────────

    async def start_service(self, name: str) -> bool:
        """Start a single service (respecting dependencies)."""
        svc = self._services.get(name)
        if not svc:
            return False

        rt = self._runtime[name]
        if rt.state in (ServiceState.RUNNING, ServiceState.STARTING):
            return True

        # Check dependencies are running
        for dep in svc.depends_on:
            dep_rt = self._runtime.get(dep)
            if not dep_rt or dep_rt.state != ServiceState.RUNNING:
                self._audit.log("overseer", "dep_wait", {
                    "service": name, "waiting_for": dep,
                })
                # Try to start the dependency
                await self.start_service(dep)
                # Wait a bit for it to come up
                for _ in range(10):
                    if self._runtime.get(dep, ServiceRuntime()).state == ServiceState.RUNNING:
                        break
                    await asyncio.sleep(1)

        self._set_state(name, ServiceState.STARTING)

        try:
            proc = await self._pm.spawn(
                command=svc.command,
                name=f"svc:{svc.name}",
                cwd=svc.cwd or None,
                env=svc.env or None,
            )
            rt.proc_id = proc.id
            rt.pid = proc.pid
            rt.started_at = time.time()
            rt.retry_count = 0

            self._audit.log("overseer", "started", {
                "service": name, "pid": proc.pid, "proc_id": proc.id,
            })
            self._activity.system_event(
                f"Service {name} started (PID {proc.pid})")

            # Give it a moment, then run first health check
            await asyncio.sleep(2)
            healthy = await self._check_health(name)
            if healthy:
                self._set_state(name, ServiceState.RUNNING)
            else:
                # May still be starting — keep it in STARTING, health loop will promote
                pass

            return True

        except Exception as e:
            rt.last_error = str(e)
            self._set_state(name, ServiceState.FAILED)
            self._audit.log("overseer", "start_failed", {
                "service": name, "error": str(e),
            })
            return False

    async def stop_service(self, name: str, reason: str = "manual") -> bool:
        """Stop a service gracefully."""
        rt = self._runtime.get(name)
        if not rt or rt.state == ServiceState.STOPPED:
            return True

        # Stop dependents first (reverse dependency)
        for svc_name, svc_def in self._services.items():
            if name in svc_def.depends_on:
                dep_rt = self._runtime.get(svc_name)
                if dep_rt and dep_rt.state in (ServiceState.RUNNING, ServiceState.UNHEALTHY):
                    await self.stop_service(svc_name, reason=f"dependency {name} stopping")

        if rt.proc_id:
            await self._pm.kill(rt.proc_id, reason=reason)

        rt.pid = None
        rt.proc_id = None
        rt.consecutive_failures = 0
        self._set_state(name, ServiceState.STOPPED)

        self._audit.log("overseer", "stopped", {
            "service": name, "reason": reason,
        })
        self._activity.system_event(f"Service {name} stopped ({reason})")
        return True

    async def restart_service(self, name: str, reason: str = "manual") -> bool:
        """Stop then start a service."""
        await self.stop_service(name, reason=f"restart: {reason}")
        await asyncio.sleep(1)
        return await self.start_service(name)

    async def start_all(self):
        """Start all autostart services in dependency order."""
        order = self._resolve_start_order()
        for name in order:
            svc = self._services[name]
            if svc.autostart:
                await self.start_service(name)

    async def stop_all(self, reason: str = "shutdown"):
        """Stop all services in reverse dependency order."""
        order = list(reversed(self._resolve_start_order()))
        for name in order:
            rt = self._runtime.get(name)
            if rt and rt.state != ServiceState.STOPPED:
                await self.stop_service(name, reason=reason)

    # ── Health Checking ───────────────────────────

    async def _check_health(self, name: str) -> bool:
        """Run the health check for a service. Returns True if healthy."""
        svc = self._services.get(name)
        rt = self._runtime.get(name)
        if not svc or not rt:
            return False

        hc = svc.health

        try:
            if hc.check_type == HealthCheckType.HTTP:
                async with httpx.AsyncClient(timeout=hc.timeout_seconds) as client:
                    resp = await client.get(hc.url)
                    return resp.status_code < 400

            elif hc.check_type == HealthCheckType.TCP:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(hc.timeout_seconds)
                try:
                    sock.connect((hc.host, hc.port))
                    return True
                finally:
                    sock.close()

            elif hc.check_type == HealthCheckType.PROCESS:
                if rt.proc_id:
                    proc_info = self._pm.get_process(rt.proc_id)
                    return proc_info is not None and proc_info.get("state") == "RUNNING"
                return False

        except Exception:
            return False

    # ── Background Monitor Loop ───────────────────

    def start(self, interval: float = 10.0):
        """Start the background health-check & auto-restart loop."""
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,),
            daemon=True, name="service-overseer",
        )
        self._thread.start()

    def stop(self):
        self._running = False

    def _loop(self, interval: float):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        while self._running:
            try:
                loop.run_until_complete(self._monitor_tick())
            except Exception as e:
                self._audit.log("overseer", "monitor_error", {"error": str(e)})
            time.sleep(interval)
        loop.close()

    async def _monitor_tick(self):
        """One monitoring cycle — check health for all running/unhealthy services."""
        for name, rt in list(self._runtime.items()):
            svc = self._services.get(name)
            if not svc:
                continue

            # Update uptime
            if rt.started_at and rt.state in (ServiceState.RUNNING, ServiceState.UNHEALTHY):
                rt.uptime_seconds = time.time() - rt.started_at

            # Only health-check services that should be active
            if rt.state not in (ServiceState.RUNNING, ServiceState.UNHEALTHY, ServiceState.STARTING):
                # Auto-retry FAILED after cooldown
                if rt.state == ServiceState.FAILED:
                    cooldown = svc.restart.cooldown_after_failure
                    if rt.started_at and time.time() - rt.started_at > cooldown:
                        self._audit.log("overseer", "cooldown_retry", {"service": name})
                        rt.retry_count = 0
                        await self.start_service(name)
                continue

            healthy = await self._check_health(name)

            if healthy:
                rt.consecutive_failures = 0
                rt.last_healthy = time.time()
                if rt.state != ServiceState.RUNNING:
                    self._set_state(name, ServiceState.RUNNING)
            else:
                rt.consecutive_failures += 1

                if rt.state == ServiceState.STARTING:
                    # Starting services get extra grace (30s)
                    if rt.started_at and time.time() - rt.started_at > 30:
                        rt.last_error = "Failed to start within 30s"
                        self._set_state(name, ServiceState.UNHEALTHY)
                    continue

                if rt.consecutive_failures >= svc.health.unhealthy_threshold:
                    if rt.state == ServiceState.RUNNING:
                        self._set_state(name, ServiceState.UNHEALTHY)
                        self._activity.system_event(
                            f"⚠ Service {name} is UNHEALTHY "
                            f"({rt.consecutive_failures} consecutive failures)")

                    # Auto-restart
                    if rt.retry_count < svc.restart.max_retries:
                        backoff = min(
                            svc.restart.backoff_base * (2 ** rt.retry_count),
                            svc.restart.backoff_max,
                        )
                        self._audit.log("overseer", "auto_restart", {
                            "service": name,
                            "retry": rt.retry_count + 1,
                            "max": svc.restart.max_retries,
                            "backoff": backoff,
                        })
                        self._activity.system_event(
                            f"Restarting {name} (attempt {rt.retry_count + 1}/"
                            f"{svc.restart.max_retries}, backoff {backoff}s)")

                        self._set_state(name, ServiceState.RESTARTING)
                        await asyncio.sleep(backoff)
                        rt.retry_count += 1
                        rt.total_restarts += 1
                        await self.stop_service(name, reason="auto-restart")
                        await self.start_service(name)
                    else:
                        self._set_state(name, ServiceState.FAILED)
                        rt.last_error = (
                            f"Exceeded {svc.restart.max_retries} restart attempts")
                        self._activity.system_event(
                            f"🔴 Service {name} FAILED — exceeded max retries")

    # ── Dependency Resolution ─────────────────────

    def _resolve_start_order(self) -> list[str]:
        """Topological sort of services by depends_on."""
        visited = set()
        order = []

        def _visit(name):
            if name in visited:
                return
            visited.add(name)
            svc = self._services.get(name)
            if svc:
                for dep in svc.depends_on:
                    _visit(dep)
            order.append(name)

        for name in self._services:
            _visit(name)
        return order

    # ── State Management ──────────────────────────

    def _set_state(self, name: str, new_state: ServiceState):
        rt = self._runtime[name]
        old_state = rt.state
        if old_state == new_state:
            return
        rt.state = new_state
        self._audit.log("overseer", "state_change", {
            "service": name,
            "from": old_state.value,
            "to": new_state.value,
        })
        for cb in self._callbacks:
            try:
                cb(name, old_state.value, new_state.value, rt.to_dict())
            except Exception:
                pass

    # ── Query ─────────────────────────────────────

    def get_service(self, name: str) -> dict | None:
        svc = self._services.get(name)
        rt = self._runtime.get(name)
        if not svc:
            return None
        return {
            "name": svc.name,
            "description": svc.description,
            "command": svc.command,
            "depends_on": svc.depends_on,
            "autostart": svc.autostart,
            **rt.to_dict(),
        }

    def list_services(self) -> list[dict]:
        return [self.get_service(n) for n in self._resolve_start_order()
                if self.get_service(n)]

    def get_status(self) -> dict:
        services = self.list_services()
        running = sum(1 for s in services if s["state"] == "running")
        unhealthy = sum(1 for s in services if s["state"] == "unhealthy")
        failed = sum(1 for s in services if s["state"] == "failed")
        return {
            "total": len(services),
            "running": running,
            "unhealthy": unhealthy,
            "failed": failed,
            "services": services,
        }
