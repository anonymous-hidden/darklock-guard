"""
Nova — Session Continuity Engine
=================================
Makes Nova remember across conversations naturally.

Key responsibilities:
1. Auto-summarize conversations when they end (or get long)
2. Extract key facts, decisions, and promises from conversations
3. Build a "last time we talked" context for session starts
4. Track interaction patterns (when Cayden is active, what he works on)

This is what makes Nova feel like the SAME entity every time.
"""

import json
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from memory.store import MemoryStore
from memory.persistent_memory import PersistentMemory
from logs.audit import AuditLogger

CST = ZoneInfo("America/Chicago")


class SessionContinuity:
    """Maintains Nova's sense of continuity across conversations."""

    def __init__(self, store: MemoryStore, persistent_memory: PersistentMemory,
                 audit: AuditLogger):
        self._store = store
        self._memory = persistent_memory
        self._audit = audit
        self._current_session_id: int | None = None
        self._session_start: datetime | None = None  # Set on first message, NOT at boot
        self._message_count: int = 0
        self._topics_discussed: list[str] = []
        self._ensure_tables()

    def _ensure_tables(self):
        """Create session tracking tables."""
        conn = self._store._conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS session_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                started_at      TEXT NOT NULL,
                ended_at        TEXT,
                message_count   INTEGER DEFAULT 0,
                summary         TEXT,
                topics          TEXT,
                mood_start      TEXT,
                mood_end        TEXT,
                key_facts       TEXT
            );
            CREATE TABLE IF NOT EXISTS interaction_patterns (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                day_of_week TEXT NOT NULL,
                hour       INTEGER NOT NULL,
                activity   TEXT,
                created_at TEXT NOT NULL
            );
        """)
        conn.commit()

    # ── Session Lifecycle ──────────────────────────────

    def on_session_start(self, conversation_id: int | None = None,
                         current_mood: str = "neutral"):
        """Called when a new conversation begins — resets all counters."""
        now = datetime.now(CST)
        self._session_start = now
        self._current_session_id = conversation_id
        self._message_count = 0
        self._topics_discussed = []

        # Log the session start
        conn = self._store._conn()
        conn.execute(
            "INSERT INTO session_log (conversation_id, started_at, mood_start) "
            "VALUES (?, ?, ?)",
            (conversation_id, self._session_start.isoformat(), current_mood),
        )
        conn.commit()

        # Track interaction pattern
        now = self._session_start
        conn.execute(
            "INSERT INTO interaction_patterns (day_of_week, hour, activity, created_at) "
            "VALUES (?, ?, ?, ?)",
            (now.strftime("%A"), now.hour, "session_start", now.isoformat()),
        )
        conn.commit()

        self._audit.log("session", "started", {
            "conversation_id": conversation_id,
            "time": self._session_start.isoformat(),
        })

    def on_message(self, user_message: str, is_user: bool = True):
        """Track each message for session context."""
        self._message_count += 1

        if is_user:
            # Extract topics from the message
            topics = self._extract_topics(user_message)
            for t in topics:
                if t not in self._topics_discussed:
                    self._topics_discussed.append(t)

    def on_session_end(self, conversation_id: int | None = None,
                       current_mood: str = "neutral"):
        """
        Called when a conversation ends (or Nova detects a long pause).
        Generates and stores a summary.
        """
        conv_id = conversation_id or self._current_session_id
        if not conv_id:
            return

        now = datetime.now(CST)
        messages = self._store.get_messages(conv_id)

        if len(messages) < 2:
            return  # Nothing to summarize

        # Build summary from actual conversation content
        summary = self._build_summary(messages)
        key_facts = self._extract_key_facts(messages)
        topics_json = json.dumps(self._topics_discussed[:10])
        facts_json = json.dumps(key_facts)

        # Store in session_log
        conn = self._store._conn()
        conn.execute(
            "UPDATE session_log SET ended_at=?, message_count=?, summary=?, "
            "topics=?, mood_end=?, key_facts=? "
            "WHERE conversation_id=? AND ended_at IS NULL",
            (now.isoformat(), self._message_count, summary, topics_json,
             current_mood, facts_json, conv_id),
        )
        conn.commit()

        # Also store in persistent memory's conversation_summaries table
        self._memory.save_conversation_summary(
            conversation_id=conv_id,
            summary=summary,
            topics=self._topics_discussed[:10],
            mood=current_mood,
        )

        # Store any extracted key facts as long-term memories
        for fact in key_facts:
            self._memory.remember(
                category=fact.get("category", "conversation"),
                key=fact.get("key", "note"),
                value=fact.get("value", ""),
                importance=fact.get("importance", 5),
            )

        self._audit.log("session", "ended", {
            "conversation_id": conv_id,
            "messages": self._message_count,
            "topics": self._topics_discussed[:10],
            "facts_extracted": len(key_facts),
        })

    # ── Context Building ───────────────────────────────

    def build_continuity_context(self) -> str:
        """
        Build the "where we left off" context for the system prompt.
        Past sessions get relative timestamps. Current session is separate.
        """
        parts = []
        now = datetime.now(CST)

        # Past conversation summaries — clearly labeled as historical
        recent_sessions = self._get_recent_sessions(5)
        if recent_sessions:
            lines = []
            for s in recent_sessions:
                # Skip the current session if it shows up
                if (self._current_session_id is not None
                        and s.get("conversation_id") == self._current_session_id):
                    continue
                started = s.get("started_at", "")
                relative = self._relative_time(started, now)
                summary = s.get("summary", "")[:150]
                topics = json.loads(s.get("topics", "[]")) if s.get("topics") else []
                topic_str = ", ".join(topics[:5]) if topics else "general chat"
                msgs = s.get("message_count", 0)
                lines.append(f"  - [{relative}] {summary} ({msgs} messages, topics: {topic_str})")

            if lines:
                parts.append("## Previous Conversations (historical)\n" + "\n".join(lines))

        # Interaction patterns
        pattern = self._get_activity_pattern()
        if pattern:
            parts.append(f"## Interaction Pattern\n{pattern}")

        # Current session — only if it has actually started
        if self._session_start is not None and self._message_count > 0:
            duration = now - self._session_start
            minutes = int(duration.total_seconds() // 60)
            topics_str = ", ".join(self._topics_discussed[:5]) if self._topics_discussed else "general"
            parts.append(
                f"## This Session (right now)\n"
                f"  Started: {minutes} minutes ago\n"
                f"  Messages this session: {self._message_count}\n"
                f"  Topics: {topics_str}"
            )

        return "\n\n".join(parts) if parts else ""

    @staticmethod
    def _relative_time(iso_str: str, now: datetime) -> str:
        """Convert an ISO timestamp to a human-readable relative label."""
        try:
            ts = datetime.fromisoformat(iso_str)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=CST)
            delta = now - ts
            days = delta.days
            hours = int(delta.total_seconds() // 3600)
            minutes = int(delta.total_seconds() // 60)
            if minutes < 2:
                return "just now"
            if minutes < 60:
                return f"{minutes} min ago"
            if hours < 24:
                return f"{hours}h ago"
            if days == 1:
                return "yesterday"
            if days < 7:
                return f"{days} days ago"
            return f"{days} days ago ({ts.strftime('%b %-d')})"
        except Exception:
            return iso_str[:16]

    # ── Private Helpers ────────────────────────────────

    def _build_summary(self, messages: list[dict]) -> str:
        """Build a meaningful summary from conversation messages."""
        user_msgs = [m["content"] for m in messages if m["role"] == "user"]
        nova_msgs = [m["content"] for m in messages if m["role"] == "assistant"]

        if not user_msgs:
            return "Brief interaction"

        # Opening context
        opening = user_msgs[0][:120].replace("\n", " ")
        parts = [f"Started with: {opening}"]

        # Key requests/statements from the middle of the conversation
        key_phrases = []
        for msg in user_msgs[1:]:
            msg_lower = msg.lower()
            if any(kw in msg_lower for kw in [
                "i want", "i need", "can you", "help me", "please",
                "i'm working", "i've been", "let's", "i decided",
                "remember", "i prefer", "i like", "i don't", "i hate",
                "what is", "how do", "why does", "explain",
            ]):
                phrase = msg[:120].replace("\n", " ")
                key_phrases.append(phrase)
                if len(key_phrases) >= 4:
                    break

        if key_phrases:
            parts.append("Key requests: " + " | ".join(key_phrases))

        # Topics
        all_text = " ".join(user_msgs)
        topics = self._extract_topics(all_text)[:6]
        if topics:
            parts.append("Topics covered: " + ", ".join(topics))

        # What Nova committed to or confirmed (scan assistant messages)
        commitments = []
        for msg in nova_msgs:
            msg_lower = msg.lower()
            if any(kw in msg_lower for kw in [
                "i'll", "i will", "i've set", "i've saved", "done,",
                "i've added", "i've created", "scheduled", "noted",
            ]):
                commitments.append(msg[:100].replace("\n", " "))
                if len(commitments) >= 2:
                    break
        if commitments:
            parts.append("Nova committed to: " + " | ".join(commitments))

        parts.append(f"({len(messages)} total messages, {len(user_msgs)} from Cayden)")
        return ". ".join(parts)

    def _extract_key_facts(self, messages: list[dict]) -> list[dict]:
        """Extract key facts from conversation that should be remembered."""
        facts = []
        for msg in messages:
            if msg["role"] != "user":
                continue
            content = msg["content"]

            # Decisions / commitments
            for pattern, category in [
                (r"(?:i(?:'m| am) going to|i(?:'ll| will)|let(?:'s| us))\s+(.+?)(?:\.|$|!)",
                 "decision"),
                (r"(?:remind me|don't forget|remember)\s+(?:to\s+|that\s+)?(.+?)(?:\.|$|!)",
                 "reminder"),
                (r"(?:the plan is|we should|next step)\s+(.+?)(?:\.|$|!)",
                 "plan"),
            ]:
                m = re.search(pattern, content, re.IGNORECASE)
                if m:
                    facts.append({
                        "category": category,
                        "key": f"{category}_{datetime.now(CST).strftime('%m%d_%H%M')}",
                        "value": m.group(1).strip()[:200],
                        "importance": 6,
                    })

        return facts[:5]  # Cap at 5 facts per conversation

    def _extract_topics(self, message: str) -> list[str]:
        """Extract topic keywords from a message."""
        topics = []
        msg = message.lower()

        topic_patterns = {
            "coding": r"\b(?:code|coding|program|debug|function|class|api|bug|feature)\b",
            "darklock": r"\b(?:darklock|server|deploy|pi5|raspberry)\b",
            "smart home": r"\b(?:light|govee|lamp|led|scene|brightness)\b",
            "hardware": r"\b(?:hardware|pico|arduino|gpio|sensor|display)\b",
            "discord": r"\b(?:discord|bot|channel|role|server)\b",
            "security": r"\b(?:security|auth|token|ssl|encrypt|password)\b",
            "nova": r"\b(?:nova|ai|personality|memory|voice|prompt)\b",
            "personal": r"\b(?:feel|day|morning|tired|excited|think|want)\b",
        }

        for topic, pattern in topic_patterns.items():
            if re.search(pattern, msg):
                topics.append(topic)

        return topics

    def _get_recent_sessions(self, count: int = 3) -> list[dict]:
        """Get recent completed sessions."""
        rows = self._store._conn().execute(
            "SELECT * FROM session_log WHERE summary IS NOT NULL "
            "ORDER BY started_at DESC LIMIT ?",
            (count,),
        ).fetchall()
        return [dict(r) for r in rows]

    def _get_activity_pattern(self) -> str:
        """Analyze when Cayden typically interacts with Nova."""
        rows = self._store._conn().execute(
            "SELECT day_of_week, hour, COUNT(*) as cnt "
            "FROM interaction_patterns "
            "WHERE created_at > datetime('now', '-14 days') "
            "GROUP BY day_of_week, hour "
            "ORDER BY cnt DESC LIMIT 5"
        ).fetchall()

        if not rows:
            return ""

        patterns = []
        for r in rows:
            time_label = "morning" if r["hour"] < 12 else "afternoon" if r["hour"] < 17 else "evening" if r["hour"] < 21 else "late night"
            patterns.append(f"{r['day_of_week']} {time_label}s")

        # Deduplicate
        unique = list(dict.fromkeys(patterns))
        return f"Cayden is most active: {', '.join(unique[:3])}"

    def get_session_stats(self) -> dict:
        """Get statistics about sessions for health/status endpoints."""
        conn = self._store._conn()
        total = conn.execute("SELECT COUNT(*) as c FROM session_log").fetchone()["c"]
        recent = conn.execute(
            "SELECT COUNT(*) as c FROM session_log "
            "WHERE started_at > datetime('now', '-7 days')"
        ).fetchone()["c"]
        return {
            "total_sessions": total,
            "sessions_this_week": recent,
            "current_session_messages": self._message_count,
            "current_topics": self._topics_discussed,
        }
