"""Calendar connector — provider-agnostic scaffold (ICS + briefing)."""
from __future__ import annotations
import os
from datetime import datetime, timedelta
from pathlib import Path
from .base import BaseConnector, ConnectorAction, ConnectorResult


class CalendarConnector(BaseConnector):
    name = "calendar"
    description = "Read upcoming events (ICS file) and build briefings."
    risk = "low"

    def __init__(self, cfg=None, logger=None):
        super().__init__(cfg, logger)
        self.provider = os.environ.get(self.cfg.get("provider_env", ""), "ics")
        self.token_path = os.environ.get(self.cfg.get("token_path_env", ""), "")

    def is_configured(self) -> bool:
        return bool(self.token_path) and Path(self.token_path).exists()

    def _register_actions(self) -> None:
        self.register(ConnectorAction("upcoming", "Next N events", "read",
                                      handler=self._upcoming))
        self.register(ConnectorAction("briefing", "Today + tomorrow briefing", "read",
                                      handler=self._briefing))

    def _parse_ics(self) -> list[dict]:
        if not self.is_configured():
            return []
        try:
            text = Path(self.token_path).read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return []
        events = []
        cur: dict = {}
        for line in text.splitlines():
            if line == "BEGIN:VEVENT":
                cur = {}
            elif line == "END:VEVENT":
                if cur:
                    events.append(cur)
            elif line.startswith("SUMMARY:"):
                cur["summary"] = line[8:]
            elif line.startswith("DTSTART"):
                cur["start"] = line.split(":", 1)[-1]
            elif line.startswith("DTEND"):
                cur["end"] = line.split(":", 1)[-1]
        return events

    def _upcoming(self, *, limit: int = 10) -> dict:
        events = self._parse_ics()[:limit]
        return {"ok": True, "events": events, "source": self.token_path or "(none)"}

    def _briefing(self) -> dict:
        events = self._parse_ics()
        today = datetime.now().strftime("%Y%m%d")
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y%m%d")
        t = [e for e in events if e.get("start", "").startswith(today)]
        m = [e for e in events if e.get("start", "").startswith(tomorrow)]
        return {"ok": True, "today": t, "tomorrow": m,
                "count_today": len(t), "count_tomorrow": len(m)}
