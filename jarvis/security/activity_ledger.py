"""
Nova — Activity Ledger
=======================
Unified event stream that funnels every system event into one
place — file changes, process starts/stops, service state changes,
security alerts, network anomalies, command executions.

Each event is classified:
  - routine:    Normal operation (file save, heartbeat)
  - notable:    Worth noting (deploy, config change, new connection)
  - suspicious: Needs attention (unexpected file mod, unknown process)
  - critical:   Red alert (integrity violation, service chain failure)

Events are correlated to detect patterns like:
  "Darklock route modified → Darklock restarted → new port opened"
  = deploy (routine) vs. compromise (critical)
"""

import enum
import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable


class EventSeverity(str, enum.Enum):
    ROUTINE = "routine"
    NOTABLE = "notable"
    SUSPICIOUS = "suspicious"
    CRITICAL = "critical"


class EventCategory(str, enum.Enum):
    FILE = "file"
    PROCESS = "process"
    SERVICE = "service"
    SECURITY = "security"
    NETWORK = "network"
    COMMAND = "command"
    SYSTEM = "system"
    AI = "ai"


@dataclass
class LedgerEvent:
    """A single event in the activity ledger."""
    id: str
    timestamp: float
    category: str
    severity: str
    source: str             # which module emitted this
    title: str
    details: dict = field(default_factory=dict)
    correlation_key: str = ""   # events with same key are related
    acknowledged: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "category": self.category,
            "severity": self.severity,
            "source": self.source,
            "title": self.title,
            "details": self.details,
            "correlation_key": self.correlation_key,
            "acknowledged": self.acknowledged,
        }


# ── Correlation Rules ─────────────────────────────
# These detect multi-event patterns and reclassify severity.

@dataclass
class CorrelationRule:
    """Matches a sequence of events within a time window."""
    name: str
    events: list[dict]          # list of {category, title_contains} matchers
    window_seconds: float       # how far back to look
    result_severity: str        # what to classify the cluster as
    result_title: str           # summary title for the correlated event
    description: str = ""


_DEFAULT_RULES = [
    CorrelationRule(
        name="deploy_detected",
        events=[
            {"category": "file", "title_contains": "modified"},
            {"category": "service", "title_contains": "restart"},
        ],
        window_seconds=120,
        result_severity="notable",
        result_title="Deploy detected — file changes followed by service restart",
        description="Normal deploy pattern: code changed then service restarted",
    ),
    CorrelationRule(
        name="unauthorized_modification",
        events=[
            {"category": "file", "title_contains": "modified"},
            {"category": "security", "title_contains": "integrity"},
        ],
        window_seconds=30,
        result_severity="critical",
        result_title="Unauthorized modification — file change triggered integrity alert",
        description="File was modified AND integrity check flagged it",
    ),
    CorrelationRule(
        name="service_cascade_failure",
        events=[
            {"category": "service", "title_contains": "UNHEALTHY"},
            {"category": "service", "title_contains": "UNHEALTHY"},
            {"category": "service", "title_contains": "FAILED"},
        ],
        window_seconds=300,
        result_severity="critical",
        result_title="Service cascade failure — multiple services down",
    ),
    CorrelationRule(
        name="suspicious_file_burst",
        events=[
            {"category": "file", "title_contains": "created"},
            {"category": "file", "title_contains": "created"},
            {"category": "file", "title_contains": "created"},
            {"category": "file", "title_contains": "created"},
            {"category": "file", "title_contains": "created"},
        ],
        window_seconds=10,
        result_severity="suspicious",
        result_title="File burst — 5+ files created in 10 seconds",
    ),
    CorrelationRule(
        name="mass_deletion",
        events=[
            {"category": "file", "title_contains": "deleted"},
            {"category": "file", "title_contains": "deleted"},
            {"category": "file", "title_contains": "deleted"},
        ],
        window_seconds=10,
        result_severity="critical",
        result_title="Mass deletion — 3+ files deleted in 10 seconds",
    ),
]


