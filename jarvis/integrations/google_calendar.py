"""
Nova — Google Calendar Integration
=====================================
Read, create, update, and delete events via Google Calendar API v3.
Uses OAuth 2.0 credentials from google_auth module.
"""

from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from googleapiclient.discovery import build

from integrations.google_auth import get_credentials

# Cayden's timezone (from config: scheduler.timezone = "America/Chicago")
DEFAULT_TZ = "America/Chicago"


class GoogleCalendarClient:
    """Async-friendly Google Calendar client (sync under the hood — API is fast)."""

    def __init__(self, timezone: str = DEFAULT_TZ):
        self._tz = ZoneInfo(timezone)
        self._service = None

    def _svc(self):
        if self._service is None:
            creds = get_credentials()
            self._service = build("calendar", "v3", credentials=creds)
        return self._service

    # ── Read operations ──

    def get_events(self, start: datetime, end: datetime, max_results: int = 20) -> list[dict]:
        """Fetch events in a time range. Returns simplified event dicts."""
        svc = self._svc()
        result = svc.events().list(
            calendarId="primary",
            timeMin=start.isoformat(),
            timeMax=end.isoformat(),
            maxResults=max_results,
            singleEvents=True,
            orderBy="startTime",
        ).execute()

        events = []
        for ev in result.get("items", []):
            events.append(self._simplify(ev))
        return events

    def get_today(self) -> list[dict]:
        """Get all events for today."""
        now = datetime.now(self._tz)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return self.get_events(start, end)

    def get_tomorrow(self) -> list[dict]:
        """Get all events for tomorrow."""
        now = datetime.now(self._tz)
        start = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        return self.get_events(start, end)

    def get_upcoming(self, days: int = 7, max_results: int = 20) -> list[dict]:
        """Get upcoming events for the next N days."""
        now = datetime.now(self._tz)
        end = now + timedelta(days=days)
        return self.get_events(now, end, max_results)

    def get_next_event(self) -> Optional[dict]:
        """Get the very next upcoming event."""
        now = datetime.now(self._tz)
        end = now + timedelta(days=7)
        events = self.get_events(now, end, max_results=1)
        return events[0] if events else None

    # ── Write operations ──

    def create_event(self, summary: str, start: datetime, end: datetime,
                     description: str = "", location: str = "") -> dict:
        """Create a new calendar event."""
        svc = self._svc()
        body = {
            "summary": summary,
            "start": {"dateTime": start.isoformat(), "timeZone": str(self._tz)},
            "end": {"dateTime": end.isoformat(), "timeZone": str(self._tz)},
        }
        if description:
            body["description"] = description
        if location:
            body["location"] = location

        ev = svc.events().insert(calendarId="primary", body=body).execute()
        return self._simplify(ev)

    def create_quick_event(self, text: str) -> dict:
        """Create event from natural language (Google's quickAdd).
        Examples: 'Meeting at 3pm tomorrow', 'Lunch with Bob Friday at noon'
        """
        svc = self._svc()
        ev = svc.events().quickAdd(calendarId="primary", text=text).execute()
        return self._simplify(ev)

    def update_event(self, event_id: str, **kwargs) -> dict:
        """Update an existing event. Accepts: summary, start, end, description, location."""
        svc = self._svc()
        ev = svc.events().get(calendarId="primary", eventId=event_id).execute()

        if "summary" in kwargs:
            ev["summary"] = kwargs["summary"]
        if "description" in kwargs:
            ev["description"] = kwargs["description"]
        if "location" in kwargs:
            ev["location"] = kwargs["location"]
        if "start" in kwargs:
            ev["start"] = {"dateTime": kwargs["start"].isoformat(), "timeZone": str(self._tz)}
        if "end" in kwargs:
            ev["end"] = {"dateTime": kwargs["end"].isoformat(), "timeZone": str(self._tz)}

        updated = svc.events().update(calendarId="primary", eventId=event_id, body=ev).execute()
        return self._simplify(updated)

    def delete_event(self, event_id: str) -> bool:
        """Delete a calendar event by ID."""
        svc = self._svc()
        svc.events().delete(calendarId="primary", eventId=event_id).execute()
        return True

    # ── Helpers ──

    def _simplify(self, ev: dict) -> dict:
        """Convert a raw Google Calendar event to a clean dict."""
        start_raw = ev.get("start", {})
        end_raw = ev.get("end", {})

        # Handle all-day events (date) vs timed events (dateTime)
        start_str = start_raw.get("dateTime") or start_raw.get("date", "")
        end_str = end_raw.get("dateTime") or end_raw.get("date", "")

        # Parse into readable format
        start_display = self._format_time(start_str)
        end_display = self._format_time(end_str)

        return {
            "id": ev.get("id", ""),
            "summary": ev.get("summary", "(No title)"),
            "start": start_str,
            "end": end_str,
            "start_display": start_display,
            "end_display": end_display,
            "location": ev.get("location", ""),
            "description": ev.get("description", ""),
            "all_day": "date" in start_raw and "dateTime" not in start_raw,
            "link": ev.get("htmlLink", ""),
        }

    def _format_time(self, iso_str: str) -> str:
        """Format ISO datetime for display."""
        if not iso_str:
            return ""
        try:
            # Full datetime
            if "T" in iso_str:
                dt = datetime.fromisoformat(iso_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=self._tz)
                return dt.astimezone(self._tz).strftime("%-I:%M %p")
            else:
                # All-day event — just date
                return datetime.fromisoformat(iso_str).strftime("%B %-d")
        except (ValueError, TypeError):
            return iso_str

    def format_events_text(self, events: list[dict]) -> str:
        """Format a list of events as readable text."""
        if not events:
            return "No events."
        lines = []
        for ev in events:
            time_str = ev["start_display"]
            if ev["all_day"]:
                time_str = "All day"
            elif ev.get("end_display"):
                time_str += f" - {ev['end_display']}"
            line = f"• {time_str}: {ev['summary']}"
            if ev.get("location"):
                line += f" ({ev['location']})"
            lines.append(line)
        return "\n".join(lines)
