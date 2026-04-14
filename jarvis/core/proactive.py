"""
Nova — Proactive Messaging Engine
====================================
Allows Nova to initiate conversation on her own:
  • Alert the user when health checks detect problems
  • Follow up on previous conversations
  • Share relevant observations or thoughts
  • Periodic check-ins when idle

Messages are pushed to the desktop via WebSocket broadcast.
"""

import asyncio
import json
import logging
import random
import time
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CST = ZoneInfo("America/Chicago")
logger = logging.getLogger(__name__)

# ── Cooldowns (seconds) to avoid spam ──────────────
_ALERT_COOLDOWN = 120       # 2 min between same-service alerts
_CHECKIN_COOLDOWN = 1800    # 30 min between idle check-ins
_FOLLOWUP_COOLDOWN = 300    # 5 min between follow-ups
_THOUGHT_COOLDOWN = 3600    # 1 hour between random thoughts

# Quiet hours — don't bug Cayden while sleeping (CST)
_QUIET_START = 23  # 11 PM
_QUIET_END = 7     # 7 AM


def _now_cst() -> datetime:
    return datetime.now(CST)


def _is_quiet_hours() -> bool:
    h = _now_cst().hour
    return h >= _QUIET_START or h < _QUIET_END


class ProactiveEngine:
    """Background engine that decides when Nova should speak unprompted."""

    def __init__(self, config, ai_engine, health_monitor, audit, activity_tracker):
        self._config = config
        self._ai = ai_engine
        self._health = health_monitor
        self._audit = audit
        self._activity = activity_tracker

        self._running = False
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

        # Broadcast callback set by websocket module
        self._broadcast_fn = None

        # Track when we last sent each type of message
        self._last_alert: dict[str, float] = {}   # service_name → timestamp
        self._last_checkin = 0.0
        self._last_followup = 0.0
        self._last_thought = 0.0
        self._last_user_message = time.time()

        # Pending messages queue (thread-safe)
        self._queue: list[dict] = []
        self._queue_lock = threading.Lock()

        # Track what we've already alerted about
        self._alerted_services: set[str] = set()
        self._recovered_services: set[str] = set()

    # ── External hooks ─────────────────────────────

    def set_broadcast(self, broadcast_fn):
        """Set the async broadcast function (from websocket module)."""
        self._broadcast_fn = broadcast_fn

    def on_user_message(self):
        """Called when user sends any message — resets idle timer."""
        self._last_user_message = time.time()

    @property
    def idle_minutes(self) -> float:
        return (time.time() - self._last_user_message) / 60

    # ── Message construction ───────────────────────

    def _queue_message(self, content: str, category: str = "proactive",
                       priority: str = "normal", sound: bool = False):
        """Queue a proactive message for broadcast."""
        msg = {
            "type": "proactive",
            "category": category,    # alert, checkin, followup, thought
            "priority": priority,    # low, normal, high, critical
            "content": content,
            "sound": sound,
            "ts": time.time(),
        }
        with self._queue_lock:
            self._queue.append(msg)
        self._audit.log("proactive", f"queued_{category}", {
            "priority": priority, "length": len(content)})

    # ── Alert generation (from health monitor) ─────

    def _check_health_alerts(self):
        """Check health monitor for new failures and generate alerts."""
        if not self._health:
            return

        status = self._health.get_status()
        services = status.get("services", {})
        failures = status.get("consecutive_failures", {})

        for name, info in services.items():
            now = time.time()

            if not info["healthy"]:
                # Service is down — alert if we haven't recently
                last = self._last_alert.get(name, 0)
                if now - last < _ALERT_COOLDOWN:
                    continue

                consecutive = failures.get(name, 1)

                if name not in self._alerted_services:
                    # First failure — immediate alert
                    self._alerted_services.add(name)
                    self._recovered_services.discard(name)

                    if name in ("darklock", "pi5"):
                        priority = "critical"
                        sound = True
                        content = self._format_critical_alert(name, info, consecutive)
                    else:
                        priority = "high" if consecutive >= 3 else "normal"
                        sound = consecutive >= 3
                        content = self._format_alert(name, info, consecutive)

                    self._queue_message(content, "alert", priority, sound)
                    self._last_alert[name] = now

                elif consecutive >= 3 and consecutive % 3 == 0:
                    # Recurring failure — escalate periodically
                    content = self._format_escalation(name, info, consecutive)
                    self._queue_message(content, "alert", "high", True)
                    self._last_alert[name] = now

            elif name in self._alerted_services:
                # Service recovered — notify once
                if name not in self._recovered_services:
                    self._recovered_services.add(name)
                    self._alerted_services.discard(name)
                    content = self._format_recovery(name, info)
                    self._queue_message(content, "alert", "normal", False)
                    self._last_alert[name] = time.time()

    def _format_critical_alert(self, name: str, info: dict, count: int) -> str:
        if name == "darklock":
            return (
                f"Hey Cayden — Darklock just went down. "
                f"I'm seeing: {info['message']}. "
                f"Want me to try restarting it?"
            )
        elif name == "pi5":
            return (
                f"Cayden, I can't reach the Pi5 anymore. "
                f"{info['message']}. "
                f"It might have lost network or powered off. Want me to keep trying?"
            )
        return f"Heads up — {name} is down: {info['message']}"

    def _format_alert(self, name: str, info: dict, count: int) -> str:
        return f"Just noticed {name} isn't looking healthy — {info['message']}."

    def _format_escalation(self, name: str, info: dict, count: int) -> str:
        return (
            f"{name} has been down for {count} checks now. "
            f"Still seeing: {info['message']}. "
            f"This might need manual attention."
        )

    def _format_recovery(self, name: str, info: dict) -> str:
        return f"Good news — {name} is back up and healthy. {info['message']}"

    # ── Idle check-in ──────────────────────────────

    def _maybe_checkin(self):
        """If Cayden's been idle for a while, check in."""
        now = time.time()
        if now - self._last_checkin < _CHECKIN_COOLDOWN:
            return
        if self.idle_minutes < 45:
            return

        # Generate an idle check-in via AI
        self._last_checkin = now
        prompt = self._build_checkin_prompt()
        if prompt:
            self._queue_ai_message(prompt, "checkin")

    def _build_checkin_prompt(self) -> str:
        """Build a context-aware check-in prompt."""
        hour = _now_cst().hour
        idle_mins = int(self.idle_minutes)

        # Gather context
        health_summary = ""
        if self._health:
            unhealthy = self._health.get_unhealthy()
            if unhealthy:
                health_summary = f"These services are currently down: {', '.join(unhealthy)}. "

        return (
            f"[SYSTEM: You are Nova. Cayden hasn't said anything for {idle_mins} minutes. "
            f"It's {_now_cst().strftime('%I:%M %p')} CST. "
            f"{health_summary}"
            f"Send a brief, casual check-in. Be natural — don't be annoying or needy. "
            f"Maybe mention something relevant (time of day, a system update, or just "
            f"see if he needs anything). Keep it to 1-2 sentences max. "
            f"Do NOT use markdown or code blocks.]"
        )

    # ── Thought sharing ────────────────────────────

    def _maybe_share_thought(self):
        """Occasionally share an observation or thought."""
        now = time.time()
        if now - self._last_thought < _THOUGHT_COOLDOWN:
            return
        if self.idle_minutes < 20:
            return

        # Low chance per check cycle (adds some randomness)
        if random.random() > 0.15:
            return

        self._last_thought = now
        prompt = self._build_thought_prompt()
        if prompt:
            self._queue_ai_message(prompt, "thought")

    def _build_thought_prompt(self) -> str:
        """Build a prompt for sharing an observation."""
        # Gather system context for something interesting to mention
        health_status = ""
        if self._health:
            status = self._health.get_status()
            services = status.get("services", {})
            interesting = []
            for name, info in services.items():
                if info["healthy"]:
                    interesting.append(f"{name}: {info['message']}")
            if interesting:
                health_status = "Current system status: " + "; ".join(interesting[:4]) + ". "

        return (
            f"[SYSTEM: You are Nova. Share a brief, natural observation with Cayden. "
            f"Maybe about the system status, time of day, or something casual. "
            f"{health_status}"
            f"It's {_now_cst().strftime('%I:%M %p on %A')} CST. "
            f"Be genuine and brief — 1-2 sentences. Don't be generic. "
            f"Do NOT use markdown or code blocks.]"
        )

    # ── AI message generation ──────────────────────

    def _queue_ai_message(self, prompt: str, category: str):
        """Generate a message via AI and queue it."""
        try:
            loop = asyncio.new_event_loop()
            response = loop.run_until_complete(self._ai.send_message(prompt))
            loop.close()

            if response and not response.startswith("Sorry"):
                # Clean up any stray markdown
                response = response.strip().strip('"').strip("'")
                self._queue_message(response, category, "low")
        except Exception as e:
            logger.warning(f"Proactive AI generation failed: {e}")

    # ── Broadcast loop ─────────────────────────────

    async def _flush_queue(self):
        """Send all pending messages to connected clients."""
        if not self._broadcast_fn:
            return

        with self._queue_lock:
            pending = self._queue[:]
            self._queue.clear()

        for msg in pending:
            try:
                await self._broadcast_fn(msg)
            except Exception as e:
                logger.warning(f"Proactive broadcast failed: {e}")

    # ── Main loop ──────────────────────────────────

    def _tick(self):
        """One cycle of the proactive engine."""
        if _is_quiet_hours():
            return

        # 1. Health alerts (always check)
        self._check_health_alerts()

        # 2. Idle check-in
        self._maybe_checkin()

        # 3. Random thoughts
        self._maybe_share_thought()

    def _loop_fn(self, interval: float):
        """Background thread loop."""
        self._audit.log("proactive", "started", {"interval": interval})
        self._loop = asyncio.new_event_loop()

        while self._running:
            try:
                self._tick()
                # Flush queued messages via async broadcast
                self._loop.run_until_complete(self._flush_queue())
            except Exception as e:
                logger.warning(f"Proactive loop error: {e}")
            time.sleep(interval)

        self._loop.close()

    def start(self, interval: float = 30):
        """Start the proactive engine. Checks every `interval` seconds."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop_fn, args=(interval,),
            daemon=True, name="proactive-engine")
        self._thread.start()
        self._activity.system_event("🧠 Proactive engine started")
        logger.info("Proactive engine started (interval=%ss)", interval)

    def stop(self):
        self._running = False

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "idle_minutes": round(self.idle_minutes, 1),
            "alerted_services": list(self._alerted_services),
            "last_checkin": self._last_checkin,
            "last_thought": self._last_thought,
            "queue_size": len(self._queue),
            "quiet_hours": _is_quiet_hours(),
        }
