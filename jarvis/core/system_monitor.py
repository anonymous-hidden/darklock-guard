"""
Nova — System Monitor
======================
Real-time system resource monitoring with thresholds and alerts.
Watches CPU, RAM, GPU, disk, temperature, and network.

Runs as a background async task, stores snapshots, and can trigger
proactive alerts when thresholds are exceeded.
"""

import asyncio
import logging
import shutil
import subprocess
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime

import psutil

logger = logging.getLogger(__name__)


@dataclass
class SystemSnapshot:
    timestamp: float = field(default_factory=time.time)
    cpu_percent: float = 0.0
    cpu_freq_mhz: int = 0
    cpu_temp_c: float | None = None
    ram_total_gb: float = 0.0
    ram_used_gb: float = 0.0
    ram_percent: float = 0.0
    swap_percent: float = 0.0
    disk_total_gb: float = 0.0
    disk_used_gb: float = 0.0
    disk_percent: float = 0.0
    gpu_name: str = ""
    gpu_vram_total_mb: int = 0
    gpu_vram_used_mb: int = 0
    gpu_vram_free_mb: int = 0
    gpu_temp_c: int = 0
    gpu_utilization: int = 0
    gpu_power_w: float = 0.0
    net_sent_mb: float = 0.0
    net_recv_mb: float = 0.0
    process_count: int = 0
    uptime_hours: float = 0.0

    def to_dict(self) -> dict:
        return {
            "timestamp": datetime.fromtimestamp(self.timestamp).isoformat(),
            "cpu": {
                "percent": self.cpu_percent,
                "freq_mhz": self.cpu_freq_mhz,
                "temp_c": self.cpu_temp_c,
            },
            "ram": {
                "total_gb": self.ram_total_gb,
                "used_gb": self.ram_used_gb,
                "percent": self.ram_percent,
            },
            "swap_percent": self.swap_percent,
            "disk": {
                "total_gb": self.disk_total_gb,
                "used_gb": self.disk_used_gb,
                "percent": self.disk_percent,
            },
            "gpu": {
                "name": self.gpu_name,
                "vram_total_mb": self.gpu_vram_total_mb,
                "vram_used_mb": self.gpu_vram_used_mb,
                "vram_free_mb": self.gpu_vram_free_mb,
                "temp_c": self.gpu_temp_c,
                "utilization": self.gpu_utilization,
                "power_w": self.gpu_power_w,
            },
            "network": {
                "sent_mb": round(self.net_sent_mb, 1),
                "recv_mb": round(self.net_recv_mb, 1),
            },
            "process_count": self.process_count,
            "uptime_hours": round(self.uptime_hours, 1),
        }


