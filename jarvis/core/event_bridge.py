"""
Nova — Event Bridge
====================
Routes events from all Nova subsystems into the Conversation Engine
for evaluation through the decision layer.

Event Sources:
  • Health Monitor → service up/down alerts
  • Calendar → upcoming events, reminders
  • Scheduler → timed interactions (morning update, etc.)
  • System → disk space, high CPU, etc.

This replaces direct broadcasting — everything goes through
the decision layer first.
"""

import logging
import time
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

from logs.audit import AuditLogger

CST = ZoneInfo("America/Chicago")
logger = logging.getLogger(__name__)


class EventBridge:
    """
    Connects all event sources to the ConversationEngine.
    
    Each tick, checks all sources and pushes relevant events
    into the conversation engine's queue for decision evaluation.
    """

    def __init__(self, conversation_engine, audit: AuditLogger):
        self._engine = conversation_engine
        self._audit = audit

        # Subsystem references (set after construction)
        self._health_monitor = None
        self._scheduler = None

        # Track what we've already pushed (avoid duplicates)
        self._alerted_services: set[str] = set()
        self._recovered_services: set[str] = set()
        self._last_calendar_check = 0.0
        self._notified_events: set[str] = set()

        # Cooldowns
        self._alert_cooldown: dict[str, float] = {}

        # Background loop
        self._running = False
        self._thread: threading.Thread | None = None

    # ── Dependency Injection ──────────────────────────

    def set_health_monitor(self, hm):
        self._health_monitor = hm

    def set_scheduler(self, sched):
        self._scheduler = sched

    # ── Health Events ─────────────────────────────────

    def _check_health(self):
        """Poll health monitor and push events for failures/recoveries."""
        if not self._health_monitor:
            return

        status = self._health_monitor.get_status()
        services = status.get("services", {})
        failures = status.get("consecutive_failures", {})
        now = time.time()

        for name, info in services.items():
            if not info["healthy"]:
                # Service is down
                last_alert = self._alert_cooldown.get(name, 0)
                if now - last_alert < 120:
                    continue  # Cooldown

                consecutive = failures.get(name, 1)

                if name not in self._alerted_services:
                    # First failure
                    self._alerted_services.add(name)
                    self._recovered_services.discard(name)

                    priority = "critical" if name in ("darklock", "pi5") else (
                        "high" if consecutive >= 3 else "normal"
                    )

                    self._engine.push_event("event_health", {
                        "priority": priority,
                        "message": self._format_health_alert(name, info, consecutive),
                        "service": name,
                        "direct": True,
                    })
                    self._alert_cooldown[name] = now

                elif consecutive >= 3 and consecutive % 3 == 0:
                    # Escalation
                    self._engine.push_event("event_health", {
                        "priority": "high",
                        "message": (
                            f"{name} has been down for {consecutive} checks now. "
                            f"Still seeing: {info['message']}. Might need manual attention."
                        ),
                        "service": name,
                        "direct": True,
                    })
                    self._alert_cooldown[name] = now

            elif name in self._alerted_services:
                # Service recovered
                if name not in self._recovered_services:
                    self._recovered_services.add(name)
                    self._alerted_services.discard(name)
                    self._engine.push_event("event_health", {
                        "priority": "normal",
                        "message": f"{name} is back up. {info['message']}",
                        "service": name,
                        "direct": True,
                    })

    def _format_health_alert(self, name: str, info: dict, count: int) -> str:
        if name == "darklock":
            return f"Darklock just went down — {info['message']}. Want me to try restarting it?"
        elif name == "pi5":
            return f"Can't reach the Pi5. {info['message']}. Might have lost network or powered off."
        return f"{name} isn't looking healthy — {info['message']}."

    # ── Calendar Events ───────────────────────────────

    def _check_calendar(self):
        """Check for upcoming calendar events."""
        now = time.time()
        if now - self._last_calendar_check < 60:
            return  # Only check once per minute
        self._last_calendar_check = now

        try:
            # Check if google calendar integration exists
            from integrations.google_cal import get_upcoming_events
            events = get_upcoming_events(minutes_ahead=15)
            for event in events:
                event_id = event.get("id", "")
                if event_id in self._notified_events:
                    continue
                self._notified_events.add(event_id)

                minutes = event.get("minutes_until", 0)
                summary = event.get("summary", "an event")

                self._engine.push_event("event_calendar", {
                    "priority": "high" if minutes <= 5 else "normal",
                    "message": f"You have {summary} in {minutes} minutes.",
                    "direct": True,
                })
        except ImportError:
            pass  # Calendar integration not available
        except Exception as e:
            logger.debug(f"Calendar check failed: {e}")

    # ── Time-Based Triggers ───────────────────────────

    def _check_time_triggers(self):
        """Check for time-based interactions."""
        now = datetime.now(CST)

        # Morning greeting (7:00-7:30 AM, once per day)
        if 7 <= now.hour <= 7 and now.minute <= 30:
            day_key = f"morning_{now.strftime('%Y%m%d')}"
            if day_key not in self._notified_events:
                self._notified_events.add(day_key)
                self._engine.push_event("scheduled", {
                    "priority": "normal",
                    "message": (
                        f"[SYSTEM: It's {now.strftime('%I:%M %p')} CST on {now.strftime('%A')}. "
                        f"Cayden might be starting his day. Give a brief, natural good morning. "
                        f"If you know his schedule, mention it. 1-2 sentences max. "
                        f"No markdown.]"
                    ),
                })

        # Work break reminder (every 2 hours during active sessions)
        if self._engine.is_active:
            active_duration = now.timestamp() - self._engine.context.active_since
            hours = active_duration / 3600
            if hours >= 2:
                break_key = f"break_{now.strftime('%Y%m%d_%H')}"
                if break_key not in self._notified_events:
                    self._notified_events.add(break_key)
                    self._engine.push_event("scheduled", {
                        "priority": "normal",
                        "message": (
                            f"[SYSTEM: Cayden has been working for {int(hours)} hours straight. "
                            f"Suggest a brief break naturally. Don't be preachy. 1 sentence.]"
                        ),
                    })

    # ── Idle Check-in ─────────────────────────────────

    def _check_idle(self):
        """Push idle check-in event if appropriate."""
        self._engine.push_event("idle_checkin", {})

    # ── Main Loop ─────────────────────────────────────

    def _tick(self):
        """One cycle of the event bridge."""
        self._check_health()
        self._check_calendar()
        self._check_time_triggers()
        self._check_idle()

    def _loop_fn(self, interval: float):
        while self._running:
            try:
                self._tick()
            except Exception as e:
                logger.warning(f"Event bridge tick error: {e}")
            time.sleep(interval)

    def start(self, interval: float = 15):
        """Start the event bridge."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop_fn, args=(interval,),
            daemon=True, name="event-bridge",
        )
        self._thread.start()
        self._audit.log("events", "bridge_started", {"interval": interval})

    def stop(self):
        self._running = False

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "alerted_services": list(self._alerted_services),
            "notified_events": len(self._notified_events),
        }
