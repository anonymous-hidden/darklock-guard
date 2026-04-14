"""
Nova — Skill Memory
====================
When Nova successfully completes a multi-step procedure,
she can save it as a reusable "skill" and recall it later.

"I've done this before. Let me pull up the steps."

Skills are stored in SQLite alongside goals and knowledge.
"""

import json
import sqlite3
import threading
from datetime import datetime


def _now() -> str:
    return datetime.now().isoformat()


class SkillMemory:
    """Persistent skill library — learned procedures Nova can replay."""

    def __init__(self, db_path, audit):
        self._db_path = str(db_path)
        self._audit = audit
        self._lock = threading.Lock()
        self._init_db()

    def _conn(self):
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        conn = self._conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS skills (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                name         TEXT NOT NULL UNIQUE,
                description  TEXT DEFAULT '',
                steps        TEXT DEFAULT '[]',
                tags         TEXT DEFAULT '[]',
                success_count INTEGER DEFAULT 0,
                fail_count   INTEGER DEFAULT 0,
                last_used_at TEXT DEFAULT NULL,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            );
        """)
        conn.commit()
        conn.close()

    # ── Save ───────────────────────────────────────

    def save_skill(self, name: str, description: str = "",
                   steps: list[str] = None, tags: list[str] = None) -> dict:
        """Save a new skill or update an existing one."""
        steps_json = json.dumps(steps or [])
        tags_json = json.dumps(tags or [])
        
        with self._lock:
            conn = self._conn()
            existing = conn.execute("SELECT id FROM skills WHERE name=?", (name,)).fetchone()
            
            if existing:
                conn.execute(
                    "UPDATE skills SET description=?, steps=?, tags=?, updated_at=? WHERE name=?",
                    (description, steps_json, tags_json, _now(), name),
                )
                skill_id = existing["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO skills (name, description, steps, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, description, steps_json, tags_json, _now(), _now()),
                )
                skill_id = cur.lastrowid
            
            conn.commit()
            conn.close()

        self._audit.log("skills", "saved", {"id": skill_id, "name": name})
        return {"id": skill_id, "name": name, "description": description, "steps": steps or [], "tags": tags or []}

    # ── Record outcome ─────────────────────────────

    def record_success(self, name: str):
        """Increment success counter and update last_used."""
        with self._lock:
            conn = self._conn()
            conn.execute(
                "UPDATE skills SET success_count=success_count+1, last_used_at=?, updated_at=? WHERE name=?",
                (_now(), _now(), name),
            )
            conn.commit()
            conn.close()

    def record_failure(self, name: str):
        """Increment failure counter."""
        with self._lock:
            conn = self._conn()
            conn.execute(
                "UPDATE skills SET fail_count=fail_count+1, updated_at=? WHERE name=?",
                (_now(), name),
            )
            conn.commit()
            conn.close()

    # ── Lookup ─────────────────────────────────────

    def find_skill(self, query: str) -> list[dict]:
        """Search skills by name, description, or tags."""
        conn = self._conn()
        # SQLite LIKE search across name, description, and tags
        pattern = f"%{query}%"
        rows = conn.execute(
            "SELECT * FROM skills WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY success_count DESC",
            (pattern, pattern, pattern),
        ).fetchall()
        conn.close()
        return [self._row_to_dict(r) for r in rows]

    def get_skill(self, name: str) -> dict | None:
        conn = self._conn()
        row = conn.execute("SELECT * FROM skills WHERE name=?", (name,)).fetchone()
        conn.close()
        return self._row_to_dict(row) if row else None

    def list_skills(self, limit: int = 20) -> list[dict]:
        """List most-used skills."""
        conn = self._conn()
        rows = conn.execute(
            "SELECT * FROM skills ORDER BY success_count DESC, updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        conn.close()
        return [self._row_to_dict(r) for r in rows]

    def get_prompt_summary(self) -> str:
        """Short skill list for prompt injection — top 10 most reliable."""
        conn = self._conn()
        rows = conn.execute(
            "SELECT name, description, success_count FROM skills WHERE success_count > 0 ORDER BY success_count DESC LIMIT 10"
        ).fetchall()
        conn.close()
        if not rows:
            return ""
        lines = ["## Known Skills"]
        for r in rows:
            lines.append(f"  • {r['name']} ({r['success_count']}x) — {r['description'][:60]}")
        return "\n".join(lines)

    # ── Delete ─────────────────────────────────────

    def delete_skill(self, name: str) -> bool:
        with self._lock:
            conn = self._conn()
            cur = conn.execute("DELETE FROM skills WHERE name=?", (name,))
            conn.commit()
            conn.close()
        return cur.rowcount > 0

    # ── Internal ───────────────────────────────────

    @staticmethod
    def _row_to_dict(row) -> dict:
        d = dict(row)
        d["steps"] = json.loads(d.get("steps", "[]"))
        d["tags"] = json.loads(d.get("tags", "[]"))
        return d