class SystemMonitor:
    """
    Continuous system monitoring with alerting.
    
    Thresholds (configurable):
      - CPU > 90% for 30s → alert
      - RAM > 85% → alert
      - GPU temp > 85°C → alert
      - GPU VRAM > 90% → alert  
      - Disk > 90% → alert
    """

    def __init__(self, config, audit, activity_tracker):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker
        self._history: deque[SystemSnapshot] = deque(maxlen=720)  # 1h at 5s intervals
        self._latest: SystemSnapshot | None = None
        self._alert_callbacks: list = []
        self._task: asyncio.Task | None = None
        self._running = False

        # Thresholds
        self._thresholds = {
            "cpu_percent": config.get("monitoring.cpu_threshold", 90) or 90,
            "ram_percent": config.get("monitoring.ram_threshold", 85) or 85,
            "gpu_temp_c": config.get("monitoring.gpu_temp_threshold", 85) or 85,
            "gpu_vram_percent": config.get("monitoring.gpu_vram_threshold", 90) or 90,
            "disk_percent": config.get("monitoring.disk_threshold", 90) or 90,
        }
        # Track alert cooldowns to avoid spam
        self._last_alert: dict[str, float] = {}
        self._alert_cooldown = 120  # seconds between repeated alerts

    def on_alert(self, callback):
        self._alert_callbacks.append(callback)

    def _fire_alert(self, category: str, message: str, data: dict):
        now = time.time()
        if now - self._last_alert.get(category, 0) < self._alert_cooldown:
            return
        self._last_alert[category] = now
        self._audit.log("system_monitor", "alert", {"category": category, "message": message, **data})
        self._activity.system_event(f"⚠ {message}", details=data)
        for cb in self._alert_callbacks:
            try:
                cb({"category": category, "message": message, **data})
            except Exception:
                pass

    # ── Snapshot collection ────────────────────────

    def _collect_snapshot(self) -> SystemSnapshot:
        snap = SystemSnapshot()

        # CPU
        snap.cpu_percent = psutil.cpu_percent(interval=0)
        freq = psutil.cpu_freq()
        snap.cpu_freq_mhz = int(freq.current) if freq else 0

        # CPU temp
        try:
            temps = psutil.sensors_temperatures()
            for name in ("coretemp", "k10temp", "zenpower", "cpu_thermal"):
                if name in temps and temps[name]:
                    snap.cpu_temp_c = temps[name][0].current
                    break
        except Exception:
            pass

        # RAM
        mem = psutil.virtual_memory()
        snap.ram_total_gb = round(mem.total / 1e9, 1)
        snap.ram_used_gb = round(mem.used / 1e9, 1)
        snap.ram_percent = mem.percent

        # Swap
        sw = psutil.swap_memory()
        snap.swap_percent = sw.percent

        # Disk
        disk = shutil.disk_usage("/")
        snap.disk_total_gb = round(disk.total / 1e9, 1)
        snap.disk_used_gb = round(disk.used / 1e9, 1)
        snap.disk_percent = round(disk.used / disk.total * 100, 1)

        # GPU (NVIDIA)
        try:
            result = subprocess.run(
                ["nvidia-smi",
                 "--query-gpu=name,memory.total,memory.used,memory.free,temperature.gpu,utilization.gpu,power.draw",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=3,
            )
            if result.returncode == 0:
                parts = [p.strip() for p in result.stdout.strip().split(",")]
                if len(parts) >= 7:
                    snap.gpu_name = parts[0]
                    snap.gpu_vram_total_mb = int(parts[1])
                    snap.gpu_vram_used_mb = int(parts[2])
                    snap.gpu_vram_free_mb = int(parts[3])
                    snap.gpu_temp_c = int(parts[4])
                    snap.gpu_utilization = int(parts[5])
                    snap.gpu_power_w = float(parts[6])
        except Exception:
            pass

        # Network
        net = psutil.net_io_counters()
        snap.net_sent_mb = net.bytes_sent / (1024 * 1024)
        snap.net_recv_mb = net.bytes_recv / (1024 * 1024)

        # Processes + uptime
        snap.process_count = len(psutil.pids())
        snap.uptime_hours = (time.time() - psutil.boot_time()) / 3600

        return snap

    def _check_thresholds(self, snap: SystemSnapshot):
        if snap.cpu_percent > self._thresholds["cpu_percent"]:
            self._fire_alert("cpu_high", f"CPU at {snap.cpu_percent}%", {"cpu_percent": snap.cpu_percent})

        if snap.ram_percent > self._thresholds["ram_percent"]:
            self._fire_alert("ram_high", f"RAM at {snap.ram_percent}%", {"ram_percent": snap.ram_percent})

        if snap.gpu_temp_c > self._thresholds["gpu_temp_c"]:
            self._fire_alert("gpu_hot", f"GPU temp {snap.gpu_temp_c}°C", {"gpu_temp_c": snap.gpu_temp_c})

        if snap.gpu_vram_total_mb > 0:
            vram_pct = (snap.gpu_vram_used_mb / snap.gpu_vram_total_mb) * 100
            if vram_pct > self._thresholds["gpu_vram_percent"]:
                self._fire_alert("gpu_vram_high", f"GPU VRAM at {vram_pct:.0f}%", {
                    "vram_used_mb": snap.gpu_vram_used_mb, "vram_total_mb": snap.gpu_vram_total_mb,
                })

        if snap.disk_percent > self._thresholds["disk_percent"]:
            self._fire_alert("disk_full", f"Disk at {snap.disk_percent}%", {"disk_percent": snap.disk_percent})

    # ── Public API ─────────────────────────────────

    def get_snapshot(self) -> dict:
        """Get the most recent system snapshot."""
        if self._latest:
            return self._latest.to_dict()
        snap = self._collect_snapshot()
        return snap.to_dict()

    def get_history(self, minutes: int = 10) -> list[dict]:
        """Get recent snapshot history."""
        cutoff = time.time() - (minutes * 60)
        return [s.to_dict() for s in self._history if s.timestamp > cutoff]

    def get_summary(self) -> str:
        """Human-readable system status string for injection into prompts."""
        snap = self._latest or self._collect_snapshot()
        lines = [
            f"CPU: {snap.cpu_percent}%",
            f"RAM: {snap.ram_used_gb}/{snap.ram_total_gb}GB ({snap.ram_percent}%)",
        ]
        if snap.gpu_name:
            lines.append(
                f"GPU: {snap.gpu_name} — VRAM {snap.gpu_vram_used_mb}/{snap.gpu_vram_total_mb}MB, "
                f"{snap.gpu_temp_c}°C, {snap.gpu_utilization}% util"
            )
        lines.append(f"Disk: {snap.disk_used_gb}/{snap.disk_total_gb}GB ({snap.disk_percent}%)")
        lines.append(f"Uptime: {snap.uptime_hours:.1f}h, Processes: {snap.process_count}")
        return " | ".join(lines)

    # ── Background loop ────────────────────────────

    async def _loop(self, interval: float):
        self._audit.log("system_monitor", "started", {"interval": interval})
        while self._running:
            try:
                snap = self._collect_snapshot()
                self._latest = snap
                self._history.append(snap)
                self._check_thresholds(snap)
            except Exception as e:
                logger.error(f"System monitor error: {e}")
            await asyncio.sleep(interval)

    def start(self, interval: float = 5.0):
        if self._running:
            return
        self._running = True
        import threading
        def _run():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(self._loop(interval))
        t = threading.Thread(target=_run, daemon=True, name="system-monitor")
        t.start()

    def stop(self):
        self._running = False
