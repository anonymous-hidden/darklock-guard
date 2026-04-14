"""
Nova — Watchdog: Process Security + Govee/Scene Monitor
=========================================================
Background daemon that:
  1. Scans all system processes for suspicious activity (not just child procs)
  2. Monitors network listeners for unexpected ports
  3. Tracks Govee device reachability and scene health
  4. Sends real-time alerts through the AnomalyDetector pipeline

Feeds into the existing AlertBanner / WebSocket push system.
"""

import asyncio
import os
import re
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta

import psutil

from logs.audit import AuditLogger
from security.anomaly_detector import AnomalyDetector
from core.activity_tracker import ActivityTracker

# ── Suspicious process patterns ────────────────────────────
# Each tuple: (compiled regex on cmdline, severity, description)
_SUSPICIOUS = [
    (re.compile(r"\bnc\s+-[le]", re.I), "critical",
     "Netcat listener — possible reverse shell"),
    (re.compile(r"\bncat\b.*(-e|--exec)", re.I), "critical",
     "Ncat with exec — possible reverse shell"),
    (re.compile(r"\bsocat\b", re.I), "warning",
     "Socat relay detected"),
    (re.compile(r"\bcurl\b.*\|\s*(ba)?sh", re.I), "critical",
     "Pipe-to-shell download — could be malicious"),
    (re.compile(r"\bwget\b.*\|\s*(ba)?sh", re.I), "critical",
     "Pipe-to-shell download — could be malicious"),
    (re.compile(r"\bbash\s+-i\b", re.I), "critical",
     "Interactive bash — possible reverse shell"),
    (re.compile(r"\bpython[23]?\s+-c\s+.*socket", re.I), "critical",
     "Python socket one-liner — possible reverse shell"),
    (re.compile(r"\bcryptominer|xmrig|minerd\b", re.I), "critical",
     "Crypto miner detected"),
    (re.compile(r"\bkeylogger\b", re.I), "critical",
     "Keylogger process detected"),
    (re.compile(r"\btcpdump\b.*-w", re.I), "warning",
     "Packet capture writing to file"),
    (re.compile(r"\bnmap\b", re.I), "warning",
     "Network scanner (nmap) detected"),
    (re.compile(r"\bhydra\b|\bmedusa\b|\bjohn\b", re.I), "warning",
     "Password cracking tool detected"),
    (re.compile(r"\bsshd:.*\[accepted\]", re.I), "info",
     "New SSH login accepted"),
    (re.compile(r"\bsudo\s+su\b", re.I), "warning",
     "Sudo su — privilege escalation"),
    (re.compile(r"\bchmod\s+[47]77\b", re.I), "warning",
     "World-writable permission change"),
    (re.compile(r"\bdd\s+if=/dev/", re.I), "warning",
     "Raw disk read with dd"),
]

# Ports that are expected to be open on this machine
_EXPECTED_PORTS = {
    8950,   # Nova backend
    5173,   # Vite dev server
    11434,  # Ollama
    22,     # SSH (standard)
    631,    # CUPS printing
    1716,   # KDE Connect
    1717,   # KDE Connect (gjs)
    6463,   # Discord RPC
    53,     # DNS resolver
    5432,   # PostgreSQL
}

# Process names whose ports should never be alerted (dynamic ports)
_PORT_SAFE_NAMES = {"code", "cloudflared", "electron", "chrome", "firefox"}

# Process command-line patterns that are known-safe (skip even if they match _SUSPICIOUS)
_WHITELISTED = [
    re.compile(r"discord.*ipc", re.I),      # Discord uses socat for IPC
    re.compile(r"com\.discordapp", re.I),   # Discord app paths
]

# ── Govee scene health check interval ─────────────────────
_GOVEE_CHECK_INTERVAL = 120  # seconds between Govee reachability checks


