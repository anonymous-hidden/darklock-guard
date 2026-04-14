"""
Nova — Health Monitor
=======================
Always-on background service that checks the health of all critical subsystems,
reports metrics, and provides a heartbeat.

Monitored services:
  • Ollama LLM endpoint
  • SQLite database
  • Disk space
  • Memory usage
  • CPU usage
  • Nova API (self-check)
"""

import os
import time
import threading
import sqlite3
from pathlib import Path

import httpx
import psutil


class ServiceCheck:
    """Result of a single health check."""
    __slots__ = ("name", "healthy", "latency_ms", "message", "ts")

    def __init__(self, name: str, healthy: bool, latency_ms: float = 0,
                 message: str = ""):
        self.name = name
        self.healthy = healthy
        self.latency_ms = round(latency_ms, 1)
        self.message = message
        self.ts = time.time()

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "healthy": self.healthy,
            "latency_ms": self.latency_ms,
            "message": self.message,
            "ts": round(self.ts, 3),
        }


class HealthMonitor:
    """Periodically checks service health and publishes results."""

    def __init__(self, config, audit, activity_tracker, db_path: Path):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker
        self._db_path = db_path

        self._ollama_url = config.get("ai.ollama_url") or "http://127.0.0.1:11434"
        self._darklock_url = config.get("darklock.api_url") or "http://127.0.0.1:3002"
        self._darklock_client = None  # Set via set_darklock_client()

        self._lock = threading.Lock()
        self._checks: dict[str, ServiceCheck] = {}
        self._heartbeat_ts: float = time.time()
        self._running = False
        self._thread: threading.Thread | None = None
        self._consecutive_failures: dict[str, int] = {}

    def set_darklock_client(self, client):
        """Inject the DarklockClient for Pi5 health checks."""
        self._darklock_client = client

    # ── Individual checks ──────────────────────────

    def _check_ollama(self) -> ServiceCheck:
        try:
            t0 = time.time()
            r = httpx.get(f"{self._ollama_url}/api/tags", timeout=5)
            latency = (time.time() - t0) * 1000
            if r.status_code == 200:
                models = len(r.json().get("models", []))
                return ServiceCheck("ollama", True, latency, f"{models} model(s) loaded")
            return ServiceCheck("ollama", False, latency, f"HTTP {r.status_code}")
        except Exception as e:
            return ServiceCheck("ollama", False, 0, str(e)[:120])

    def _check_database(self) -> ServiceCheck:
        try:
            t0 = time.time()
            conn = sqlite3.connect(str(self._db_path), timeout=3)
            conn.execute("SELECT 1")
            size_mb = self._db_path.stat().st_size / (1024 * 1024)
            latency = (time.time() - t0) * 1000
            conn.close()
            return ServiceCheck("database", True, latency, f"{size_mb:.1f} MB")
        except Exception as e:
            return ServiceCheck("database", False, 0, str(e)[:120])

    def _check_disk(self) -> ServiceCheck:
        try:
            usage = psutil.disk_usage("/")
            free_gb = usage.free / (1024 ** 3)
            pct = usage.percent
            healthy = pct < 90
            return ServiceCheck("disk", healthy, 0,
                                f"{free_gb:.1f} GB free ({pct}% used)")
        except Exception as e:
            return ServiceCheck("disk", False, 0, str(e)[:120])

    def _check_memory(self) -> ServiceCheck:
        try:
            mem = psutil.virtual_memory()
            used_mb = mem.used / (1024 ** 2)
            total_mb = mem.total / (1024 ** 2)
            pct = mem.percent
            healthy = pct < 90
            return ServiceCheck("memory", healthy, 0,
                                f"{used_mb:.0f}/{total_mb:.0f} MB ({pct}%)")
        except Exception as e:
            return ServiceCheck("memory", False, 0, str(e)[:120])

    def _check_cpu(self) -> ServiceCheck:
        try:
            pct = psutil.cpu_percent(interval=0.5)
            healthy = pct < 95
            return ServiceCheck("cpu", healthy, 0, f"{pct}% utilization")
        except Exception as e:
            return ServiceCheck("cpu", False, 0, str(e)[:120])

    def _check_govee(self) -> ServiceCheck:
        """Check Govee API reachability (lightweight — just device list)."""
        import os as _os
        api_key = _os.environ.get("GOVEE_API_KEY", "")
        if not api_key:
            return ServiceCheck("govee", True, 0, "no API key configured")
        try:
            t0 = time.time()
            r = httpx.get(
                "https://openapi.api.govee.com/router/api/v1/user/devices",
                headers={"Govee-API-Key": api_key, "Content-Type": "application/json"},
                timeout=10)
            latency = (time.time() - t0) * 1000
            if r.status_code == 200:
                count = len(r.json().get("data", []))
                return ServiceCheck("govee", True, latency, f"{count} device(s)")
            return ServiceCheck("govee", False, latency, f"HTTP {r.status_code}")
        except Exception as e:
            return ServiceCheck("govee", False, 0, str(e)[:120])

    def _check_scene(self) -> ServiceCheck:
        """Check if a light scene is running and healthy."""
        try:
            from integrations.light_scenes import _running_task, _running_name
            if not _running_name:
                return ServiceCheck("scene", True, 0, "none active")
            if _running_task and not _running_task.done():
                nice = _running_name.replace('_', ' ').title()
                return ServiceCheck("scene", True, 0, f"running: {nice}")
            return ServiceCheck("scene", False, 0, "task died unexpectedly")
        except ImportError:
            return ServiceCheck("scene", True, 0, "module not loaded")

    def _check_darklock(self) -> ServiceCheck:
        """Check Darklock web server health via HTTP."""
        try:
            t0 = time.time()
            r = httpx.get(f"{self._darklock_url}/health", timeout=8)
            latency = (time.time() - t0) * 1000
            if r.status_code == 200:
                return ServiceCheck("darklock", True, latency, "online")
            return ServiceCheck("darklock", False, latency, f"HTTP {r.status_code}")
        except Exception as e:
            return ServiceCheck("darklock", False, 0, str(e)[:120])

    def _check_pi5(self) -> ServiceCheck:
        """Check Pi5 reachability and Darklock service status via SSH."""
        if not self._darklock_client:
            return ServiceCheck("pi5", True, 0, "no client configured")
        try:
            import asyncio
            loop = asyncio.new_event_loop()
            try:
                health = loop.run_until_complete(self._darklock_client.pi5.health_check())
            finally:
                loop.close()
            if not health.online:
                return ServiceCheck("pi5", False, health.latency_ms,
                                    health.error or "unreachable")
            if not health.darklock_active:
                return ServiceCheck("pi5", False, health.latency_ms,
                                    "Pi5 online but Darklock service is DOWN")
            return ServiceCheck("pi5", True, health.latency_ms, health.summary())
        except Exception as e:
            return ServiceCheck("pi5", False, 0, str(e)[:120])

    # ── Run all checks ─────────────────────────────

    def run_checks(self) -> list[dict]:
        """Execute every health check and update internal state."""
        checks = [
            self._check_ollama(),
            self._check_database(),
            self._check_disk(),
            self._check_memory(),
            self._check_cpu(),
            self._check_govee(),
            self._check_scene(),
            self._check_darklock(),
            self._check_pi5(),
        ]

        with self._lock:
            self._heartbeat_ts = time.time()
            for c in checks:
                prev = self._checks.get(c.name)
                self._checks[c.name] = c

                # Track consecutive failures for recovery
                if not c.healthy:
                    self._consecutive_failures[c.name] = \
                        self._consecutive_failures.get(c.name, 0) + 1
                else:
                    if c.name in self._consecutive_failures:
                        del self._consecutive_failures[c.name]

                # Log state transitions
                if prev and prev.healthy != c.healthy:
                    event = "service_recovered" if c.healthy else "service_degraded"
                    self._audit.log("health", event, c.to_dict())
                    self._activity.system_event(
                        f"{'✅' if c.healthy else '⚠️'} {c.name}: {c.message}")

        return [c.to_dict() for c in checks]

    # ── Background loop ────────────────────────────

    def _loop(self, interval: float):
        self._audit.log("health", "monitor_started", {"interval": interval})
        while self._running:
            try:
                self.run_checks()
            except Exception as e:
                self._audit.log("health", "check_error", {"error": str(e)[:200]})
            time.sleep(interval)

    def start(self, interval: float = 30):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True, name="health-monitor")
        self._thread.start()

    def stop(self):
        self._running = False

    # ── Queries ────────────────────────────────────

    def get_status(self) -> dict:
        with self._lock:
            return {
                "heartbeat": round(self._heartbeat_ts, 3),
                "services": {n: c.to_dict() for n, c in self._checks.items()},
                "all_healthy": all(c.healthy for c in self._checks.values()),
                "consecutive_failures": dict(self._consecutive_failures),
            }

    def get_unhealthy(self) -> list[str]:
        with self._lock:
            return [n for n, c in self._checks.items() if not c.healthy]

    def get_consecutive_failures(self) -> dict[str, int]:
        with self._lock:
            return dict(self._consecutive_failures)

    def heartbeat(self) -> dict:
        with self._lock:
            return {
                "alive": True,
                "uptime_seconds": round(time.time() - self._heartbeat_ts, 1),
                "last_check": round(self._heartbeat_ts, 3),
            }
