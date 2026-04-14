"""
Home AI Assistant - Learning & Memory Module
==============================================
Safe self-improvement system that allows the AI to get smarter
over time WITHOUT modifying any code or system configuration.

HOW IT WORKS:
  1. CONVERSATION MEMORY — persists conversation summaries across restarts
  2. USER PREFERENCES — learns how the user likes to interact
  3. COMMAND PATTERNS — tracks which commands succeed/fail and why
  4. FEEDBACK LOOP — user thumbs-up/down improves future responses
  5. KNOWLEDGE BASE — stores facts the AI learns about the user's environment

SAFETY GUARANTEES:
  - All learning data is stored in a SQLite DB (data only, never code)
  - Every learning event is logged to the main logger + backup
  - The AI cannot read/write the DB directly — only through this module
  - The owner can review, edit, or wipe all learned data at any time
  - Learning can be paused/disabled via config without data loss
  - A hard cap prevents unbounded data growth
"""

import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from logger import HomeAILogger


# ── Data Structures ─────────────────────────────────────────

class MemoryEntry:
    """A single piece of learned knowledge."""
    def __init__(self, category: str, key: str, value: str,
                 confidence: float = 0.5, source: str = "auto",
                 entry_id: Optional[int] = None):
        self.id = entry_id
        self.category = category      # e.g. "preference", "fact", "pattern"
        self.key = key                # e.g. "greeting_style", "home_server_ip"
        self.value = value            # the actual learned content
        self.confidence = confidence  # 0.0 to 1.0
        self.source = source          # "auto", "user_feedback", "explicit"
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        self.access_count = 0


class FeedbackEntry:
    """User feedback on an AI response."""
    def __init__(self, message_id: str, rating: int, user_message: str,
                 ai_response: str, correction: str = ""):
        self.message_id = message_id
        self.rating = rating          # -1 (bad), 0 (neutral), 1 (good)
        self.user_message = user_message
        self.ai_response = ai_response[:2000]
        self.correction = correction  # what the user wanted instead
        self.timestamp = datetime.now(timezone.utc).isoformat()


class CommandOutcome:
    """Tracks command success/failure for pattern learning."""
    def __init__(self, command_name: str, params: dict, success: bool,
                 user_intent: str = "", error: str = ""):
        self.command_name = command_name
        self.params = json.dumps(params)
        self.success = success
        self.user_intent = user_intent
        self.error = error
        self.timestamp = datetime.now(timezone.utc).isoformat()


# ── Learning Database ───────────────────────────────────────

