"""
Nova — Conversation Engine
============================
The central nervous system for continuous conversation.

Manages:
  • Conversation state (active / idle / inactive / sleeping)
  • Decision layer ("should I speak?")
  • Multi-turn response orchestration
  • Event-driven speech triggers
  • Interruption handling

This replaces the simple request→response model with a real
conversation lifecycle that lets Nova feel present and aware.

States:
  INACTIVE  → No active conversation. Nova only speaks for events.
  ACTIVE    → User is engaged. Nova can follow up, ask questions, continue.
  IDLE      → Conversation paused (2+ min no input). Nova can check in once.
  SLEEPING  → Quiet hours. Nova only speaks for critical alerts.
"""

import asyncio
import json
import logging
import time
import threading
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from zoneinfo import ZoneInfo

from logs.audit import AuditLogger

CST = ZoneInfo("America/Chicago")
logger = logging.getLogger(__name__)


# ── Conversation States ──────────────────────────────────

class ConversationState(str, Enum):
    INACTIVE = "inactive"    # No conversation happening
    ACTIVE = "active"        # User is engaged right now
    IDLE = "idle"            # Conversation paused, user stepped away
    SLEEPING = "sleeping"    # Quiet hours — critical alerts only


# ── Speech Decision ──────────────────────────────────────

class SpeechReason(str, Enum):
    """Why Nova decided to speak (or not)."""
    USER_MESSAGE = "user_message"           # Direct response to user
    FOLLOW_UP = "follow_up"                 # Continuing a topic
    EVENT_ALERT = "event_alert"             # Calendar, server, etc.
    EVENT_CRITICAL = "event_critical"       # Something urgent
    SCHEDULED = "scheduled"                 # Timed interaction (morning update)
    IDLE_CHECKIN = "idle_checkin"            # User's been quiet a while
    SUPPRESSED = "suppressed"               # Decision: don't speak
    QUIET_HOURS = "quiet_hours"             # In quiet hours


@dataclass
class SpeechDecision:
    """Result of the decision layer evaluation."""
    should_speak: bool
    reason: SpeechReason
    urgency: float = 0.0       # 0.0 = not urgent, 1.0 = critical
    relevance: float = 0.0     # 0.0 = irrelevant, 1.0 = highly relevant
    context: str = ""          # What triggered this decision


@dataclass
class ConversationContext:
    """Tracks the current conversation state and context."""
    state: ConversationState = ConversationState.INACTIVE
    current_topic: str = ""
    last_user_message: str = ""
    last_nova_response: str = ""
    last_user_time: float = 0.0
    last_nova_time: float = 0.0
    message_count: int = 0
    conversation_id: int | None = None
    pending_follow_ups: list[str] = field(default_factory=list)
    active_since: float = 0.0


# ── Timing Constants ─────────────────────────────────────

ACTIVE_TIMEOUT = 120         # 2 min → ACTIVE goes to IDLE
IDLE_TIMEOUT = 900           # 15 min → IDLE goes to INACTIVE
FOLLOW_UP_WINDOW = 60        # 1 min after response — can follow up
FOLLOW_UP_COOLDOWN = 30      # 30 sec min between follow-ups
QUIET_START = 23             # 11 PM CST
QUIET_END = 7                # 7 AM CST
MIN_MULTI_TURN_GAP = 1.5     # Seconds between multi-turn message parts


