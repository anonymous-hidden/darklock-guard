"""
Nova — Activity Tracker
=========================
Tracks all AI decisions, reasoning, current tasks, recent actions, and active
processes.  Provides a unified feed for the Activity Dashboard.

Every action is logged through the audit system — nothing is silent.
"""

import time
import threading
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class Activity:
    ts: float
    category: str          # decision | action | process | task | system
    summary: str
    details: dict = field(default_factory=dict)
    reasoning: str = ""
    status: str = "completed"  # in_progress | completed | failed
    id: str = ""

    def to_dict(self):
        d = asdict(self)
        d["ts"] = round(d["ts"], 3)
        return d


class ActivityTracker:
    """Central registry of everything Nova does — fully transparent."""

    MAX_FEED = 500          # rolling window of recent activities
    MAX_PROCESSES = 50      # active process slots

    def __init__(self, audit):
        self._audit = audit
        self._lock = threading.Lock()
        self._feed: deque[Activity] = deque(maxlen=self.MAX_FEED)
        self._active_processes: dict[str, Activity] = {}
        self._counter = 0

    # ── Recording ──────────────────────────────────

    def _next_id(self) -> str:
        with self._lock:
            self._counter += 1
            return f"act_{self._counter}"

    def record(self, category: str, summary: str, *,
               details: dict | None = None, reasoning: str = "",
               status: str = "completed") -> str:
        """Record an activity and log it to the audit trail."""
        aid = self._next_id()
        act = Activity(
            ts=time.time(),
            category=category,
            summary=summary,
            details=details or {},
            reasoning=reasoning,
            status=status,
            id=aid,
        )
        with self._lock:
            self._feed.appendleft(act)
        self._audit.log("activity", f"{category}:{status}", {
            "id": aid, "summary": summary, "reasoning": reasoning, **(details or {})
        })
        return aid

    def start_process(self, name: str, details: dict | None = None) -> str:
        """Mark a long-running process as active."""
        aid = self.record("process", name, details=details, status="in_progress")
        with self._lock:
            self._active_processes[aid] = self._feed[0]
        return aid

    def end_process(self, process_id: str, status: str = "completed"):
        """Mark a previously started process as done."""
        with self._lock:
            proc = self._active_processes.pop(process_id, None)
        if proc:
            self.record("process", f"{proc.summary} — {status}",
                        details={"ref": process_id}, status=status)

    def decision(self, summary: str, reasoning: str, details: dict | None = None) -> str:
        """Record an AI decision with its reasoning chain."""
        return self.record("decision", summary, reasoning=reasoning, details=details)

    def action(self, summary: str, details: dict | None = None, status: str = "completed") -> str:
        return self.record("action", summary, details=details, status=status)

    def task_update(self, summary: str, details: dict | None = None) -> str:
        return self.record("task", summary, details=details)

    def system_event(self, summary: str, details: dict | None = None) -> str:
        return self.record("system", summary, details=details)

    # ── Queries ────────────────────────────────────

    def recent(self, count: int = 50, category: str | None = None) -> list[dict]:
        with self._lock:
            items = list(self._feed)
        if category:
            items = [a for a in items if a.category == category]
        return [a.to_dict() for a in items[:count]]

    def active_processes(self) -> list[dict]:
        with self._lock:
            return [a.to_dict() for a in self._active_processes.values()]

    def stats(self) -> dict:
        with self._lock:
            items = list(self._feed)
        by_cat = {}
        for a in items:
            by_cat[a.category] = by_cat.get(a.category, 0) + 1
        return {
            "total": len(items),
            "active_processes": len(self._active_processes),
            "by_category": by_cat,
        }