class LearningDB:
    """
    SQLite-backed storage for all learning data.
    Thread-safe. Read-only to the AI — only this module writes.
    """

    MAX_MEMORIES = 5000
    MAX_FEEDBACK = 10000
    MAX_OUTCOMES = 50000
    MAX_SUMMARIES = 1000

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self):
        with self._lock:
            conn = sqlite3.connect(str(self._db_path))
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")

            conn.executescript("""
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    confidence REAL DEFAULT 0.5,
                    source TEXT DEFAULT 'auto',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    access_count INTEGER DEFAULT 0,
                    UNIQUE(category, key)
                );

                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL,
                    rating INTEGER NOT NULL,
                    user_message TEXT NOT NULL,
                    ai_response TEXT NOT NULL,
                    correction TEXT DEFAULT '',
                    timestamp TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS command_outcomes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    command_name TEXT NOT NULL,
                    params TEXT DEFAULT '{}',
                    success INTEGER NOT NULL,
                    user_intent TEXT DEFAULT '',
                    error TEXT DEFAULT '',
                    timestamp TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS conversation_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    topics TEXT DEFAULT '[]',
                    message_count INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_memories_category
                    ON memories(category);
                CREATE INDEX IF NOT EXISTS idx_feedback_rating
                    ON feedback(rating);
                CREATE INDEX IF NOT EXISTS idx_outcomes_command
                    ON command_outcomes(command_name);
            """)
            conn.close()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    # ── Memories ────────────────────────────────────────────

    def upsert_memory(self, entry: MemoryEntry):
        """Insert or update a memory. Enforces max cap."""
        with self._lock:
            conn = self._conn()
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("""
                INSERT INTO memories (category, key, value, confidence, source,
                                     created_at, updated_at, access_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                ON CONFLICT(category, key) DO UPDATE SET
                    value = excluded.value,
                    confidence = excluded.confidence,
                    updated_at = ?,
                    access_count = access_count + 1
            """, (entry.category, entry.key, entry.value, entry.confidence,
                  entry.source, now, now, now))
            conn.commit()

            # Enforce cap — remove lowest confidence entries
            count = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            if count > self.MAX_MEMORIES:
                excess = count - self.MAX_MEMORIES
                conn.execute("""
                    DELETE FROM memories WHERE id IN (
                        SELECT id FROM memories
                        ORDER BY confidence ASC, access_count ASC
                        LIMIT ?
                    )
                """, (excess,))
                conn.commit()
            conn.close()

    def get_memories(self, category: Optional[str] = None,
                     limit: int = 100) -> list[dict]:
        """Retrieve memories, optionally filtered by category."""
        with self._lock:
            conn = self._conn()
            if category:
                rows = conn.execute(
                    "SELECT * FROM memories WHERE category = ? "
                    "ORDER BY confidence DESC, access_count DESC LIMIT ?",
                    (category, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM memories "
                    "ORDER BY confidence DESC, access_count DESC LIMIT ?",
                    (limit,)
                ).fetchall()
            conn.close()
            return [dict(r) for r in rows]

    def delete_memory(self, memory_id: int):
        """Owner can delete specific memories."""
        with self._lock:
            conn = self._conn()
            conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            conn.commit()
            conn.close()

    # ── Feedback ────────────────────────────────────────────

    def add_feedback(self, entry: FeedbackEntry):
        with self._lock:
            conn = self._conn()
            conn.execute("""
                INSERT INTO feedback (message_id, rating, user_message,
                                     ai_response, correction, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (entry.message_id, entry.rating, entry.user_message,
                  entry.ai_response, entry.correction, entry.timestamp))
            conn.commit()

            # Enforce cap
            count = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
            if count > self.MAX_FEEDBACK:
                excess = count - self.MAX_FEEDBACK
                conn.execute(
                    "DELETE FROM feedback WHERE id IN "
                    "(SELECT id FROM feedback ORDER BY id ASC LIMIT ?)",
                    (excess,))
                conn.commit()
            conn.close()

    def get_feedback_stats(self) -> dict:
        """Get aggregate feedback statistics."""
        with self._lock:
            conn = self._conn()
            total = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
            positive = conn.execute(
                "SELECT COUNT(*) FROM feedback WHERE rating > 0"
            ).fetchone()[0]
            negative = conn.execute(
                "SELECT COUNT(*) FROM feedback WHERE rating < 0"
            ).fetchone()[0]
            conn.close()
            return {
                "total": total,
                "positive": positive,
                "negative": negative,
                "neutral": total - positive - negative,
                "satisfaction_rate": round(positive / total, 3) if total > 0 else 0,
            }

    def get_recent_negative_feedback(self, limit: int = 20) -> list[dict]:
        """Get recent negative feedback for learning from mistakes."""
        with self._lock:
            conn = self._conn()
            rows = conn.execute(
                "SELECT * FROM feedback WHERE rating < 0 "
                "ORDER BY timestamp DESC LIMIT ?",
                (limit,)
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]

    # ── Command Outcomes ────────────────────────────────────

    def add_outcome(self, entry: CommandOutcome):
        with self._lock:
            conn = self._conn()
            conn.execute("""
                INSERT INTO command_outcomes (command_name, params, success,
                                             user_intent, error, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (entry.command_name, entry.params, int(entry.success),
                  entry.user_intent, entry.error, entry.timestamp))
            conn.commit()

            # Cap
            count = conn.execute(
                "SELECT COUNT(*) FROM command_outcomes"
            ).fetchone()[0]
            if count > self.MAX_OUTCOMES:
                excess = count - self.MAX_OUTCOMES
                conn.execute(
                    "DELETE FROM command_outcomes WHERE id IN "
                    "(SELECT id FROM command_outcomes ORDER BY id ASC LIMIT ?)",
                    (excess,))
                conn.commit()
            conn.close()

    def get_command_success_rates(self) -> dict:
        """Get success rate per command."""
        with self._lock:
            conn = self._conn()
            rows = conn.execute("""
                SELECT command_name,
                       COUNT(*) as total,
                       SUM(success) as successes
                FROM command_outcomes
                GROUP BY command_name
            """).fetchall()
            conn.close()
            return {
                r["command_name"]: {
                    "total": r["total"],
                    "successes": r["successes"],
                    "rate": round(r["successes"] / r["total"], 3) if r["total"] > 0 else 0,
                }
                for r in rows
            }

    def get_common_errors(self, limit: int = 10) -> list[dict]:
        """Get most common command errors."""
        with self._lock:
            conn = self._conn()
            rows = conn.execute("""
                SELECT command_name, error, COUNT(*) as count
                FROM command_outcomes
                WHERE success = 0 AND error != ''
                GROUP BY command_name, error
                ORDER BY count DESC
                LIMIT ?
            """, (limit,)).fetchall()
            conn.close()
            return [dict(r) for r in rows]

    # ── Conversation Summaries ──────────────────────────────

    def add_summary(self, session_id: str, summary: str,
                    topics: list[str], message_count: int):
        with self._lock:
            conn = self._conn()
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("""
                INSERT INTO conversation_summaries
                    (session_id, summary, topics, message_count, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (session_id, summary, json.dumps(topics), message_count, now))
            conn.commit()

            # Cap
            count = conn.execute(
                "SELECT COUNT(*) FROM conversation_summaries"
            ).fetchone()[0]
            if count > self.MAX_SUMMARIES:
                excess = count - self.MAX_SUMMARIES
                conn.execute(
                    "DELETE FROM conversation_summaries WHERE id IN "
                    "(SELECT id FROM conversation_summaries ORDER BY id ASC LIMIT ?)",
                    (excess,))
                conn.commit()
            conn.close()

    def get_recent_summaries(self, limit: int = 10) -> list[dict]:
        with self._lock:
            conn = self._conn()
            rows = conn.execute(
                "SELECT * FROM conversation_summaries "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,)
            ).fetchall()
            conn.close()
            return [dict(r) for r in rows]

    # ── Admin / Owner Controls ──────────────────────────────

    def get_stats(self) -> dict:
        """Get overall learning database statistics."""
        with self._lock:
            conn = self._conn()
            stats = {
                "memories": conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0],
                "feedback_entries": conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0],
                "command_outcomes": conn.execute("SELECT COUNT(*) FROM command_outcomes").fetchone()[0],
                "conversation_summaries": conn.execute("SELECT COUNT(*) FROM conversation_summaries").fetchone()[0],
            }
            conn.close()
            return stats

    def wipe_all(self):
        """Owner emergency wipe — clears all learned data."""
        with self._lock:
            conn = self._conn()
            conn.executescript("""
                DELETE FROM memories;
                DELETE FROM feedback;
                DELETE FROM command_outcomes;
                DELETE FROM conversation_summaries;
            """)
            conn.close()

    def export_all(self) -> dict:
        """Export all learning data for review."""
        with self._lock:
            conn = self._conn()
            data = {
                "memories": [dict(r) for r in conn.execute("SELECT * FROM memories").fetchall()],
                "feedback": [dict(r) for r in conn.execute("SELECT * FROM feedback").fetchall()],
                "command_outcomes": [dict(r) for r in conn.execute("SELECT * FROM command_outcomes ORDER BY id DESC LIMIT 1000").fetchall()],
                "summaries": [dict(r) for r in conn.execute("SELECT * FROM conversation_summaries").fetchall()],
            }
            conn.close()
            return data


# ── Learning Engine ─────────────────────────────────────────

class LearningEngine:
    """
    The brain of the self-improvement system.
    Analyzes interactions and extracts learning signals.
    
    SAFETY: This module can only write to the LearningDB.
    It cannot modify code, config, system files, or permissions.
    Every learning action is logged.
    """

    def __init__(self, config: dict, logger: HomeAILogger, db: LearningDB):
        self._config = config.get("learning", {})
        self._logger = logger
        self._db = db
        self._enabled = self._config.get("enabled", True)
        self._session_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        # Counters for this session
        self._messages_this_session = 0
        self._session_topics: list[str] = []

        self._logger.info("learning", "Learning engine initialized", {
            "enabled": self._enabled,
            "session_id": self._session_id,
            "db_stats": db.get_stats(),
        })

    # ── Passive Learning (automatic) ────────────────────────

    def observe_interaction(self, user_message: str, ai_response: str,
                            commands: list[dict], results: list[dict]):
        """
        Called after every interaction. Extracts learning signals:
        - User language patterns & preferences
        - Command usage patterns
        - Success/failure tracking
        """
        if not self._enabled:
            return

        self._messages_this_session += 1

        # Track command outcomes
        for i, cmd in enumerate(commands):
            result = results[i] if i < len(results) else {}
            outcome = CommandOutcome(
                command_name=cmd.get("name", ""),
                params=result.get("result", {}) if isinstance(result.get("result"), dict) else {},
                success=result.get("success", False),
                user_intent=user_message[:200],
                error=str(result.get("error", ""))[:500],
            )
            self._db.add_outcome(outcome)

        # Learn user preferences from patterns
        self._learn_preferences(user_message, ai_response)

        # Log the learning event
        self._logger.info("learning", "Interaction observed", {
            "message_length": len(user_message),
            "commands_count": len(commands),
            "session_messages": self._messages_this_session,
        })

    def _learn_preferences(self, user_message: str, ai_response: str):
        """Extract preference signals from user messages."""
        msg_lower = user_message.lower()

        # Detect communication style preferences
        if len(user_message) < 20:
            self._db.upsert_memory(MemoryEntry(
                "preference", "brevity",
                "User tends to send short messages — prefer concise responses",
                confidence=0.3, source="auto"
            ))
        elif len(user_message) > 200:
            self._db.upsert_memory(MemoryEntry(
                "preference", "detail_level",
                "User sends detailed messages — they may prefer thorough responses",
                confidence=0.3, source="auto"
            ))

        # Track common topics
        topic_keywords = {
            "system": ["status", "cpu", "memory", "disk", "uptime"],
            "files": ["file", "document", "folder", "directory", "list"],
            "ssh": ["ssh", "server", "remote", "connect"],
            "smart_home": ["light", "temperature", "device", "sensor"],
            "time": ["time", "date", "schedule"],
        }
        for topic, keywords in topic_keywords.items():
            if any(kw in msg_lower for kw in keywords):
                if topic not in self._session_topics:
                    self._session_topics.append(topic)

    # ── Active Learning (from feedback) ─────────────────────

    def record_feedback(self, message_id: str, rating: int,
                        user_message: str, ai_response: str,
                        correction: str = ""):
        """
        Record user feedback (thumbs up/down) on an AI response.
        This is the strongest learning signal.
        """
        if not self._enabled:
            return

        feedback = FeedbackEntry(
            message_id=message_id,
            rating=rating,
            user_message=user_message,
            ai_response=ai_response,
            correction=correction,
        )
        self._db.add_feedback(feedback)

        # If user provided a correction, store it as a high-confidence memory
        if correction and rating < 0:
            self._db.upsert_memory(MemoryEntry(
                "correction",
                f"correction_{message_id[:8]}",
                f"When user said '{user_message[:100]}', "
                f"they wanted: '{correction[:200]}' "
                f"(not: '{ai_response[:100]}')",
                confidence=0.9,
                source="user_feedback",
            ))

        self._logger.info("learning", "Feedback recorded", {
            "message_id": message_id,
            "rating": rating,
            "has_correction": bool(correction),
        })

    # ── Explicit Learning (user tells the AI something) ─────

    def learn_fact(self, key: str, value: str, category: str = "fact"):
        """User explicitly teaches the AI a fact."""
        if not self._enabled:
            return

        entry = MemoryEntry(
            category=category,
            key=key,
            value=value,
            confidence=1.0,  # User-stated facts are highest confidence
            source="explicit",
        )
        self._db.upsert_memory(entry)

        self._logger.info("learning", "Fact learned from user", {
            "category": category,
            "key": key,
        })

    # ── Session Summary ─────────────────────────────────────

    def save_session_summary(self, summary: str = ""):
        """Save a summary of the current conversation session."""
        if not self._enabled:
            return
        if self._messages_this_session == 0:
            return

        if not summary:
            summary = (
                f"Session with {self._messages_this_session} messages. "
                f"Topics: {', '.join(self._session_topics) or 'general conversation'}."
            )

        self._db.add_summary(
            session_id=self._session_id,
            summary=summary,
            topics=self._session_topics,
            message_count=self._messages_this_session,
        )

        self._logger.info("learning", "Session summary saved", {
            "session_id": self._session_id,
            "message_count": self._messages_this_session,
            "topics": self._session_topics,
        })

    # ── Context Generation (for AI prompts) ─────────────────

    def build_context(self) -> str:
        """
        Build a context block from learned knowledge to inject
        into the AI's system prompt. This is HOW the AI improves.
        
        Returns a formatted string of relevant memories,
        preferences, and patterns.
        """
        if not self._enabled:
            return ""

        sections = []

        # User preferences
        prefs = self._db.get_memories("preference", limit=15)
        if prefs:
            pref_lines = [f"  - {p['value']}" for p in prefs]
            sections.append(
                "USER PREFERENCES (learned from past interactions):\n"
                + "\n".join(pref_lines)
            )

        # Known facts
        facts = self._db.get_memories("fact", limit=20)
        if facts:
            fact_lines = [f"  - {f['key']}: {f['value']}" for f in facts]
            sections.append(
                "KNOWN FACTS (provided by the user):\n"
                + "\n".join(fact_lines)
            )

        # Corrections to avoid repeating mistakes
        corrections = self._db.get_memories("correction", limit=10)
        if corrections:
            corr_lines = [f"  - {c['value']}" for c in corrections]
            sections.append(
                "PAST CORRECTIONS (avoid these mistakes):\n"
                + "\n".join(corr_lines)
            )

        # Recent conversation context
        summaries = self._db.get_recent_summaries(limit=5)
        if summaries:
            summ_lines = [f"  - {s['summary']}" for s in summaries]
            sections.append(
                "RECENT CONVERSATION HISTORY:\n"
                + "\n".join(summ_lines)
            )

        # Command performance
        rates = self._db.get_command_success_rates()
        failing = {k: v for k, v in rates.items() if v["rate"] < 0.7 and v["total"] >= 3}
        if failing:
            fail_lines = [
                f"  - {cmd}: {v['rate']*100:.0f}% success ({v['total']} attempts)"
                for cmd, v in failing.items()
            ]
            sections.append(
                "COMMANDS WITH LOW SUCCESS RATE (be careful with these):\n"
                + "\n".join(fail_lines)
            )

        # Feedback summary
        stats = self._db.get_feedback_stats()
        if stats["total"] >= 5:
            sections.append(
                f"FEEDBACK SUMMARY: {stats['satisfaction_rate']*100:.0f}% satisfaction "
                f"({stats['positive']} positive, {stats['negative']} negative "
                f"out of {stats['total']} rated responses)"
            )

        if not sections:
            return ""

        return (
            "\n\n--- LEARNED CONTEXT (from past interactions) ---\n"
            + "\n\n".join(sections)
            + "\n--- END LEARNED CONTEXT ---\n"
        )

    # ── Admin endpoints ─────────────────────────────────────

    def get_stats(self) -> dict:
        return {
            "enabled": self._enabled,
            "session_id": self._session_id,
            "messages_this_session": self._messages_this_session,
            "session_topics": self._session_topics,
            "db": self._db.get_stats(),
            "feedback": self._db.get_feedback_stats(),
            "command_success_rates": self._db.get_command_success_rates(),
        }

    def pause(self):
        """Owner pauses learning."""
        self._enabled = False
        self._logger.info("learning", "Learning PAUSED by owner")

    def resume(self):
        """Owner resumes learning."""
        self._enabled = True
        self._logger.info("learning", "Learning RESUMED by owner")

    def wipe(self):
        """Owner wipes all learned data. LOGGED AND IRREVERSIBLE."""
        self._logger.critical("learning",
                              "OWNER WIPED ALL LEARNING DATA")
        self._db.wipe_all()