class Watchdog:
    """System-wide process security + Govee/scene health monitor."""

    def __init__(self, anomaly: AnomalyDetector, audit: AuditLogger,
                 activity: ActivityTracker):
        self._anomaly = anomaly
        self._audit = audit
        self._activity = activity
        self._running = False
        self._thread: threading.Thread | None = None

        # Tracking
        self._known_pids: dict[int, str] = {}       # pid → cmdline (last seen)
        self._alerted_pids: set[int] = set()         # don't re-alert same pid
        self._port_alert_cooldown: dict[int, float] = {}
        self._govee_last_check: float = 0
        self._govee_offline: set[str] = set()        # devices known offline
        self._scene_warned = False

    # ── Start / Stop ──────────────────────────────

    def start(self, interval: float = 10.0):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True,
            name="watchdog")
        self._thread.start()
        self._audit.log("watchdog", "started", {"interval": interval})
        self._activity.system_event("Watchdog armed — monitoring processes + network + Govee")

    def stop(self):
        self._running = False

    def _loop(self, interval: float):
        while self._running:
            try:
                self._scan_processes()
                self._scan_ports()
                self._check_govee_health()
                self._check_scene_health()
            except Exception as e:
                self._audit.log("watchdog", "error", {"error": str(e)[:200]})
            time.sleep(interval)

    # ── Process scanner ────────────────────────────

    def _scan_processes(self):
        """Scan all running processes for suspicious patterns."""
        my_pid = os.getpid()
        current_pids: dict[int, str] = {}

        for proc in psutil.process_iter(["pid", "name", "cmdline", "username"]):
            try:
                info = proc.info
                pid = info["pid"]
                cmdline_parts = info.get("cmdline") or []
                cmdline = " ".join(cmdline_parts[:8])
                current_pids[pid] = cmdline

                # Skip self and known-safe
                if pid == my_pid or not cmdline.strip():
                    continue

                # Only alert each PID once
                if pid in self._alerted_pids:
                    continue

                # Skip whitelisted processes
                if any(wp.search(cmdline) for wp in _WHITELISTED):
                    continue

                # Check against suspicious patterns
                for pattern, severity, desc in _SUSPICIOUS:
                    if pattern.search(cmdline):
                        self._alerted_pids.add(pid)
                        self._anomaly.on_suspicious_process({
                            "pid": pid,
                            "name": info.get("name", "unknown"),
                            "cmdline": cmdline[:200],
                            "user": info.get("username", "?"),
                            "matched": desc,
                        })
                        self._audit.log("watchdog", "suspicious_process", {
                            "pid": pid,
                            "name": info.get("name"),
                            "desc": desc,
                            "cmdline": cmdline[:200],
                        })
                        self._activity.record("system",
                            f"⚠️ Suspicious process: {desc}",
                            details={"pid": pid, "cmdline": cmdline[:120]})
                        break

                # High resource check for non-child processes too
                try:
                    cpu = proc.cpu_percent(interval=0)
                    mem_mb = proc.memory_info().rss / (1024 ** 2)
                    if cpu > 95 and pid not in self._alerted_pids:
                        self._alerted_pids.add(pid)
                        self._anomaly.on_high_resource_usage({
                            "pid": pid, "name": info.get("name"),
                            "cpu": f"{cpu:.0f}%"
                        })
                    if mem_mb > 2048 and pid not in self._alerted_pids:
                        self._alerted_pids.add(pid)
                        self._anomaly.on_high_resource_usage({
                            "pid": pid, "name": info.get("name"),
                            "mb": f"{mem_mb:.0f} MB"
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        # Clean up stale alerted PIDs (processes that ended)
        active = set(current_pids.keys())
        self._alerted_pids = self._alerted_pids & active
        self._known_pids = current_pids

    # ── Port scanner ───────────────────────────────

    def _scan_ports(self):
        """Detect unexpected listening ports."""
        now = time.time()
        try:
            conns = psutil.net_connections(kind="inet")
        except psutil.AccessDenied:
            return

        for conn in conns:
            if conn.status != "LISTEN":
                continue
            port = conn.laddr.port
            if port in _EXPECTED_PORTS:
                continue

            # Cooldown: don't re-alert same port within 5 minutes
            if port in self._port_alert_cooldown:
                if now - self._port_alert_cooldown[port] < 300:
                    continue

            self._port_alert_cooldown[port] = now

            # Find the process listening on this port
            proc_name = "unknown"
            if conn.pid:
                try:
                    proc_name = psutil.Process(conn.pid).name()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            # Skip known-safe process names (they use dynamic ports)
            if proc_name.lower() in _PORT_SAFE_NAMES:
                continue

            self._anomaly._raise_alert(
                severity="warning",
                category="security",
                title=f"Unexpected port {port} open",
                message=f"Process '{proc_name}' (PID {conn.pid or '?'}) is "
                        f"listening on port {port}, which isn't in the expected "
                        f"ports list ({', '.join(str(p) for p in sorted(_EXPECTED_PORTS))}). "
                        f"This could be normal (new service) or suspicious.",
            )
            self._audit.log("watchdog", "unexpected_port", {
                "port": port, "pid": conn.pid, "process": proc_name,
            })

    # ── Govee health ───────────────────────────────

    def _check_govee_health(self):
        """Periodically check Govee API reachability and device status."""
        now = time.time()
        if now - self._govee_last_check < _GOVEE_CHECK_INTERVAL:
            return
        self._govee_last_check = now

        try:
            import httpx
            api_key = os.environ.get("GOVEE_API_KEY", "")
            if not api_key:
                # Try .env in jarvis dir
                from pathlib import Path
                env_file = Path(__file__).parent.parent / ".env"
                if env_file.exists():
                    for line in env_file.read_text().splitlines():
                        if line.strip().startswith("GOVEE_API_KEY="):
                            api_key = line.strip().split("=", 1)[1].strip()
                            break
            if not api_key:
                return

            headers = {
                "Govee-API-Key": api_key,
                "Content-Type": "application/json",
            }
            r = httpx.get(
                "https://openapi.api.govee.com/router/api/v1/user/devices",
                headers=headers, timeout=10)

            if r.status_code != 200:
                self._anomaly._raise_alert(
                    severity="warning",
                    category="system",
                    title="Govee API unreachable",
                    message=f"Govee API returned HTTP {r.status_code}. "
                            f"Light commands will fail until the API is back.",
                )
                self._audit.log("watchdog", "govee_api_down", {
                    "status": r.status_code})
                return

            devices = r.json().get("data", [])
            device_count = len(devices)

            # Log device count for health tracking
            self._audit.log("watchdog", "govee_check_ok", {
                "devices": device_count})

            # Check if device count dropped drastically
            if hasattr(self, "_last_device_count") and self._last_device_count > 0:
                if device_count < self._last_device_count - 3:
                    self._anomaly._raise_alert(
                        severity="warning",
                        category="system",
                        title="Govee devices disappeared",
                        message=f"Govee went from {self._last_device_count} to "
                                f"{device_count} devices. Some may have gone offline "
                                f"or there's a network issue.",
                    )
            self._last_device_count = device_count

        except Exception as e:
            self._anomaly._raise_alert(
                severity="warning",
                category="system",
                title="Govee health check failed",
                message=f"Couldn't reach Govee API: {str(e)[:120]}",
            )
            self._audit.log("watchdog", "govee_check_error", {"error": str(e)[:200]})

    # ── Scene health ───────────────────────────────

    def _check_scene_health(self):
        """Verify running light scene task is still alive."""
        try:
            from integrations.light_scenes import _running_task, _running_name
            if _running_name and _running_task:
                if _running_task.done():
                    exc = _running_task.exception() if not _running_task.cancelled() else None
                    self._anomaly._raise_alert(
                        severity="warning",
                        category="system",
                        title="Light scene crashed",
                        message=f"The '{_running_name.replace('_', ' ').title()}' scene "
                                f"stopped unexpectedly"
                                f"{f': {exc}' if exc else '. It may have hit an API error. '
                                 'Try starting it again.'}",
                    )
                    self._audit.log("watchdog", "scene_crashed", {
                        "scene": _running_name,
                        "error": str(exc)[:200] if exc else "cancelled/done",
                    })
                    # Reset the module state
                    import integrations.light_scenes as ls
                    ls._running_task = None
                    ls._running_name = None
                    self._scene_warned = False
                elif not self._scene_warned:
                    # Scene is running fine — log periodic heartbeat
                    pass
            else:
                self._scene_warned = False
        except ImportError:
            pass

    # ── Status query ───────────────────────────────

    def get_status(self) -> dict:
        from integrations.light_scenes import current_scene
        return {
            "running": self._running,
            "tracked_pids": len(self._known_pids),
            "alerted_pids": len(self._alerted_pids),
            "govee_offline": list(self._govee_offline),
            "active_scene": current_scene(),
        }
