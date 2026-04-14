"""
Nova — CST Task Scheduler
===========================
Time-based task scheduling in Central Standard Time (CST / America/Chicago).

Features:
  • One-off and recurring scheduled tasks
  • Reminders with owner notification
  • Time-triggered AI actions
  • Persistent storage in SQLite
  • Background thread that fires events

All events are logged to the audit trail.
"""

import time
import json
import sqlite3
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CST = ZoneInfo("America/Chicago")


class ScheduledTask:
    """A single scheduled item."""
    __slots__ = ("id", "name", "action", "run_at", "repeat_seconds",
                 "enabled", "last_run", "created_at", "data")

    def __init__(self, *, id: int = 0, name: str = "", action: str = "",
                 run_at: str = "", repeat_seconds: int = 0,
                 enabled: bool = True, last_run: str = "",
                 created_at: str = "", data: str = "{}"):
        self.id = id
        self.name = name
        self.action = action          # "reminder" | "command" | "check"
        self.run_at = run_at          # ISO format in CST
        self.repeat_seconds = repeat_seconds  # 0 = one-shot
        self.enabled = enabled
        self.last_run = last_run
        self.created_at = created_at or _now_cst_iso()
        self.data = data

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "action": self.action,
            "run_at": self.run_at,
            "repeat_seconds": self.repeat_seconds,
            "enabled": self.enabled,
            "last_run": self.last_run,
            "created_at": self.created_at,
            "data": json.loads(self.data) if isinstance(self.data, str) else self.data,
        }


def _now_cst() -> datetime:
    return datetime.now(CST)


def _now_cst_iso() -> str:
    return _now_cst().isoformat()