class ConversationEngine:
    """
    The brain that decides when and how Nova speaks.
    
    This sits between the event sources (user input, health alerts,
    calendar, timers) and the actual speech output (WebSocket/TTS).
    Nothing reaches the user without going through here.
    """

    def __init__(self, audit: AuditLogger, config=None):
        self._audit = audit
        self._config = config
        self._ctx = ConversationContext()
        self._lock = threading.Lock()

        # Broadcast function (set by websocket module)
        self._broadcast_fn = None
        self._ai_engine = None
        self._emotions = None
        self._session_continuity = None
        self._health_monitor = None
        self._scheduler = None
        self._persistent_memory = None

        # Event queue — things wanting Nova's attention
        self._event_queue: list[dict] = []
        self._event_lock = threading.Lock()

        # Follow-up tracking
        self._last_follow_up_time = 0.0
        self._follow_up_count = 0

        # Background loop
        self._running = False
        self._thread: threading.Thread | None = None

        # Interruption flag — set when user starts talking
        self._interrupted = False

        # Multi-turn queue — messages waiting to be delivered
        self._multi_turn_queue: list[str] = []
        self._speaking = False

    # ── Dependency Injection ──────────────────────────

    def set_broadcast(self, fn):
        self._broadcast_fn = fn

    def set_ai_engine(self, ai):
        self._ai_engine = ai

    def set_emotions(self, emo):
        self._emotions = emo

    def set_session_continuity(self, sc):
        self._session_continuity = sc

    def set_health_monitor(self, hm):
        self._health_monitor = hm

    def set_scheduler(self, sched):
        self._scheduler = sched

    def set_persistent_memory(self, pm):
        self._persistent_memory = pm

    # ── State Properties ──────────────────────────────

    @property
    def state(self) -> ConversationState:
        return self._ctx.state

    @property
    def is_active(self) -> bool:
        return self._ctx.state == ConversationState.ACTIVE

    @property
    def is_speaking(self) -> bool:
        return self._speaking

    @property
    def context(self) -> ConversationContext:
        return self._ctx

    # ── State Transitions ─────────────────────────────

    def _transition(self, new_state: ConversationState, reason: str = ""):
        old = self._ctx.state
        if old == new_state:
            return
        self._ctx.state = new_state
        self._audit.log("conversation", "state_change", {
            "from": old.value, "to": new_state.value, "reason": reason,
        })
        logger.info(f"Conversation: {old.value} → {new_state.value} ({reason})")

    def _check_quiet_hours(self) -> bool:
        h = datetime.now(CST).hour
        return h >= QUIET_START or h < QUIET_END

    def _update_state(self):
        """Evaluate and update conversation state based on timing."""
        now = time.time()
        since_user = now - self._ctx.last_user_time if self._ctx.last_user_time else float('inf')

        if self._check_quiet_hours():
            if self._ctx.state != ConversationState.SLEEPING:
                self._transition(ConversationState.SLEEPING, "quiet hours")
            return

        # Wake from sleeping when quiet hours end
        if self._ctx.state == ConversationState.SLEEPING and not self._check_quiet_hours():
            self._transition(ConversationState.INACTIVE, "quiet hours ended")
            return

        if self._ctx.state == ConversationState.ACTIVE:
            if since_user > ACTIVE_TIMEOUT:
                self._transition(ConversationState.IDLE, f"no input for {int(since_user)}s")
        elif self._ctx.state == ConversationState.IDLE:
            if since_user > IDLE_TIMEOUT:
                self._transition(ConversationState.INACTIVE, f"idle for {int(since_user)}s")
                # Summarize the ended conversation
                if self._session_continuity and self._ctx.conversation_id:
                    mood = self._emotions.state.dominant_feeling if self._emotions else "neutral"
                    self._session_continuity.on_session_end(
                        conversation_id=self._ctx.conversation_id,
                        current_mood=mood,
                    )

    # ── User Input ────────────────────────────────────

    def on_user_message(self, message: str, conversation_id: int | None = None):
        """Called whenever the user sends a message."""
        with self._lock:
            now = time.time()
            self._ctx.last_user_message = message
            self._ctx.last_user_time = now
            self._ctx.message_count += 1

            if conversation_id:
                self._ctx.conversation_id = conversation_id

            # User submitted a message — clear any pending interrupt so the
            # new response streams fully (keystroke interrupt only matters
            # while Nova is currently mid-stream, not after submit)
            self._interrupted = False

            # If we were speaking, stop the multi-turn queue
            if self._speaking:
                self._interrupted = True
                self._multi_turn_queue.clear()
                self._speaking = False

            # Transition to ACTIVE
            if self._ctx.state != ConversationState.ACTIVE:
                self._ctx.active_since = now
                self._ctx.message_count = 0  # Reset counter for new session
                self._transition(ConversationState.ACTIVE, "user message")

                # Start session tracking
                if self._session_continuity:
                    self._session_continuity.on_session_start(
                        conversation_id=conversation_id,
                        current_mood=self._emotions.state.dominant_feeling if self._emotions else "neutral",
                    )

            # Track in session continuity
            if self._session_continuity:
                self._session_continuity.on_message(message, is_user=True)

            # Extract topic from message
            self._ctx.current_topic = self._extract_topic(message)

            # Reset follow-up counter when user speaks
            self._follow_up_count = 0

    def on_nova_response(self, response: str):
        """Called after Nova sends a response."""
        with self._lock:
            self._ctx.last_nova_response = response
            self._ctx.last_nova_time = time.time()

    def queue_followup(self, content: str, category: str = "followup", delay: float = 0.5):
        """
        Queue a programmatic follow-up message to be broadcast immediately.
        Used when a background lookup completes and needs to push a result.
        Bypasses the evaluation/cooldown system — caller is responsible for
        deciding this should be sent.
        """
        if not self._broadcast_fn:
            return

        def _send():
            try:
                time.sleep(delay)
                # Re-check here — the call-time check rules out the common "never set"
                # case, but an explicit guard inside the thread catches race conditions
                # and gives a clear error instead of a cryptic TypeError.
                fn = self._broadcast_fn
                if not fn:
                    logger.error("queue_followup: broadcast_fn not set when thread fired — follow-up dropped")
                    return
                msg = {
                    "type": "proactive",
                    "category": category,
                    "content": content,
                    "priority": "normal",
                    "reason": "lookup_result",
                    "sound": False,
                    "ts": time.time(),
                }
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(fn(msg))
                finally:
                    loop.close()

                if self._session_continuity:
                    self._session_continuity.on_message(content, is_user=False)
            except Exception as e:
                logger.error(f"queue_followup _send failed: {e}", exc_info=True)

        t = threading.Thread(target=_send, daemon=True, name="conv-followup")
        t.start()
        self._audit.log("conversation", "queued_followup", {
            "length": len(content), "category": category, "delay": delay,
        })

    # ── Interruption ──────────────────────────────────

    def interrupt(self):
        """Called when user starts speaking — immediately stop Nova."""
        self._interrupted = True
        self._multi_turn_queue.clear()
        self._speaking = False
        self._audit.log("conversation", "interrupted", {
            "was_speaking": self._speaking,
            "queue_cleared": True,
        })

    def was_interrupted(self) -> bool:
        """Check and clear interruption flag."""
        if self._interrupted:
            self._interrupted = False
            return True
        return False

    # ── Decision Layer ────────────────────────────────
    # This is the core logic that decides: should Nova speak?

    def evaluate_speech(self, trigger: str, data: dict | None = None) -> SpeechDecision:
        """
        The decision layer. Evaluates whether Nova should speak.
        
        Triggers:
          "event_health"  → Health monitor detected a problem
          "event_calendar" → Calendar event approaching
          "event_system"  → System event (server down, etc.)
          "follow_up"     → Nova wants to continue a thought
          "scheduled"     → Timed trigger (morning update, etc.)
          "idle_checkin"  → Cayden's been quiet
        
        Returns SpeechDecision with should_speak=True/False and reasoning.
        """
        data = data or {}
        now = time.time()

        # Quiet hours — only critical events break through
        if self._check_quiet_hours():
            if trigger == "event_critical" or data.get("priority") == "critical":
                return SpeechDecision(
                    should_speak=True,
                    reason=SpeechReason.EVENT_CRITICAL,
                    urgency=1.0,
                    relevance=1.0,
                    context=data.get("message", "critical event"),
                )
            return SpeechDecision(
                should_speak=False,
                reason=SpeechReason.QUIET_HOURS,
                context="quiet hours — suppressed",
            )

        # ── Event-based triggers ──────────────────────

        if trigger.startswith("event_"):
            return self._evaluate_event(trigger, data)

        # ── Follow-up ────────────────────────────────

        if trigger == "follow_up":
            return self._evaluate_follow_up(data)

        # ── Scheduled interaction ────────────────────

        if trigger == "scheduled":
            return SpeechDecision(
                should_speak=True,
                reason=SpeechReason.SCHEDULED,
                urgency=0.3,
                relevance=0.8,
                context=data.get("message", "scheduled interaction"),
            )

        # ── Idle check-in ────────────────────────────

        if trigger == "idle_checkin":
            return self._evaluate_idle_checkin()

        # Default: suppress
        return SpeechDecision(should_speak=False, reason=SpeechReason.SUPPRESSED)

    def _evaluate_event(self, trigger: str, data: dict) -> SpeechDecision:
        """Evaluate whether an event warrants speaking."""
        priority = data.get("priority", "normal")
        message = data.get("message", "")

        if priority == "critical":
            return SpeechDecision(
                should_speak=True,
                reason=SpeechReason.EVENT_CRITICAL,
                urgency=1.0,
                relevance=1.0,
                context=message,
            )

        if priority == "high":
            return SpeechDecision(
                should_speak=True,
                reason=SpeechReason.EVENT_ALERT,
                urgency=0.7,
                relevance=0.8,
                context=message,
            )

        # Normal priority — only speak if conversation is active or idle
        if self._ctx.state in (ConversationState.ACTIVE, ConversationState.IDLE):
            return SpeechDecision(
                should_speak=True,
                reason=SpeechReason.EVENT_ALERT,
                urgency=0.4,
                relevance=0.6,
                context=message,
            )

        # Inactive — suppress normal events (they can wait)
        return SpeechDecision(
            should_speak=False,
            reason=SpeechReason.SUPPRESSED,
            context=f"suppressed normal event while inactive: {message[:50]}",
        )

    def _evaluate_follow_up(self, data: dict) -> SpeechDecision:
        """Evaluate whether Nova should follow up a response."""
        now = time.time()

        # Only follow up if conversation is ACTIVE
        if self._ctx.state != ConversationState.ACTIVE:
            return SpeechDecision(
                should_speak=False, reason=SpeechReason.SUPPRESSED,
                context="not in active conversation",
            )

        # Don't follow up too many times in a row
        if self._follow_up_count >= 2:
            return SpeechDecision(
                should_speak=False, reason=SpeechReason.SUPPRESSED,
                context="follow-up limit reached",
            )

        # Don't follow up too soon after last one
        if now - self._last_follow_up_time < FOLLOW_UP_COOLDOWN:
            return SpeechDecision(
                should_speak=False, reason=SpeechReason.SUPPRESSED,
                context="follow-up cooldown",
            )

        # Must be within the follow-up window after Nova's last response
        since_response = now - self._ctx.last_nova_time
        if since_response > FOLLOW_UP_WINDOW:
            return SpeechDecision(
                should_speak=False, reason=SpeechReason.SUPPRESSED,
                context="outside follow-up window",
            )

        self._follow_up_count += 1
        self._last_follow_up_time = now

        return SpeechDecision(
            should_speak=True,
            reason=SpeechReason.FOLLOW_UP,
            urgency=0.2,
            relevance=0.7,
            context=data.get("message", "continuing conversation"),
        )

    def _evaluate_idle_checkin(self) -> SpeechDecision:
        """Evaluate whether to check in on idle user."""
        # Only check in if IDLE (not INACTIVE — that means conversation ended)
        if self._ctx.state != ConversationState.IDLE:
            return SpeechDecision(
                should_speak=False, reason=SpeechReason.SUPPRESSED,
                context="not idle",
            )

        since_user = time.time() - self._ctx.last_user_time
        # Only check in once between 5-15 minutes of idle
        if since_user < 300 or since_user > 900:
            return SpeechDecision(
                should_speak=False, reason=SpeechReason.SUPPRESSED,
                context=f"idle for {int(since_user)}s — outside check-in window",
            )

        return SpeechDecision(
            should_speak=True,
            reason=SpeechReason.IDLE_CHECKIN,
            urgency=0.1,
            relevance=0.3,
            context="user idle check-in",
        )

    # ── Multi-Turn Response System ────────────────────

    async def deliver_multi_turn(self, parts: list[str]):
        """
        Deliver a response as multiple short messages with natural pacing.
        Stops immediately if interrupted.
        """
        self._speaking = True
        self._multi_turn_queue = parts[:]

        for i, part in enumerate(parts):
            if self._interrupted or not self._speaking:
                break

            # Deliver this part
            if self._broadcast_fn:
                await self._broadcast_fn({
                    "type": "proactive",
                    "category": "multi_turn",
                    "content": part,
                    "priority": "normal",
                    "part": i + 1,
                    "total": len(parts),
                    "ts": time.time(),
                })

            # Pace between parts (skip for last one)
            if i < len(parts) - 1:
                # Pace based on length — ~50ms per word
                word_count = len(part.split())
                delay = max(MIN_MULTI_TURN_GAP, word_count * 0.05)
                delay = min(delay, 4.0)  # Cap at 4 seconds
                await asyncio.sleep(delay)

        self._speaking = False
        self._multi_turn_queue.clear()

    def split_for_multi_turn(self, response: str) -> list[str]:
        """
        Split a response into natural multi-turn parts.
        Only splits if the response is long enough to warrant it.
        """
        # Short responses don't need splitting
        if len(response) < 120:
            return [response]

        # Split on sentence boundaries
        sentences = []
        current = ""
        for char in response:
            current += char
            if char in '.!?' and len(current.strip()) > 10:
                sentences.append(current.strip())
                current = ""
        if current.strip():
            sentences.append(current.strip())

        if len(sentences) <= 1:
            return [response]

        # Group sentences into natural chunks (2-3 sentences per chunk)
        chunks = []
        chunk = ""
        for s in sentences:
            if len(chunk) + len(s) > 180 and chunk:
                chunks.append(chunk.strip())
                chunk = s
            else:
                chunk = (chunk + " " + s).strip() if chunk else s

        if chunk:
            chunks.append(chunk.strip())

        return chunks if len(chunks) > 1 else [response]

    # ── Event Intake ──────────────────────────────────

    def push_event(self, event_type: str, data: dict):
        """
        Push an event for evaluation. The background loop will
        pick it up and run it through the decision layer.
        """
        with self._event_lock:
            self._event_queue.append({
                "type": event_type,
                "data": data,
                "ts": time.time(),
            })

    # ── Topic Extraction ──────────────────────────────

    def _extract_topic(self, message: str) -> str:
        """Extract the general topic from a user message."""
        msg = message.lower()
        topics = {
            "darklock": ["darklock", "server", "deploy", "pi5"],
            "coding": ["code", "debug", "function", "api", "bug", "feature"],
            "smart_home": ["light", "govee", "lamp", "brightness"],
            "calendar": ["calendar", "schedule", "event", "meeting"],
            "nova": ["nova", "ai", "personality", "memory", "voice"],
            "security": ["security", "auth", "ssl", "encrypt"],
            "hardware": ["hardware", "pico", "arduino", "gpio"],
        }
        for topic, keywords in topics.items():
            if any(k in msg for k in keywords):
                return topic
        return "general"

    # ── Background Loop ───────────────────────────────

    def _tick(self):
        """One cycle of the conversation engine."""
        self._update_state()

        # Process event queue
        with self._event_lock:
            events = self._event_queue[:]
            self._event_queue.clear()

        for event in events:
            decision = self.evaluate_speech(event["type"], event["data"])
            if decision.should_speak:
                self._handle_speech_decision(decision, event["data"])
            else:
                self._audit.log("conversation", "suppressed", {
                    "trigger": event["type"],
                    "reason": decision.reason.value,
                    "context": decision.context,
                })

    def _handle_speech_decision(self, decision: SpeechDecision, data: dict):
        """Act on a positive speech decision — generate and send a message."""
        if not self._ai_engine or not self._broadcast_fn:
            return

        category = "alert" if decision.reason in (
            SpeechReason.EVENT_ALERT, SpeechReason.EVENT_CRITICAL
        ) else "followup" if decision.reason == SpeechReason.FOLLOW_UP else "checkin"

        content = data.get("message", "")
        if not content:
            return

        # For events with pre-built content, send directly
        if data.get("direct", False):
            self._send_sync(content, category, decision)
            return

        # Otherwise, generate via AI
        prompt = self._build_contextual_prompt(decision, data)
        if prompt:
            self._generate_and_send(prompt, category, decision)

    def _build_contextual_prompt(self, decision: SpeechDecision, data: dict) -> str:
        """Build a context-aware prompt for AI-generated speech."""
        now_str = datetime.now(CST).strftime('%I:%M %p')
        state = self._ctx.state.value
        topic = self._ctx.current_topic or "nothing specific"
        message = data.get("message", "")

        if decision.reason == SpeechReason.EVENT_ALERT:
            return (
                f"[SYSTEM: An event needs Cayden's attention. "
                f"Current conversation state: {state}. Topic: {topic}. "
                f"Time: {now_str} CST. Event: {message}. "
                f"Alert Cayden naturally. 1-2 sentences. Direct, not alarming unless critical. "
                f"No markdown, no code blocks.]"
            )
        elif decision.reason == SpeechReason.FOLLOW_UP:
            return (
                f"[SYSTEM: You just responded to Cayden about '{topic}'. "
                f"Your last response: '{self._ctx.last_nova_response[:100]}'. "
                f"You have a relevant follow-up thought. Share it briefly. "
                f"1 sentence max. Natural continuation, not a new topic.]"
            )
        elif decision.reason == SpeechReason.IDLE_CHECKIN:
            idle_mins = int((time.time() - self._ctx.last_user_time) / 60)
            return (
                f"[SYSTEM: Cayden hasn't said anything for {idle_mins} minutes. "
                f"Time: {now_str} CST. Last topic: {topic}. "
                f"Brief, casual check-in. Don't be needy. 1 sentence.]"
            )
        elif decision.reason == SpeechReason.SCHEDULED:
            return message  # Scheduled messages provide their own prompt
        return ""

    def _generate_and_send(self, prompt: str, category: str, decision: SpeechDecision):
        """Generate AI response and send via broadcast."""
        try:
            loop = asyncio.new_event_loop()
            response = loop.run_until_complete(self._ai_engine.send_message(prompt))
            loop.close()

            if response and not response.startswith("Sorry"):
                response = response.strip().strip('"').strip("'")
                self._send_sync(response, category, decision)
        except Exception as e:
            logger.warning(f"Conversation engine speech generation failed: {e}")

    def _send_sync(self, content: str, category: str, decision: SpeechDecision):
        """Send a message synchronously via broadcast."""
        msg = {
            "type": "proactive",
            "category": category,
            "content": content,
            "priority": "critical" if decision.urgency > 0.8 else "high" if decision.urgency > 0.5 else "normal",
            "reason": decision.reason.value,
            "sound": decision.urgency > 0.5,
            "ts": time.time(),
        }
        try:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(self._broadcast_fn(msg))
            loop.close()
        except Exception as e:
            logger.warning(f"Conversation engine broadcast failed: {e}")

        self._audit.log("conversation", "spoke", {
            "category": category,
            "reason": decision.reason.value,
            "urgency": decision.urgency,
            "length": len(content),
        })

    def _loop_fn(self, interval: float):
        """Background thread loop."""
        while self._running:
            try:
                self._tick()
            except Exception as e:
                logger.warning(f"Conversation engine tick error: {e}")
            time.sleep(interval)

    def start(self, interval: float = 5):
        """Start the conversation engine background loop."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop_fn, args=(interval,),
            daemon=True, name="conversation-engine",
        )
        self._thread.start()
        self._audit.log("conversation", "engine_started", {"interval": interval})
        logger.info(f"Conversation engine started (interval={interval}s)")

    def stop(self):
        self._running = False

    def get_status(self) -> dict:
        """Status for health/debug endpoints."""
        return {
            "state": self._ctx.state.value,
            "topic": self._ctx.current_topic,
            "message_count": self._ctx.message_count,
            "speaking": self._speaking,
            "event_queue_size": len(self._event_queue),
            "follow_up_count": self._follow_up_count,
            "last_user_time": self._ctx.last_user_time,
            "last_nova_time": self._ctx.last_nova_time,
        }
