"""
Nova — Anomaly Detector + Alert System
================================================
Monitors all JARVIS subsystems and detects unusual activity patterns.

Alert types:
- Security: suspicious processes, integrity violations, blocked commands
- Files: unexpected modifications outside work hours, bulk deletes
- System: resource spikes, service crashes
- AI: unusual command patterns, repeated failures

Alerts are stored in memory and pushed to connected WebSocket clients.
"""

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from collections import deque

from config import JarvisConfig
from logs.audit import AuditLogger
from memory.store import MemoryStore


@dataclass
class Alert:
    """A detected anomaly that the user should know about."""
    id: str
    severity: str       # "info", "warning", "critical"
    category: str       # "security", "file", "system", "ai"
    title: str
    message: str
    timestamp: str
    acknowledged: bool = False


class AnomalyDetector:
    """Monitors audit logs and system state for unusual patterns."""

    def __init__(self, config: JarvisConfig, audit: AuditLogger, memory: MemoryStore):
        self._config = config
        self._audit = audit
        self._memory = memory
        self._alerts: list[dict] = []
        self._alert_counter = 0
        self._thread: threading.Thread | None = None
        self._running = False
        self._ws_notify: list = []  # WebSocket connections to notify

        # Tracking state for pattern detection
        self._command_failures = deque(maxlen=50)
        self._blocked_commands = deque(maxlen=50)
        self._file_events = deque(maxlen=200)
        self._last_check = datetime.now()

    def register_ws_notifier(self, notifier):
        """Register a function that sends alerts to WebSocket clients."""
        self._ws_notify.append(notifier)

    def start(self, interval: float = 10.0):
        """Start background anomaly detection loop."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True,
        )
        self._thread.start()
        self._audit.log("anomaly", "detector_started", {"interval": interval})

    def stop(self):
        self._running = False

    # ── Event ingestion (called by other modules) ──────

    def on_command_blocked(self, details: dict):
        """Called when the gateway blocks a command."""
        self._blocked_commands.append({
            "time": datetime.now(),
            "details": details,
        })
        # Immediate alert if many blocks in short time
        recent = [e for e in self._blocked_commands
                  if e["time"] > datetime.now() - timedelta(minutes=5)]
        if len(recent) >= 3:
            self._raise_alert(
                severity="warning",
                category="security",
                title="Multiple commands blocked",
                message=f"{len(recent)} commands blocked in the last 5 minutes. "
                        f"The AI may be attempting actions outside its allowed scope.",
            )

    def on_command_failed(self, details: dict):
        """Called when a command execution fails."""
        self._command_failures.append({
            "time": datetime.now(),
            "details": details,
        })

    def on_file_event(self, event_type: str, path: str):
        """Called by file watcher on file changes."""
        self._file_events.append({
            "time": datetime.now(),
            "type": event_type,
            "path": path,
        })
        # Bulk delete detection
        recent_deletes = [
            e for e in self._file_events
            if e["type"] == "deleted" and e["time"] > datetime.now() - timedelta(minutes=2)
        ]
        if len(recent_deletes) >= 10:
            self._raise_alert(
                severity="critical",
                category="file",
                title="Bulk file deletion detected",
                message=f"{len(recent_deletes)} files deleted in the last 2 minutes. "
                        f"This may indicate accidental or malicious activity.",
            )

    def on_integrity_violation(self, details: dict):
        """Called by integrity checker when a critical file is modified."""
        self._raise_alert(
            severity="critical",
            category="security",
            title="Critical file modified",
            message=f"The integrity checker detected that a JARVIS source file was modified: "
                    f"{details.get('file', 'unknown')}. This could indicate tampering.",
        )

    def on_suspicious_process(self, details: dict):
        """Called by process watcher when something fishy is detected."""
        self._raise_alert(
            severity="critical",
            category="security",
            title="Suspicious process detected",
            message=f"Process {details.get('name', 'unknown')} (PID {details.get('pid', '?')}) "
                    f"is running a suspicious command: {details.get('cmdline', 'unknown')}",
        )

    def on_high_resource_usage(self, details: dict):
        """Called on resource abuse detection."""
        self._raise_alert(
            severity="warning",
            category="system",
            title="High resource usage",
            message=f"Process {details.get('name', 'unknown')} is using excessive "
                    f"{'CPU' if details.get('cpu') else 'memory'}: "
                    f"{details.get('cpu', details.get('mb', '?'))}",
        )

    # ── Alert management ───────────────────────────────

    def get_alerts(self, unread_only: bool = False, count: int = 50) -> list[dict]:
        """Return recent alerts."""
        alerts = self._alerts
        if unread_only:
            alerts = [a for a in alerts if not a.get("acknowledged")]
        return alerts[-count:]

    def acknowledge_alert(self, alert_id: str) -> bool:
        """Mark an alert as read."""
        for a in self._alerts:
            if a["id"] == alert_id:
                a["acknowledged"] = True
                return True
        return False

    def acknowledge_all(self):
        """Mark all alerts as read."""
        for a in self._alerts:
            a["acknowledged"] = True

    def get_unread_count(self) -> int:
        return sum(1 for a in self._alerts if not a.get("acknowledged"))

    # ── Internal ───────────────────────────────────────

    def _raise_alert(self, severity: str, category: str, title: str, message: str):
        """Create and store a new alert."""
        self._alert_counter += 1
        alert = {
            "id": f"alert-{self._alert_counter}",
            "severity": severity,
            "category": category,
            "title": title,
            "message": message,
            "timestamp": datetime.now().isoformat(),
            "acknowledged": False,
        }
        self._alerts.append(alert)

        # Cap stored alerts
        if len(self._alerts) > 500:
            self._alerts = self._alerts[-500:]

        # Log it
        self._audit.log("anomaly", f"alert_{severity}", {
            "category": category,
            "title": title,
        })

        # Notify connected WebSocket clients
        for notify in self._ws_notify:
            try:
                notify(alert)
            except Exception:
                pass

    def _loop(self, interval: float):
        while self._running:
            try:
                self._periodic_checks()
            except Exception as e:
                self._audit.log("anomaly", "check_error", {"error": str(e)})
            time.sleep(interval)

    def _periodic_checks(self):
        """Run periodic pattern analysis on collected events."""
        now = datetime.now()

        # Check for repeated command failures
        recent_fails = [
            e for e in self._command_failures
            if e["time"] > now - timedelta(minutes=10)
        ]
        if len(recent_fails) >= 5:
            self._raise_alert(
                severity="warning",
                category="ai",
                title="Repeated command failures",
                message=f"{len(recent_fails)} command executions failed in the last 10 minutes. "
                        f"The AI model may be generating invalid commands.",
            )
            self._command_failures.clear()

        # Late-night activity detection (if configured)
        hour = now.hour
        if (hour >= 2 and hour <= 5):
            recent_file_changes = [
                e for e in self._file_events
                if e["time"] > now - timedelta(minutes=5)
            ]
            if len(recent_file_changes) > 5:
                self._raise_alert(
                    severity="info",
                    category="file",
                    title="Late-night file activity",
                    message=f"{len(recent_file_changes)} file changes detected between 2-5 AM. "
                            f"Just making sure you're aware.",
                )

        self._last_check = now
