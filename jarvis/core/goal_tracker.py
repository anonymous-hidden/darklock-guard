"""
Nova — Goal Tracker
=====================
Multi-step goal management with decomposition.
When Cayden says "set up a server" or "build me a dashboard",
Nova breaks it into tracked subtasks and reports progress.

Stored in SQLite alongside the existing memory store.
"""

import json
import sqlite3
import threading
from datetime import datetime


def _now() -> str:
    return datetime.now().isoformat()


class GoalTracker:
    """Persistent goal tracking with step-by-step progress."""

    def __init__(self, db_path, audit, activity_tracker):
        self._db_path = str(db_path)
        self._audit = audit
        self._activity = activity_tracker
        self._lock = threading.Lock()
        self._init_db()

    def _conn(self):
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        conn = self._conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS goals (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                description TEXT DEFAULT '',
                status      TEXT DEFAULT 'active',
                priority    TEXT DEFAULT 'normal',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                completed_at TEXT DEFAULT NULL
            );
            CREATE TABLE IF NOT EXISTS goal_steps (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                goal_id     INTEGER NOT NULL,
                step_index  INTEGER NOT NULL,
                title       TEXT NOT NULL,
                status      TEXT DEFAULT 'pending',
                note        TEXT DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                FOREIGN KEY (goal_id) REFERENCES goals(id)
            );
        """)
        conn.commit()
        conn.close()

    # ── Create ─────────────────────────────────────

    def create_goal(self, title: str, description: str = "",
                    steps: list[str] = None, priority: str = "normal") -> dict:
        """Create a new goal with optional steps."""
        with self._lock:
            conn = self._conn()
            cur = conn.execute(
                "INSERT INTO goals (title, description, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (title, description, priority, _now(), _now()),
            )
            goal_id = cur.lastrowid
            
            step_dicts = []
            if steps:
                for i, step_title in enumerate(steps):
                    conn.execute(
                        "INSERT INTO goal_steps (goal_id, step_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (goal_id, i, step_title, _now(), _now()),
                    )
                    step_dicts.append({"index": i, "title": step_title, "status": "pending"})
            
            conn.commit()
            conn.close()

        self._audit.log("goals", "created", {"id": goal_id, "title": title, "steps": len(steps or [])})
        self._activity.system_event(f"🎯 Goal created: {title}", details={"id": goal_id})

        return {
            "id": goal_id,
            "title": title,
            "description": description,
            "status": "active",
            "priority": priority,
            "steps": step_dicts,
        }

    # ── Update step ────────────────────────────────

    def update_step(self, goal_id: int, step_index: int,
                    status: str = "done", note: str = "") -> dict:
        """Update a goal step. status: pending, in_progress, done, failed, skipped."""
        with self._lock:
            conn = self._conn()
            conn.execute(
                "UPDATE goal_steps SET status=?, note=?, updated_at=? WHERE goal_id=? AND step_index=?",
                (status, note, _now(), goal_id, step_index),
            )
            
            # Check if all steps are done → mark goal as completed
            rows = conn.execute(
                "SELECT status FROM goal_steps WHERE goal_id=?", (goal_id,)
            ).fetchall()
            all_done = all(r["status"] in ("done", "skipped") for r in rows) if rows else False
            
            if all_done and rows:
                conn.execute(
                    "UPDATE goals SET status='completed', completed_at=?, updated_at=? WHERE id=?",
                    (_now(), _now(), goal_id),
                )
            else:
                conn.execute(
                    "UPDATE goals SET updated_at=? WHERE id=?", (_now(), goal_id),
                )
            
            conn.commit()
            conn.close()

        self._audit.log("goals", "step_updated", {
            "goal_id": goal_id, "step": step_index, "status": status,
        })

        return {"goal_id": goal_id, "step_index": step_index, "status": status, "all_done": all_done}

    # ── Add step to existing goal ──────────────────

    def add_step(self, goal_id: int, title: str) -> dict:
        """Add a new step to an existing goal."""
        with self._lock:
            conn = self._conn()
            # Get next step index
            row = conn.execute(
                "SELECT MAX(step_index) as max_idx FROM goal_steps WHERE goal_id=?",
                (goal_id,),
            ).fetchone()
            next_idx = (row["max_idx"] or -1) + 1
            
            conn.execute(
                "INSERT INTO goal_steps (goal_id, step_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (goal_id, next_idx, title, _now(), _now()),
            )
            conn.commit()
            conn.close()

        return {"goal_id": goal_id, "step_index": next_idx, "title": title, "status": "pending"}

    # ── Query ──────────────────────────────────────

    def get_goal(self, goal_id: int) -> dict | None:
        conn = self._conn()
        goal = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not goal:
            conn.close()
            return None
        
        steps = conn.execute(
            "SELECT * FROM goal_steps WHERE goal_id=? ORDER BY step_index",
            (goal_id,),
        ).fetchall()
        conn.close()

        return {
            **dict(goal),
            "steps": [dict(s) for s in steps],
            "progress": self._calc_progress(steps),
        }

    def list_goals(self, status: str = "active") -> list[dict]:
        """List goals. status: active, completed, all."""
        conn = self._conn()
        if status == "all":
            goals = conn.execute("SELECT * FROM goals ORDER BY updated_at DESC").fetchall()
        else:
            goals = conn.execute(
                "SELECT * FROM goals WHERE status=? ORDER BY updated_at DESC", (status,)
            ).fetchall()
        
        result = []
        for g in goals:
            steps = conn.execute(
                "SELECT * FROM goal_steps WHERE goal_id=? ORDER BY step_index", (g["id"],)
            ).fetchall()
            result.append({
                **dict(g),
                "steps": [dict(s) for s in steps],
                "progress": self._calc_progress(steps),
            })
        
        conn.close()
        return result

    def get_active_summary(self) -> str:
        """Short summary of active goals for prompt injection."""
        goals = self.list_goals("active")
        if not goals:
            return ""
        lines = ["## Active Goals"]
        for g in goals[:5]:
            prog = g["progress"]
            lines.append(f"  🎯 {g['title']} — {prog['done']}/{prog['total']} steps ({prog['percent']}%)")
            for s in g["steps"]:
                icon = "✅" if s["status"] == "done" else "🔄" if s["status"] == "in_progress" else "⬜"
                lines.append(f"    {icon} {s['title']}")
        return "\n".join(lines)

    @staticmethod
    def _calc_progress(steps) -> dict:
        total = len(steps)
        if total == 0:
            return {"total": 0, "done": 0, "percent": 100}
        done = sum(1 for s in steps if s["status"] in ("done", "skipped"))
        return {"total": total, "done": done, "percent": round(done / total * 100)}

    # ── Cancel / delete ────────────────────────────

    def cancel_goal(self, goal_id: int) -> bool:
        with self._lock:
            conn = self._conn()
            cur = conn.execute(
                "UPDATE goals SET status='cancelled', updated_at=? WHERE id=?",
                (_now(), goal_id),
            )
            conn.commit()
            conn.close()
        return cur.rowcount > 0

    def delete_goal(self, goal_id: int) -> bool:
        with self._lock:
            conn = self._conn()
            conn.execute("DELETE FROM goal_steps WHERE goal_id=?", (goal_id,))
            cur = conn.execute("DELETE FROM goals WHERE id=?", (goal_id,))
            conn.commit()
            conn.close()
        return cur.rowcount > 0