class Scheduler:
    """Persistent time-based scheduler running on CST."""

    def __init__(self, db_path, audit, activity_tracker):
        self._db_path = str(db_path)
        self._audit = audit
        self._activity = activity_tracker
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
        self._callbacks: list[callable] = []
        self._init_db()

    # ── DB setup ───────────────────────────────────

    def _init_db(self):
        conn = sqlite3.connect(self._db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scheduled_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                action TEXT NOT NULL DEFAULT 'reminder',
                run_at TEXT NOT NULL,
                repeat_seconds INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                last_run TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                data TEXT DEFAULT '{}'
            )
        """)
        conn.commit()
        conn.close()

    def _conn(self):
        return sqlite3.connect(self._db_path)

    # ── CRUD ───────────────────────────────────────

    def add_task(self, name: str, run_at: str, action: str = "reminder",
                 repeat_seconds: int = 0, data: dict | None = None) -> int:
        """Schedule a new task. run_at should be ISO format in CST."""
        with self._lock:
            conn = self._conn()
            cur = conn.execute(
                "INSERT INTO scheduled_tasks (name, action, run_at, repeat_seconds, created_at, data) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, action, run_at, repeat_seconds, _now_cst_iso(),
                 json.dumps(data or {}))
            )
            tid = cur.lastrowid
            conn.commit()
            conn.close()

        self._audit.log("scheduler", "task_added", {
            "id": tid, "name": name, "action": action, "run_at": run_at})
        self._activity.task_update(
            f"⏰ Scheduled: {name} at {run_at}", details={"id": tid, "action": action})
        return tid

    def remove_task(self, task_id: int) -> bool:
        with self._lock:
            conn = self._conn()
            cur = conn.execute("DELETE FROM scheduled_tasks WHERE id = ?", (task_id,))
            conn.commit()
            conn.close()
        deleted = cur.rowcount > 0
        if deleted:
            self._audit.log("scheduler", "task_removed", {"id": task_id})
        return deleted

    def toggle_task(self, task_id: int, enabled: bool) -> bool:
        with self._lock:
            conn = self._conn()
            cur = conn.execute(
                "UPDATE scheduled_tasks SET enabled = ? WHERE id = ?",
                (int(enabled), task_id))
            conn.commit()
            conn.close()
        return cur.rowcount > 0

    def list_tasks(self, active_only: bool = False) -> list[dict]:
        conn = self._conn()
        if active_only:
            rows = conn.execute(
                "SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY run_at").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM scheduled_tasks ORDER BY run_at").fetchall()
        conn.close()
        return [self._row_to_dict(r) for r in rows]

    def get_task(self, task_id: int) -> dict | None:
        conn = self._conn()
        row = conn.execute(
            "SELECT * FROM scheduled_tasks WHERE id = ?", (task_id,)).fetchone()
        conn.close()
        return self._row_to_dict(row) if row else None

    def _row_to_dict(self, row) -> dict:
        return ScheduledTask(
            id=row[0], name=row[1], action=row[2], run_at=row[3],
            repeat_seconds=row[4], enabled=bool(row[5]), last_run=row[6],
            created_at=row[7], data=row[8],
        ).to_dict()

    # ── Scheduling helpers ─────────────────────────

    def schedule_reminder(self, name: str, minutes_from_now: int = 0,
                          at_time: str = "", message: str = "") -> int:
        """Quick helper: schedule a reminder either N minutes from now or at a specific time."""
        if at_time:
            run_at = at_time
        else:
            dt = _now_cst() + timedelta(minutes=minutes_from_now)
            run_at = dt.isoformat()

        return self.add_task(name, run_at, action="reminder",
                             data={"message": message or name})

    def schedule_recurring(self, name: str, interval_seconds: int,
                           action: str = "check", data: dict | None = None) -> int:
        """Schedule a recurring task starting now."""
        return self.add_task(name, _now_cst_iso(), action=action,
                             repeat_seconds=interval_seconds, data=data)

    def now_cst(self) -> str:
        """Return current time in CST as ISO string."""
        return _now_cst_iso()

    # ── Callbacks ──────────────────────────────────

    def on_fire(self, callback):
        """Register a callback: callback(task_dict) called when a task fires."""
        self._callbacks.append(callback)

    # ── Background loop ────────────────────────────

    def _fire_task(self, task_dict: dict):
        """Execute a fired task."""
        self._audit.log("scheduler", "task_fired", task_dict)
        self._activity.system_event(
            f"⏰ Fired: {task_dict['name']}",
            details={"action": task_dict["action"], "data": task_dict["data"]})

        for cb in self._callbacks:
            try:
                cb(task_dict)
            except Exception as e:
                self._audit.log("scheduler", "callback_error", {
                    "task_id": task_dict["id"], "error": str(e)[:200]})

    def _check_and_fire(self):
        """Check for due tasks and fire them."""
        now = _now_cst()
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM scheduled_tasks WHERE enabled = 1").fetchall()
        conn.close()

        for row in rows:
            task = ScheduledTask(
                id=row[0], name=row[1], action=row[2], run_at=row[3],
                repeat_seconds=row[4], enabled=bool(row[5]), last_run=row[6],
                created_at=row[7], data=row[8],
            )

            try:
                run_dt = datetime.fromisoformat(task.run_at)
                if run_dt.tzinfo is None:
                    run_dt = run_dt.replace(tzinfo=CST)
            except ValueError:
                continue

            if now >= run_dt:
                self._fire_task(task.to_dict())

                with self._lock:
                    conn = self._conn()
                    if task.repeat_seconds > 0:
                        next_run = (now + timedelta(seconds=task.repeat_seconds)).isoformat()
                        conn.execute(
                            "UPDATE scheduled_tasks SET run_at = ?, last_run = ? WHERE id = ?",
                            (next_run, now.isoformat(), task.id))
                    else:
                        conn.execute(
                            "UPDATE scheduled_tasks SET enabled = 0, last_run = ? WHERE id = ?",
                            (now.isoformat(), task.id))
                    conn.commit()
                    conn.close()

    def _loop(self, interval: float):
        self._audit.log("scheduler", "started", {
            "interval": interval, "timezone": "America/Chicago"})
        while self._running:
            try:
                self._check_and_fire()
            except Exception as e:
                self._audit.log("scheduler", "loop_error", {"error": str(e)[:200]})
            time.sleep(interval)

    def start(self, interval: float = 10):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True, name="scheduler")
        self._thread.start()

    def stop(self):
        self._running = False

    def get_status(self) -> dict:
        tasks = self.list_tasks()
        active = [t for t in tasks if t["enabled"]]
        return {
            "running": self._running,
            "timezone": "America/Chicago (CST)",
            "current_time": _now_cst_iso(),
            "total_tasks": len(tasks),
            "active_tasks": len(active),
        }