class ActivityLedger:
    """
    Unified event stream with classification, correlation, and
    incident detection. All system events flow through here.
    """

    def __init__(self, audit, activity_tracker, max_events: int = 5000):
        self._audit = audit
        self._activity = activity_tracker
        self._max_events = max_events

        self._events: deque[LedgerEvent] = deque(maxlen=max_events)
        self._event_counter = 0
        self._lock = threading.Lock()

        self._callbacks: list[Callable] = []
        self._rules = list(_DEFAULT_RULES)

        # Severity classification patterns
        self._severity_overrides: dict[str, str] = {}

        # Playbook handlers: severity → list of async callbacks
        self._playbooks: dict[str, list[Callable]] = {
            "critical": [],
            "suspicious": [],
        }

        self._running = False
        self._thread: threading.Thread | None = None

    # ── Event Ingestion ───────────────────────────

    def record(
        self,
        category: str,
        title: str,
        source: str = "unknown",
        severity: str | None = None,
        details: dict | None = None,
        correlation_key: str = "",
    ) -> LedgerEvent:
        """Record an event into the ledger."""
        with self._lock:
            self._event_counter += 1
            eid = f"evt-{self._event_counter}"

        if severity is None:
            severity = self._classify(category, title, details or {})

        event = LedgerEvent(
            id=eid,
            timestamp=time.time(),
            category=category,
            severity=severity,
            source=source,
            title=title,
            details=details or {},
            correlation_key=correlation_key,
        )

        with self._lock:
            self._events.append(event)

        self._audit.log("ledger", "event", {
            "id": eid,
            "category": category,
            "severity": severity,
            "title": title,
        })

        # Fire callbacks
        for cb in self._callbacks:
            try:
                cb(event)
            except Exception:
                pass

        # Check for correlations
        self._check_correlations(event)

        return event

    # ── Convenience Ingestors ─────────────────────
    # These are wired into existing Nova modules as callbacks.

    def on_file_event(self, file_event):
        """Callback for FileWatcher events."""
        severity = "routine"
        path = getattr(file_event, "path", str(file_event))
        event_type = getattr(file_event, "event_type", "modified")

        # Classify based on path and type
        if event_type == "deleted":
            severity = "notable"
        if any(s in str(path) for s in ("security", "auth", "middleware", "password")):
            severity = "suspicious"
        if any(s in str(path) for s in (".env", "secret", "key", "token")):
            severity = "critical"

        self.record(
            category="file",
            title=f"File {event_type}: {path}",
            source="file_watcher",
            severity=severity,
            details={
                "path": str(path),
                "event_type": event_type,
                "size": getattr(file_event, "size", 0),
            },
        )

    def on_service_change(self, name: str, old_state: str, new_state: str, runtime: dict):
        """Callback for ServiceOverseer state changes."""
        severity_map = {
            "running": "routine",
            "starting": "routine",
            "stopped": "notable",
            "unhealthy": "suspicious",
            "restarting": "notable",
            "failed": "critical",
        }
        severity = severity_map.get(new_state, "notable")

        self.record(
            category="service",
            title=f"Service {name}: {old_state} → {new_state}",
            source="overseer",
            severity=severity,
            details={"service": name, "old": old_state, "new": new_state, **runtime},
            correlation_key=f"svc:{name}",
        )

    def on_process_event(self, process_dict: dict):
        """Callback for ProcessManager state changes."""
        state = process_dict.get("state", "unknown")
        name = process_dict.get("name", "unknown")
        severity = "routine" if state in ("RUNNING", "COMPLETED") else "notable"
        if state in ("FAILED", "TIMEOUT"):
            severity = "suspicious"

        self.record(
            category="process",
            title=f"Process {name}: {state}",
            source="process_manager",
            severity=severity,
            details=process_dict,
        )

    def on_security_alert(self, alert: dict):
        """Callback for AnomalyDetector alerts."""
        self.record(
            category="security",
            title=alert.get("title", "Security alert"),
            source="anomaly_detector",
            severity=alert.get("severity", "suspicious"),
            details=alert,
        )

    def on_command_executed(self, command: str, result: dict):
        """Track command execution."""
        success = result.get("success", False)
        severity = "routine" if success else "notable"

        self.record(
            category="command",
            title=f"Command {'OK' if success else 'FAIL'}: {command[:80]}",
            source="executor",
            severity=severity,
            details={"command": command, "result": result},
        )

    def on_system_alert(self, alert: dict):
        """Callback for SystemMonitor threshold alerts."""
        self.record(
            category="system",
            title=alert.get("message", "System alert"),
            source="system_monitor",
            severity="suspicious",
            details=alert,
        )

    # ── Classification ────────────────────────────

    def _classify(self, category: str, title: str, details: dict) -> str:
        """Auto-classify event severity based on patterns."""
        title_lower = title.lower()

        # Critical patterns
        if any(w in title_lower for w in (
            "integrity", "unauthorized", "failed", "critical",
            "cascade", "breach", "exploit", "injection",
        )):
            return "critical"

        # Suspicious patterns
        if any(w in title_lower for w in (
            "unhealthy", "suspicious", "anomaly", "unexpected",
            "blocked", "denied", "timeout",
        )):
            return "suspicious"

        # Notable patterns
        if any(w in title_lower for w in (
            "restart", "stopped", "deleted", "deploy", "config",
            "new connection", "port",
        )):
            return "notable"

        return "routine"

    # ── Correlation Engine ────────────────────────

    def _check_correlations(self, new_event: LedgerEvent):
        """Check if the new event completes any correlation pattern."""
        with self._lock:
            events_list = list(self._events)

        now = new_event.timestamp

        for rule in self._rules:
            window_start = now - rule.window_seconds
            recent = [e for e in events_list if e.timestamp >= window_start]

            # Check if all matchers are satisfied
            matched = 0
            for matcher in rule.events:
                for e in recent:
                    if e.category == matcher.get("category", e.category):
                        contains = matcher.get("title_contains", "")
                        if contains.lower() in e.title.lower():
                            matched += 1
                            break

            if matched >= len(rule.events):
                # Pattern matched — emit a correlated event
                self.record(
                    category="security",
                    title=rule.result_title,
                    source="correlator",
                    severity=rule.result_severity,
                    details={
                        "rule": rule.name,
                        "window_seconds": rule.window_seconds,
                        "matched_events": matched,
                    },
                    correlation_key=f"corr:{rule.name}",
                )

    # ── Playbooks ─────────────────────────────────

    def register_playbook(self, severity: str, handler: Callable):
        """Register an auto-response for events at a severity level."""
        if severity not in self._playbooks:
            self._playbooks[severity] = []
        self._playbooks[severity].append(handler)

    # ── Query ─────────────────────────────────────

    def get_events(
        self,
        count: int = 100,
        category: str | None = None,
        severity: str | None = None,
        since: float | None = None,
    ) -> list[dict]:
        """Get recent events with optional filters."""
        with self._lock:
            events = list(self._events)

        # Filter
        if category:
            events = [e for e in events if e.category == category]
        if severity:
            events = [e for e in events if e.severity == severity]
        if since:
            events = [e for e in events if e.timestamp >= since]

        # Return newest first
        events.sort(key=lambda e: e.timestamp, reverse=True)
        return [e.to_dict() for e in events[:count]]

    def get_summary(self, minutes: int = 60) -> dict:
        """Get event summary for the last N minutes."""
        cutoff = time.time() - (minutes * 60)
        with self._lock:
            recent = [e for e in self._events if e.timestamp >= cutoff]

        by_severity = {}
        by_category = {}
        for e in recent:
            by_severity[e.severity] = by_severity.get(e.severity, 0) + 1
            by_category[e.category] = by_category.get(e.category, 0) + 1

        return {
            "total_events": len(recent),
            "window_minutes": minutes,
            "by_severity": by_severity,
            "by_category": by_category,
            "critical_count": by_severity.get("critical", 0),
            "suspicious_count": by_severity.get("suspicious", 0),
        }

    def on_event(self, callback: Callable):
        """Register callback for all events: fn(LedgerEvent)"""
        self._callbacks.append(callback)

    def acknowledge(self, event_id: str) -> bool:
        """Mark an event as acknowledged."""
        with self._lock:
            for e in self._events:
                if e.id == event_id:
                    e.acknowledged = True
                    return True
        return False

    def get_status(self) -> dict:
        with self._lock:
            total = len(self._events)
            unacked = sum(1 for e in self._events
                          if not e.acknowledged and e.severity in ("critical", "suspicious"))
        return {
            "total_events": total,
            "unacknowledged_alerts": unacked,
            "rules_active": len(self._rules),
            "playbooks": {k: len(v) for k, v in self._playbooks.items()},
        }
