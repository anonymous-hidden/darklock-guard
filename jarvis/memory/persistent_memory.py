"""
Nova — Persistent Memory System
=================================
Cross-conversation memory that remembers everything about the user.

Four memory tiers:
1. Facts — concrete data (name, preferences, project info)
2. Observations — behavioral patterns Nova notices over time
3. Relationship — how Nova relates to the user (trust, rapport)
4. Explicit — things the user directly told Nova to remember

The AI can store memories via the 'remember' command, and Nova also
auto-extracts important facts from every conversation using both
regex patterns AND LLM-powered analysis.

All memory is stored locally in SQLite — never leaves the machine.
"""

import json
import re
from datetime import datetime

import httpx

from memory.store import MemoryStore
from logs.audit import AuditLogger

# Stop-words for relevance matching (excluded from keyword extraction)
_STOP_WORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "what", "when", "where", "which", "who", "whom", "whose", "that",
    "this", "these", "those", "it", "its", "i", "me", "my", "we", "our",
    "you", "your", "he", "him", "his", "she", "her", "they", "them",
    "their", "and", "but", "or", "not", "no", "nor", "so", "if", "then",
    "than", "too", "very", "just", "about", "above", "after", "again",
    "all", "also", "any", "because", "before", "between", "both", "by",
    "each", "for", "from", "get", "got", "how", "in", "into", "of", "on",
    "only", "other", "out", "over", "own", "same", "some", "such", "to",
    "up", "with", "here", "there", "now", "hey", "hi", "hello", "okay",
    "yeah", "yes", "sure", "thanks", "thank", "please", "well", "like",
    "know", "think", "want", "going", "tell", "make", "really", "much",
    "more", "most", "still", "even", "back", "way", "take", "come",
    "good", "new", "first", "last", "long", "great", "little", "right",
    "old", "big", "high", "different", "small", "large", "next", "early",
})


