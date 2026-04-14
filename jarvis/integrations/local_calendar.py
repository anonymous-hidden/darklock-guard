"""
Nova — Local Calendar
======================
SQLite-backed calendar with the same interface as GoogleCalendarClient.
Events are stored locally in data/calendar.db.
"""

import re
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

DEFAULT_TZ = "America/Chicago"
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "calendar.db"


class LocalCalendarClient:
    """Thread-safe local calendar backed by SQLite."""

    def __init__(self, timezone: str = DEFAULT_TZ):
        self._tz = ZoneInfo(timezone)
        self._local = threading.local()
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(str(DB_PATH))
            self._local.conn.row_factory = sqlite3.Row
            self._local.conn.execute("PRAGMA journal_mode=WAL")
        return self._local.conn

    def _init_db(self):
        c = self._conn()
        c.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id          TEXT PRIMARY KEY,
                summary     TEXT NOT NULL,
                start       TEXT NOT NULL,
                end         TEXT NOT NULL,
                description TEXT DEFAULT '',
                location    TEXT DEFAULT '',
                all_day     INTEGER DEFAULT 0,
                calendar    TEXT DEFAULT 'personal',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
            CREATE INDEX IF NOT EXISTS idx_events_end   ON events(end);
        """)
        c.commit()

    # ── Read operations ──

    def get_events(self, start: datetime, end: datetime, max_results: int = 20) -> list[dict]:
        c = self._conn()
        rows = c.execute(
            "SELECT * FROM events WHERE end >= ? AND start <= ? ORDER BY start LIMIT ?",
            (start.isoformat(), end.isoformat(), max_results),
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_today(self) -> list[dict]:
        now = datetime.now(self._tz)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return self.get_events(start, end)

    def get_tomorrow(self) -> list[dict]:
        now = datetime.now(self._tz)
        start = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return self.get_events(start, end)

    def get_upcoming(self, days: int = 7, max_results: int = 20) -> list[dict]:
        now = datetime.now(self._tz)
        end = now + timedelta(days=days)
        return self.get_events(now, end, max_results)

    def get_next_event(self) -> Optional[dict]:
        now = datetime.now(self._tz)
        end = now + timedelta(days=7)
        events = self.get_events(now, end, max_results=1)
        return events[0] if events else None

    # ── Write operations ──

    def create_event(self, summary: str, start: datetime, end: datetime,
                     description: str = "", location: str = "") -> dict:
        event_id = uuid.uuid4().hex[:16]
        now_iso = datetime.now(self._tz).isoformat()
        if start.tzinfo is None:
            start = start.replace(tzinfo=self._tz)
        if end.tzinfo is None:
            end = end.replace(tzinfo=self._tz)
        c = self._conn()
        c.execute(
            "INSERT INTO events (id, summary, start, end, description, location, all_day, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
            (event_id, summary, start.isoformat(), end.isoformat(), description, location, now_iso, now_iso),
        )
        c.commit()
        return self._make_dict(event_id, summary, start.isoformat(), end.isoformat(),
                               description, location, False)

    def create_quick_event(self, text: str) -> dict:
        """Parse natural language into an event with date/time extraction."""
        summary, start, end = self._parse_natural_datetime(text)
        return self.create_event(summary=summary, start=start, end=end)

    def _parse_natural_datetime(self, text: str):
        """Extract date, time, and event summary from natural language."""
        now = datetime.now(self._tz)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        work = text
        lower = work.lower()

        # --- Extract time ---
        time_hour = time_min = None
        m = re.search(r'\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b', lower, re.I)
        if m:
            time_hour = int(m.group(1))
            time_min = int(m.group(2) or 0)
            if m.group(3).lower() == 'pm' and time_hour != 12:
                time_hour += 12
            elif m.group(3).lower() == 'am' and time_hour == 12:
                time_hour = 0
            work = work[:m.start()] + work[m.end():]
            lower = work.lower()
        else:
            m = re.search(r'\bat\s+noon\b', lower, re.I)
            if m:
                time_hour, time_min = 12, 0
                work = work[:m.start()] + work[m.end():]
                lower = work.lower()
            else:
                m = re.search(r'\bat\s+midnight\b', lower, re.I)
                if m:
                    time_hour, time_min = 0, 0
                    work = work[:m.start()] + work[m.end():]
                    lower = work.lower()

        # --- Extract date ---
        target_date = None
        if re.search(r'\btomorrow\b', lower):
            target_date = today + timedelta(days=1)
            work = re.sub(r'\btomorrow\b', '', work, flags=re.I)
        elif re.search(r'\btoday\b', lower):
            target_date = today
            work = re.sub(r'\btoday\b', '', work, flags=re.I)
        else:
            days_list = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            day_pat = re.compile(r'\b(?:next\s+|on\s+|this\s+)?(' + '|'.join(days_list) + r')\b', re.I)
            m = day_pat.search(lower)
            if m:
                target_day_idx = days_list.index(m.group(1).lower())
                delta = (target_day_idx - today.weekday()) % 7
                if delta == 0:
                    delta = 7
                prefix = lower[max(0, m.start()-5):m.start()]
                if 'next' in prefix:
                    delta += 7
                target_date = today + timedelta(days=delta)
                work = work[:m.start()] + work[m.end():]

        # Default date
        if target_date is None:
            if time_hour is not None:
                target_date = today
                if time_hour < now.hour or (time_hour == now.hour and (time_min or 0) <= now.minute):
                    target_date = today + timedelta(days=1)
            else:
                target_date = today + timedelta(days=1)

        # Build start/end
        if time_hour is not None:
            start = target_date.replace(hour=time_hour, minute=time_min or 0)
        else:
            start = target_date.replace(hour=9, minute=0)
        end = start + timedelta(hours=1)

        # Clean summary
        summary = re.sub(r'\b(?:add|create|schedule|put|set\s+up|make)\b', '', work, flags=re.I)
        summary = re.sub(r'\b(?:an?\s+)?(?:event|appointment|meeting|reminder)\b', '', summary, flags=re.I)
        summary = re.sub(r'\b(?:to|on|in|for)\s+(?:my\s+)?(?:calendar|schedule)\b', '', summary, flags=re.I)
        summary = re.sub(r'\b(?:called|named|titled)\b', '', summary, flags=re.I)
        summary = re.sub(r'\s+', ' ', summary).strip(' ,-\u2013:')
        if not summary:
            summary = "New Event"

        return summary, start, end

    def update_event(self, event_id: str, **kwargs) -> dict:
        c = self._conn()
        row = c.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        if not row:
            raise ValueError(f"Event {event_id} not found")
        updates = {}
        if "summary" in kwargs:
            updates["summary"] = kwargs["summary"]
        if "description" in kwargs:
            updates["description"] = kwargs["description"]
        if "location" in kwargs:
            updates["location"] = kwargs["location"]
        if "start" in kwargs:
            s = kwargs["start"]
            updates["start"] = s.isoformat() if isinstance(s, datetime) else s
        if "end" in kwargs:
            e = kwargs["end"]
            updates["end"] = e.isoformat() if isinstance(e, datetime) else e
        if updates:
            updates["updated_at"] = datetime.now(self._tz).isoformat()
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            c.execute(f"UPDATE events SET {set_clause} WHERE id = ?",
                      (*updates.values(), event_id))
            c.commit()
        row = c.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return self._row_to_dict(row)

    def delete_event(self, event_id: str) -> bool:
        c = self._conn()
        c.execute("DELETE FROM events WHERE id = ?", (event_id,))
        c.commit()
        return True

    # ── Helpers ──

    def _row_to_dict(self, row: sqlite3.Row) -> dict:
        return self._make_dict(
            row["id"], row["summary"], row["start"], row["end"],
            row["description"], row["location"], bool(row["all_day"]),
        )

    def _make_dict(self, event_id: str, summary: str, start: str, end: str,
                   description: str = "", location: str = "", all_day: bool = False) -> dict:
        return {
            "id": event_id,
            "summary": summary,
            "start": start,
            "end": end,
            "start_display": self._format_time(start),
            "end_display": self._format_time(end),
            "location": location,
            "description": description,
            "all_day": all_day,
            "link": "",
        }

    def _format_time(self, iso_str: str) -> str:
        if not iso_str:
            return ""
        try:
            if "T" in iso_str:
                dt = datetime.fromisoformat(iso_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=self._tz)
                return dt.astimezone(self._tz).strftime("%-I:%M %p")
            else:
                return datetime.fromisoformat(iso_str).strftime("%B %-d")
        except (ValueError, TypeError):
            return iso_str

    def format_events_text(self, events: list[dict]) -> str:
        if not events:
            return "No events."
        lines = []
        current_date = None
        for ev in events:
            # Group events by date
            try:
                dt = datetime.fromisoformat(ev["start"])
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=self._tz)
                dt = dt.astimezone(self._tz)
                date_str = dt.strftime("%A, %B %-d")
            except (ValueError, TypeError):
                date_str = "Unknown date"

            if date_str != current_date:
                if current_date is not None:
                    lines.append("")
                lines.append(f"{date_str}:")
                current_date = date_str

            time_str = ev["start_display"]
            if ev["all_day"]:
                time_str = "All day"
            elif ev.get("end_display"):
                time_str += f" - {ev['end_display']}"
            line = f"  • {time_str}: {ev['summary']}"
            if ev.get("location"):
                line += f" ({ev['location']})"
            lines.append(line)
        return "\n".join(lines)