class PersistentMemory:
    """Long-term memory that persists across all conversations."""

    def __init__(self, store: MemoryStore, audit: AuditLogger):
        self._store = store
        self._audit = audit
        self._ollama_base: str = "http://localhost:11434"
        self._fast_model: str | None = None
        self._ensure_tables()

    def set_ai_config(self, ollama_url: str, fast_model: str):
        """Configure AI backend for LLM-powered memory extraction."""
        self._ollama_base = ollama_url
        self._fast_model = fast_model
        self._audit.log("memory", "ai_config_set", {"model": fast_model})

    def _ensure_tables(self):
        """Create memory tables if they don't exist."""
        conn = self._store._conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS long_memory (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                category    TEXT NOT NULL,
                key         TEXT NOT NULL,
                value       TEXT NOT NULL,
                importance  INTEGER DEFAULT 5,
                access_count INTEGER DEFAULT 0,
                source      TEXT DEFAULT 'regex',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                UNIQUE(category, key)
            );
            CREATE TABLE IF NOT EXISTS user_profile (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS emotional_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                mood       TEXT NOT NULL,
                energy     REAL NOT NULL,
                trigger    TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversation_summaries (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                summary         TEXT NOT NULL,
                topics          TEXT,
                mood            TEXT,
                created_at      TEXT NOT NULL
            );
        """)
        # Add source column to existing tables that don't have it
        try:
            conn.execute("SELECT source FROM long_memory LIMIT 1")
        except Exception:
            conn.execute("ALTER TABLE long_memory ADD COLUMN source TEXT DEFAULT 'regex'")
        conn.commit()

    # ── User Profile (facts about the user) ────────────

    def set_user_fact(self, key: str, value: str):
        """Store a fact about the user (name, preferences, etc.)."""
        now = datetime.now().isoformat()
        conn = self._store._conn()
        conn.execute(
            "INSERT OR REPLACE INTO user_profile (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )
        conn.commit()
        self._audit.log("memory", "user_fact_stored", {"key": key})

    def get_user_fact(self, key: str) -> str | None:
        row = self._store._conn().execute(
            "SELECT value FROM user_profile WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def get_all_user_facts(self) -> dict[str, str]:
        rows = self._store._conn().execute("SELECT key, value FROM user_profile").fetchall()
        return {r["key"]: r["value"] for r in rows}

    # ── Long-term Memory ───────────────────────────────

    def remember(self, category: str, key: str, value: str, importance: int = 5,
                 source: str = "regex"):
        """Store a long-term memory with deduplication and contradiction handling."""
        now = datetime.now().isoformat()
        conn = self._store._conn()

        # Check for existing memory with same category+key
        existing = conn.execute(
            "SELECT id, value, importance FROM long_memory WHERE category=? AND key=?",
            (category, key),
        ).fetchone()

        if existing:
            old_value = existing["value"]
            # If the value is meaningfully different, update it (contradiction handling)
            if old_value.strip().lower() != value.strip().lower():
                conn.execute(
                    "UPDATE long_memory SET value=?, importance=?, updated_at=? "
                    "WHERE category=? AND key=?",
                    (value, max(importance, existing["importance"]), now, category, key),
                )
                self._audit.log("memory", "updated_memory", {
                    "category": category, "key": key,
                    "old": old_value[:50], "new": value[:50],
                })
            # Same value — just bump the access count
            else:
                conn.execute(
                    "UPDATE long_memory SET access_count = access_count + 1, updated_at=? "
                    "WHERE category=? AND key=?",
                    (now, category, key),
                )
        else:
            # Check for near-duplicates by fuzzy match on value
            similar = conn.execute(
                "SELECT id, key, value FROM long_memory WHERE category=? AND value LIKE ?",
                (category, f"%{value[:30]}%"),
            ).fetchall()

            if similar:
                # Update the most relevant existing memory instead of creating a duplicate
                conn.execute(
                    "UPDATE long_memory SET value=?, importance=MAX(importance, ?), updated_at=? "
                    "WHERE id=?",
                    (value, importance, now, similar[0]["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO long_memory "
                    "(category, key, value, importance, access_count, source, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
                    (category, key, value, importance, source, now, now),
                )
        conn.commit()

    def recall(self, key: str) -> list[dict]:
        """Search long-term memory by key (fuzzy)."""
        conn = self._store._conn()
        rows = conn.execute(
            "SELECT * FROM long_memory WHERE key LIKE ? OR value LIKE ? "
            "ORDER BY importance DESC, access_count DESC LIMIT 20",
            (f"%{key}%", f"%{key}%"),
        ).fetchall()
        # Bump access count for retrieved memories
        for r in rows:
            conn.execute(
                "UPDATE long_memory SET access_count = access_count + 1 WHERE id = ?",
                (r["id"],),
            )
        conn.commit()
        return [dict(r) for r in rows]

    def get_recent_memories(self, count: int = 20) -> list[dict]:
        """Get most recently updated memories."""
        rows = self._store._conn().execute(
            "SELECT * FROM long_memory ORDER BY updated_at DESC LIMIT ?", (count,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_important_memories(self, count: int = 15) -> list[dict]:
        """Get highest importance + most accessed memories for prompt injection."""
        rows = self._store._conn().execute(
            "SELECT * FROM long_memory "
            "ORDER BY importance DESC, access_count DESC LIMIT ?", (count,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Conversation Summaries ─────────────────────────

    def save_conversation_summary(self, conversation_id: int, summary: str,
                                   topics: list[str], mood: str):
        """Store a summary of a conversation for long-term reference."""
        now = datetime.now().isoformat()
        conn = self._store._conn()
        conn.execute(
            "INSERT INTO conversation_summaries "
            "(conversation_id, summary, topics, mood, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (conversation_id, summary, json.dumps(topics), mood, now),
        )
        conn.commit()
        self._audit.log("memory", "summary_saved", {
            "conversation_id": conversation_id, "length": len(summary),
        })

    def get_recent_summaries(self, count: int = 10) -> list[dict]:
        """Get recent conversation summaries for context."""
        rows = self._store._conn().execute(
            "SELECT * FROM conversation_summaries ORDER BY created_at DESC LIMIT ?",
            (count,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Emotional State Log ────────────────────────────

    def log_emotion(self, mood: str, energy: float, trigger: str = ""):
        """Log an emotional state change."""
        now = datetime.now().isoformat()
        self._store._conn().execute(
            "INSERT INTO emotional_log (mood, energy, trigger, created_at) VALUES (?, ?, ?, ?)",
            (mood, energy, trigger, now),
        )
        self._store._conn().commit()

    def get_emotional_history(self, count: int = 20) -> list[dict]:
        rows = self._store._conn().execute(
            "SELECT * FROM emotional_log ORDER BY created_at DESC LIMIT ?", (count,)
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Auto-extraction from conversations ─────────────

    def extract_facts_from_message(self, user_message: str):
        """
        Extract user facts from their messages — runs on every user message.
        Captures: name, preferences, projects, tools, schedule, goals, and more.
        Also handles explicit "remember this" and "forget that" requests.
        """
        msg = user_message.lower().strip()
        extracted = []

        # ── Explicit "remember this" patterns (highest priority) ──
        remember_match = re.search(
            r"(?:remember (?:that |this[: ]*)?|don'?t forget (?:that )?|keep in mind[: ]*)"
            r"\s*(.+?)(?:\.|!|$)",
            user_message, re.IGNORECASE,
        )
        if remember_match:
            text = remember_match.group(1).strip()
            if len(text) > 3:  # avoid empty/trivial
                self.remember(
                    "explicit",
                    f"user_said_{datetime.now().strftime('%m%d_%H%M')}",
                    text, importance=8, source="user_explicit",
                )
                extracted.append(f"explicit:user_said={text[:60]}")

        # ── Explicit "forget" patterns ──
        forget_match = re.search(
            r"(?:forget (?:about |that )?|never ?mind (?:about )?|disregard )"
            r"\s*(.+?)(?:\.|!|$)",
            user_message, re.IGNORECASE,
        )
        if forget_match:
            topic = forget_match.group(1).strip()
            if len(topic) > 2:
                matches = self.recall(topic)
                removed = 0
                for m in matches[:3]:
                    self.forget(m["id"])
                    removed += 1
                if removed:
                    self._audit.log("memory", "explicit_forget", {
                        "topic": topic, "removed": removed,
                    })

        # Name extraction
        for pattern in [
            r"(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)",
            r"(?:name's)\s+([A-Z][a-z]+)",
        ]:
            m = re.search(pattern, user_message, re.IGNORECASE)
            if m:
                self.set_user_fact("name", m.group(1).strip())
                extracted.append(f"name={m.group(1).strip()}")

        # Preference patterns
        pref_patterns = [
            (r"i (?:prefer|like|love|enjoy)\s+(.+?)(?:\.|$|,)", "likes"),
            (r"i (?:hate|dislike|don't like|can't stand)\s+(.+?)(?:\.|$|,)", "dislikes"),
            (r"my favorite (\w+) is (.+?)(?:\.|$|,)", None),  # handled specially
            (r"i (?:use|work with|code in|develop in)\s+(.+?)(?:\.|$|,)", "tools"),
        ]
        for pattern, key in pref_patterns:
            m = re.search(pattern, user_message, re.IGNORECASE)
            if m:
                if key is None:
                    # "my favorite X is Y"
                    self.remember("preference", f"favorite_{m.group(1)}", m.group(2).strip())
                    extracted.append(f"preference:favorite_{m.group(1)}={m.group(2).strip()}")
                else:
                    self.remember("preference", key, m.group(1).strip())
                    extracted.append(f"preference:{key}={m.group(1).strip()}")

        # Project mentions
        proj_match = re.search(
            r"(?:working on|my project|building)\s+(?:a\s+)?(.+?)(?:\.|$|,)",
            user_message, re.IGNORECASE
        )
        if proj_match:
            self.remember("context", "current_project", proj_match.group(1).strip())
            extracted.append(f"context:current_project={proj_match.group(1).strip()}")

        # Location mentions
        loc_match = re.search(
            r"(?:i live in|i'm in|i'm from|based in|located in)\s+(.+?)(?:\.|$|,)",
            user_message, re.IGNORECASE
        )
        if loc_match:
            self.set_user_fact("location", loc_match.group(1).strip())
            extracted.append(f"location={loc_match.group(1).strip()}")

        # Schedule/routine mentions
        sched_match = re.search(
            r"(?:i (?:usually|always|normally))\s+(.+?)(?:\.|$)",
            user_message, re.IGNORECASE
        )
        if sched_match:
            self.remember("routine", "habit", sched_match.group(1).strip(), importance=4)
            extracted.append(f"routine:habit={sched_match.group(1).strip()}")

        # Goal/aspiration mentions
        goal_match = re.search(
            r"(?:i want to|i'm trying to|my goal is|i need to)\s+(.+?)(?:\.|$)",
            user_message, re.IGNORECASE
        )
        if goal_match:
            self.remember("goal", f"goal_{datetime.now().strftime('%m%d')}", 
                         goal_match.group(1).strip(), importance=6)
            extracted.append(f"goal={goal_match.group(1).strip()}")

        if extracted:
            self._audit.log("memory", "facts_extracted", {
                "count": len(extracted), "facts": extracted[:10],
            })

    # ── Build context string for prompts ───────────────

    def build_memory_context(self, user_message: str = "") -> str:
        """Build a context string from all memory sources for the system prompt.
        
        When user_message is provided, also includes memories relevant to
        the current conversation topic (not just top-N by importance).
        """
        parts = []

        # User profile
        facts = self.get_all_user_facts()
        if facts:
            lines = [f"  {k}: {v}" for k, v in facts.items()]
            parts.append("## What I Know About You\n" + "\n".join(lines))

        # Important memories (always-on top tier)
        memories = self.get_important_memories(10)
        important_ids = {m["id"] for m in memories} if memories else set()
        if memories:
            lines = [f"  [{m['category']}] {m['key']}: {m['value']}" for m in memories]
            parts.append("## Long-Term Memories\n" + "\n".join(lines))

        # Relevant memories for this specific message (contextual recall)
        if user_message:
            relevant = self.get_relevant_memories(user_message, count=5)
            relevant_unique = [m for m in relevant if m["id"] not in important_ids]
            if relevant_unique:
                lines = [f"  [{m['category']}] {m['key']}: {m['value']}" for m in relevant_unique]
                parts.append(
                    "## Context from Memory (relevant to this conversation)\n"
                    + "\n".join(lines)
                )

        # Recent conversation summaries
        summaries = self.get_recent_summaries(5)
        if summaries:
            lines = []
            for s in summaries:
                topics = json.loads(s.get("topics", "[]")) if s.get("topics") else []
                topic_str = ", ".join(topics) if topics else "general"
                lines.append(f"  - [{s['created_at'][:10]}] {s['summary'][:100]} (topics: {topic_str})")
            parts.append("## Recent Conversation History\n" + "\n".join(lines))

        return "\n\n".join(parts)

    # ── Contextual / semantic recall ───────────────────

    def get_relevant_memories(self, query: str, count: int = 5) -> list[dict]:
        """Find memories relevant to a query using multi-keyword matching."""
        words = [
            w for w in re.findall(r"[a-zA-Z]{3,}", query.lower())
            if w not in _STOP_WORDS
        ]
        if not words:
            return []

        # Build OR conditions for each keyword
        conditions = " OR ".join(["(key LIKE ? OR value LIKE ?)"] * len(words))
        params: list = []
        for w in words:
            params.extend([f"%{w}%", f"%{w}%"])
        params.append(count)

        rows = self._store._conn().execute(
            f"SELECT * FROM long_memory WHERE {conditions} "
            "ORDER BY importance DESC, access_count DESC LIMIT ?",
            params,
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Forget / delete ────────────────────────────────

    def forget(self, memory_id: int) -> bool:
        """Delete a specific memory by ID."""
        conn = self._store._conn()
        conn.execute("DELETE FROM long_memory WHERE id = ?", (memory_id,))
        conn.commit()
        deleted = conn.total_changes > 0
        if deleted:
            self._audit.log("memory", "forgotten", {"id": memory_id})
        return deleted

    def forget_by_key(self, category: str, key: str) -> bool:
        """Delete a memory by category and key."""
        conn = self._store._conn()
        conn.execute(
            "DELETE FROM long_memory WHERE category = ? AND key = ?",
            (category, key),
        )
        conn.commit()
        deleted = conn.total_changes > 0
        if deleted:
            self._audit.log("memory", "forgotten_by_key", {
                "category": category, "key": key,
            })
        return deleted

    def delete_user_fact(self, key: str) -> bool:
        """Delete a user profile fact."""
        conn = self._store._conn()
        conn.execute("DELETE FROM user_profile WHERE key = ?", (key,))
        conn.commit()
        return conn.total_changes > 0

    # ── Importance decay ───────────────────────────────

    def decay_old_memories(self, days_threshold: int = 30):
        """Reduce importance of memories not accessed in a long time.
        
        Memories that haven't been updated/accessed in `days_threshold` days
        lose 1 importance point (minimum 1). This prevents old noise from
        permanently occupying top-memory slots.
        """
        conn = self._store._conn()
        affected = conn.execute(
            "UPDATE long_memory SET importance = MAX(1, importance - 1) "
            "WHERE julianday('now') - julianday(updated_at) > ? "
            "AND importance > 1 AND source != 'user_explicit'",
            (days_threshold,),
        ).rowcount
        conn.commit()
        if affected:
            self._audit.log("memory", "decay_applied", {"affected": affected})
        return affected

    # ── LLM-powered memory extraction ──────────────────

    async def extract_memories_with_ai(self, user_message: str, ai_response: str):
        """Use the fast LLM to identify what's worth remembering from an exchange.
        
        This runs asynchronously in the background after each response,
        capturing nuanced information that regex patterns miss.
        Only stores memories with importance >= 6 to avoid polluting
        long-term memory with trivial session context.
        """
        if not self._fast_model:
            return

        # Skip trivial/short exchanges — need real substance to extract from
        if len(user_message.strip()) < 30:
            return

        # Skip common non-informative messages
        _skip = {"hi", "hey", "hello", "thanks", "thank you", "ok", "okay",
                 "yes", "no", "sure", "got it", "cool", "nice", "bye",
                 "what model is this", "what model are you", "who are you"}
        if user_message.strip().lower().rstrip("!?.") in _skip:
            return

        prompt = (
            "Analyze this conversation and extract ONLY important, lasting facts about the USER "
            "(not the AI). Return a JSON array of memories.\n\n"
            f"User: \"{user_message}\"\n"
            f"Assistant: \"{ai_response[:500]}\"\n\n"
            "Each memory object needs:\n"
            '- "category": one of "preference", "fact", "goal", "routine", "opinion", "relationship"\n'
            '- "key": short snake_case label (2-5 words)\n'
            '- "value": the information to remember (1 sentence max)\n'
            '- "importance": 1-10 (10=critical like name/identity, 7=strong preference/project, 5=useful context, 1=trivial)\n\n'
            "Rules:\n"
            "- ONLY extract facts that would still matter in a week or longer\n"
            "- NEVER create memories about: the current conversation itself, what model is being used, "
            "session duration, greetings, the AI's capabilities, switching features, or technical meta-info\n"
            "- NEVER create memories that describe what the user is asking or doing RIGHT NOW in this chat "
            "(like 'user wants to know X' or 'user is asking about Y') — that's session context, not memory\n"
            "- DO create memories about: the user's real preferences, personal facts, projects they're building, "
            "long-term goals, habits, opinions, relationships, hardware/software they use\n"
            "- If nothing worth remembering long-term, return [] — this is the EXPECTED output most of the time\n"
            "- Return ONLY valid JSON array, no explanation\n"
        )

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self._ollama_base}/api/chat",
                    json={
                        "model": self._fast_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": False,
                        "options": {"temperature": 0.1, "num_predict": 500},
                    },
                )
                resp.raise_for_status()
                text = resp.json()["message"]["content"]

                # Parse JSON array from response
                start = text.find("[")
                end = text.rfind("]") + 1
                if start >= 0 and end > start:
                    memories = json.loads(text[start:end])
                    stored = 0
                    for mem in memories:
                        if not all(k in mem for k in ("category", "key", "value")):
                            continue
                        imp = min(10, max(1, int(mem.get("importance", 5))))
                        # Only store memories that are genuinely important (>= 6)
                        # This prevents trivial session observations from becoming long-term
                        if imp < 6:
                            continue
                        # Filter out meta/session junk the LLM still sneaks through
                        val_lower = mem["value"].lower()
                        key_lower = mem["key"].lower()
                        if any(junk in val_lower for junk in (
                            "session", "conversation", "chat started", "active for",
                            "model", "switching", "nova", "ollama", "assistant",
                        )):
                            continue
                        if any(junk in key_lower for junk in (
                            "session", "chat_start", "model_", "ai_",
                            "assistant_", "conversation",
                        )):
                            continue
                        # Validate category — no "context" (too vague/transient)
                        cat = mem["category"]
                        if cat not in (
                            "preference", "fact", "routine",
                            "goal", "opinion", "relationship",
                        ):
                            continue  # skip instead of defaulting to "context"
                        self.remember(cat, mem["key"], mem["value"],
                                      importance=imp, source="ai")
                        stored += 1
                    if stored:
                        self._audit.log("memory", "ai_extracted", {
                            "count": stored,
                            "keys": [m.get("key", "?") for m in memories][:5],
                        })
        except json.JSONDecodeError:
            pass  # LLM returned invalid JSON — skip silently
        except Exception as e:
            self._audit.log("memory", "ai_extract_error", {"error": str(e)[:200]})

    # ── Memory stats ───────────────────────────────────

    def get_all_memories(self, limit: int = 100) -> list[dict]:
        """Get all memories for management UI."""
        rows = self._store._conn().execute(
            "SELECT * FROM long_memory ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_memory_stats(self) -> dict:
        """Return memory statistics for diagnostics."""
        conn = self._store._conn()
        total = conn.execute("SELECT COUNT(*) as c FROM long_memory").fetchone()["c"]
        by_cat = conn.execute(
            "SELECT category, COUNT(*) as c FROM long_memory GROUP BY category"
        ).fetchall()
        by_source = conn.execute(
            "SELECT source, COUNT(*) as c FROM long_memory GROUP BY source"
        ).fetchall()
        profile_count = conn.execute("SELECT COUNT(*) as c FROM user_profile").fetchone()["c"]
        summary_count = conn.execute(
            "SELECT COUNT(*) as c FROM conversation_summaries"
        ).fetchone()["c"]
        return {
            "total_memories": total,
            "profile_facts": profile_count,
            "conversation_summaries": summary_count,
            "by_category": {r["category"]: r["c"] for r in by_cat},
            "by_source": {r["source"]: r["c"] for r in by_source},
        }
