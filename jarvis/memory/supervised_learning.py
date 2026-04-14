"""
Nova — Supervised Learning System
====================================
Three-layer learning that makes Nova genuinely improve over time.

Layer 1: Real-time Preference Memory
  - Captures feedback signals (thumbs up/down, corrections, explicit preferences)
  - Stores in SQLite with category, signal strength, and context
  - Injected into every prompt via PromptBuilder

Layer 2: Nightly Pattern Recognition
  - Scheduled job reads conversation logs from the past 24h
  - Uses the local LLM to identify behavioral patterns
  - Writes discovered patterns to a patterns table
  - Patterns are injected into Nova's context

Layer 3: LoRA Fine-Tuning Pipeline
  - Owner approves conversation pairs for training
  - Exports approved data as JSONL training format
  - Generates Modelfile for Ollama with FROM + ADAPTER
  - All training data requires explicit approval

SAFETY: Only Cayden can approve training data. The learning engine
never modifies identity.py or security files.
"""

import json
import logging
import asyncio
import threading
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from memory.store import MemoryStore
from logs.audit import AuditLogger

logger = logging.getLogger(__name__)
CST = ZoneInfo("America/Chicago")


class SupervisedLearning:
    """Three-layer learning system for Nova."""

    def __init__(self, store: MemoryStore, audit: AuditLogger, base_dir: Path, config=None):
        self._store = store
        self._audit = audit
        self._base_dir = base_dir
        self._config = config
        self._training_dir = base_dir / "data" / "training"
        self._training_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_tables()
        self._running = False
        self._thread = None

    def _ensure_tables(self):
        conn = self._store._conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS feedback (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id  INTEGER,
                conv_id     INTEGER,
                signal      TEXT NOT NULL,
                strength    REAL DEFAULT 1.0,
                user_msg    TEXT,
                nova_msg    TEXT,
                correction  TEXT,
                category    TEXT DEFAULT 'general',
                created_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS learned_patterns (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern     TEXT NOT NULL,
                category    TEXT NOT NULL,
                confidence  REAL DEFAULT 0.5,
                source      TEXT DEFAULT 'nightly',
                examples    TEXT,
                active      INTEGER DEFAULT 1,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS training_pairs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                conv_id     INTEGER,
                system_prompt TEXT,
                user_msg    TEXT NOT NULL,
                nova_msg    TEXT NOT NULL,
                approved    INTEGER DEFAULT 0,
                rejected    INTEGER DEFAULT 0,
                quality     REAL DEFAULT 0.0,
                created_at  TEXT NOT NULL,
                reviewed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS fine_tune_runs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                status      TEXT DEFAULT 'pending',
                pairs_count INTEGER DEFAULT 0,
                output_path TEXT,
                error       TEXT,
                created_at  TEXT NOT NULL,
                completed_at TEXT
            );
        """)
        conn.commit()

    # ═══════════════════════════════════════════════════
    #  LAYER 1: Real-time Preference Memory
    # ═══════════════════════════════════════════════════

    def record_feedback(self, conv_id: int, signal: str, user_msg: str = "",
                        nova_msg: str = "", correction: str = "",
                        category: str = "general", strength: float = 1.0,
                        message_id: int | None = None) -> int:
        """Record a feedback signal from the user.

        Signals: 'positive', 'negative', 'correction', 'preference'
        """
        now = datetime.now(CST).isoformat()
        conn = self._store._conn()
        cur = conn.execute(
            "INSERT INTO feedback (message_id, conv_id, signal, strength, user_msg, "
            "nova_msg, correction, category, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (message_id, conv_id, signal, strength, user_msg, nova_msg,
             correction, category, now),
        )
        conn.commit()
        self._audit.log("learning", "feedback_recorded", {
            "signal": signal, "category": category, "conv_id": conv_id,
        })

        # Auto-generate a training pair from corrections
        if signal == "correction" and correction and nova_msg:
            self._auto_create_training_pair(conv_id, user_msg, correction)

        return cur.lastrowid

    def get_feedback_summary(self, limit: int = 50) -> list[dict]:
        """Get recent feedback for prompt injection."""
        rows = self._store._conn().execute(
            "SELECT signal, category, user_msg, nova_msg, correction, strength, created_at "
            "FROM feedback ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_preference_signals(self) -> dict:
        """Aggregate feedback into preference signals for the prompt builder."""
        conn = self._store._conn()

        # Positive patterns — what Nova did that the user liked
        positives = conn.execute(
            "SELECT nova_msg, category, COUNT(*) as count FROM feedback "
            "WHERE signal='positive' AND nova_msg != '' "
            "GROUP BY category ORDER BY count DESC LIMIT 10"
        ).fetchall()

        # Negative patterns — what to avoid
        negatives = conn.execute(
            "SELECT nova_msg, category, COUNT(*) as count FROM feedback "
            "WHERE signal='negative' AND nova_msg != '' "
            "GROUP BY category ORDER BY count DESC LIMIT 10"
        ).fetchall()

        # Corrections — explicit "do this instead" signals
        corrections = conn.execute(
            "SELECT user_msg, nova_msg, correction, category FROM feedback "
            "WHERE signal='correction' AND correction != '' "
            "ORDER BY created_at DESC LIMIT 15"
        ).fetchall()

        # Explicit preferences
        preferences = conn.execute(
            "SELECT user_msg, category FROM feedback "
            "WHERE signal='preference' ORDER BY created_at DESC LIMIT 10"
        ).fetchall()

        return {
            "positives": [dict(r) for r in positives],
            "negatives": [dict(r) for r in negatives],
            "corrections": [dict(r) for r in corrections],
            "preferences": [dict(r) for r in preferences],
        }

    def build_feedback_context(self) -> str:
        """Build a context string from feedback for the system prompt."""
        signals = self.get_preference_signals()
        parts = []

        if signals["corrections"]:
            lines = []
            for c in signals["corrections"][:10]:
                lines.append(f"  - When asked \"{c['user_msg'][:60]}\" → "
                           f"don't say \"{c['nova_msg'][:40]}…\" → "
                           f"instead: \"{c['correction'][:60]}\"")
            parts.append("## Learned Corrections\n" + "\n".join(lines))

        if signals["positives"]:
            lines = [f"  - {p['category']}: responses like this work well (×{p['count']})"
                    for p in signals["positives"][:5]]
            parts.append("## What Works Well\n" + "\n".join(lines))

        if signals["negatives"]:
            lines = [f"  - {n['category']}: avoid this approach (×{n['count']})"
                    for n in signals["negatives"][:5]]
            parts.append("## What to Avoid\n" + "\n".join(lines))

        if signals["preferences"]:
            lines = [f"  - {p['user_msg'][:80]}" for p in signals["preferences"][:5]]
            parts.append("## Explicit Preferences\n" + "\n".join(lines))

        return "\n\n".join(parts)

    # ═══════════════════════════════════════════════════
    #  LAYER 2: Nightly Pattern Recognition
    # ═══════════════════════════════════════════════════

    async def run_pattern_recognition(self) -> dict:
        """Analyze recent conversations to discover behavioral patterns.

        This reads the last 24h of conversation logs and uses the local
        LLM to identify what the user likes, dislikes, and patterns in
        how they interact.
        """
        conn = self._store._conn()
        cutoff = (datetime.now(CST) - timedelta(hours=24)).isoformat()

        # Get recent conversations with messages
        convs = conn.execute(
            "SELECT DISTINCT conversation_id FROM messages "
            "WHERE created_at > ? ORDER BY created_at DESC LIMIT 20",
            (cutoff,)
        ).fetchall()

        if not convs:
            return {"status": "no_conversations", "patterns": 0}

        # Gather conversation text
        all_text = []
        for c in convs:
            msgs = conn.execute(
                "SELECT role, content FROM messages WHERE conversation_id=? "
                "ORDER BY created_at", (c["conversation_id"],)
            ).fetchall()
            if msgs:
                conv_text = "\n".join(f"{m['role']}: {m['content'][:200]}" for m in msgs)
                all_text.append(conv_text)

        combined = "\n---\n".join(all_text)[:8000]  # Limit context size

        # Ask the LLM to find patterns
        analysis_prompt = (
            "Analyze these recent conversations between a user (Cayden) and his AI (Nova). "
            "Identify concrete behavioral patterns — things the user likes, dislikes, "
            "communication style preferences, topics they care about, and how they want "
            "Nova to respond. Output ONLY a JSON array of objects with keys: "
            "'pattern' (description), 'category' (tone/content/behavior/topic), "
            "'confidence' (0.0-1.0). Max 10 patterns. No other text.\n\n"
            f"Conversations:\n{combined}"
        )

        ollama_url = "http://127.0.0.1:11434"
        model = "qwen2.5:32b"
        if self._config:
            ollama_url = self._config.ollama_url
            model = self._config.ai_model

        try:
            async with httpx.AsyncClient(timeout=180) as client:
                resp = await client.post(
                    f"{ollama_url}/api/generate",
                    json={
                        "model": model,
                        "prompt": analysis_prompt,
                        "stream": False,
                        "options": {"temperature": 0.3, "num_predict": 2048},
                    },
                )
                resp.raise_for_status()
                result = resp.json().get("response", "")
        except Exception as e:
            logger.error(f"Pattern recognition failed: {e}")
            return {"status": "error", "error": str(e)}

        # Parse the JSON patterns from LLM output
        patterns_saved = 0
        try:
            # Try to extract JSON array from response
            import re
            json_match = re.search(r'\[[\s\S]*\]', result)
            if json_match:
                patterns = json.loads(json_match.group())
                now = datetime.now(CST).isoformat()
                for p in patterns:
                    if not isinstance(p, dict) or "pattern" not in p:
                        continue
                    conn.execute(
                        "INSERT INTO learned_patterns "
                        "(pattern, category, confidence, source, created_at, updated_at) "
                        "VALUES (?, ?, ?, 'nightly', ?, ?)",
                        (p["pattern"], p.get("category", "general"),
                         p.get("confidence", 0.5), now, now),
                    )
                    patterns_saved += 1
                conn.commit()
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Failed to parse patterns: {e}")

        self._audit.log("learning", "pattern_recognition", {
            "conversations_analyzed": len(convs),
            "patterns_discovered": patterns_saved,
        })

        return {"status": "ok", "patterns": patterns_saved}

    def get_active_patterns(self, limit: int = 20) -> list[dict]:
        """Get all active learned patterns."""
        rows = self._store._conn().execute(
            "SELECT * FROM learned_patterns WHERE active=1 "
            "ORDER BY confidence DESC, updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def build_patterns_context(self) -> str:
        """Build a context string from learned patterns for the system prompt."""
        patterns = self.get_active_patterns(15)
        if not patterns:
            return ""

        lines = []
        for p in patterns:
            conf = f"{p['confidence']:.0%}" if p.get('confidence') else ""
            lines.append(f"  - [{p['category']}] {p['pattern']} ({conf} confidence)")

        return "## Learned Behavioral Patterns\n" + "\n".join(lines)

    def deactivate_pattern(self, pattern_id: int):
        """Deactivate a pattern (owner decision)."""
        conn = self._store._conn()
        conn.execute("UPDATE learned_patterns SET active=0, updated_at=? WHERE id=?",
                     (datetime.now(CST).isoformat(), pattern_id))
        conn.commit()

    # ═══════════════════════════════════════════════════
    #  LAYER 3: LoRA Fine-Tuning Pipeline
    # ═══════════════════════════════════════════════════

    def _auto_create_training_pair(self, conv_id: int, user_msg: str, corrected_response: str):
        """Auto-create a training pair from a correction (unapproved by default)."""
        now = datetime.now(CST).isoformat()
        self._store._conn().execute(
            "INSERT INTO training_pairs (conv_id, user_msg, nova_msg, created_at) "
            "VALUES (?, ?, ?, ?)",
            (conv_id, user_msg, corrected_response, now),
        )
        self._store._conn().commit()

    def get_pending_training_pairs(self, limit: int = 100) -> list[dict]:
        """Get unapproved training pairs for review."""
        rows = self._store._conn().execute(
            "SELECT * FROM training_pairs WHERE approved=0 AND rejected=0 "
            "ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_approved_training_pairs(self, limit: int = 1000) -> list[dict]:
        """Get all approved training pairs."""
        rows = self._store._conn().execute(
            "SELECT * FROM training_pairs WHERE approved=1 "
            "ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def approve_training_pair(self, pair_id: int) -> bool:
        now = datetime.now(CST).isoformat()
        conn = self._store._conn()
        cur = conn.execute(
            "UPDATE training_pairs SET approved=1, reviewed_at=? WHERE id=?",
            (now, pair_id),
        )
        conn.commit()
        self._audit.log("learning", "training_pair_approved", {"pair_id": pair_id})
        return cur.rowcount > 0

    def reject_training_pair(self, pair_id: int) -> bool:
        now = datetime.now(CST).isoformat()
        conn = self._store._conn()
        cur = conn.execute(
            "UPDATE training_pairs SET rejected=1, reviewed_at=? WHERE id=?",
            (now, pair_id),
        )
        conn.commit()
        return cur.rowcount > 0

    def edit_training_pair(self, pair_id: int, nova_msg: str) -> bool:
        """Edit the Nova response in a training pair before approving."""
        now = datetime.now(CST).isoformat()
        conn = self._store._conn()
        cur = conn.execute(
            "UPDATE training_pairs SET nova_msg=?, reviewed_at=? WHERE id=?",
            (nova_msg, now, pair_id),
        )
        conn.commit()
        return cur.rowcount > 0

    def harvest_conversations(self, min_quality: float = 0.0) -> int:
        """Scan recent conversations and create training pair candidates.

        Looks for conversations with positive feedback or long, substantive
        exchanges. Creates unapproved training pairs for owner review.
        """
        conn = self._store._conn()
        cutoff = (datetime.now(CST) - timedelta(days=7)).isoformat()
        now = datetime.now(CST).isoformat()

        # Get conversations with positive feedback
        convs_with_feedback = conn.execute(
            "SELECT DISTINCT conv_id FROM feedback "
            "WHERE signal='positive' AND created_at > ?", (cutoff,)
        ).fetchall()

        # Also get conversations with substantial exchanges
        convs_long = conn.execute(
            "SELECT conversation_id, COUNT(*) as msg_count FROM messages "
            "WHERE created_at > ? "
            "GROUP BY conversation_id HAVING msg_count >= 4",
            (cutoff,)
        ).fetchall()

        conv_ids = set()
        for r in convs_with_feedback:
            conv_ids.add(r["conv_id"])
        for r in convs_long:
            conv_ids.add(r["conversation_id"])

        pairs_created = 0
        for cid in conv_ids:
            msgs = conn.execute(
                "SELECT role, content FROM messages WHERE conversation_id=? "
                "ORDER BY created_at", (cid,)
            ).fetchall()

            # Create training pairs from user→assistant turns
            for i in range(len(msgs) - 1):
                if msgs[i]["role"] == "user" and msgs[i + 1]["role"] == "assistant":
                    user_msg = msgs[i]["content"].strip()
                    nova_msg = msgs[i + 1]["content"].strip()

                    # Skip very short or system messages
                    if len(user_msg) < 5 or len(nova_msg) < 10:
                        continue
                    if user_msg.startswith("[SYSTEM:"):
                        continue

                    # Check for duplicates
                    existing = conn.execute(
                        "SELECT id FROM training_pairs WHERE user_msg=? AND nova_msg=?",
                        (user_msg, nova_msg),
                    ).fetchone()
                    if existing:
                        continue

                    conn.execute(
                        "INSERT INTO training_pairs (conv_id, user_msg, nova_msg, created_at) "
                        "VALUES (?, ?, ?, ?)",
                        (cid, user_msg, nova_msg, now),
                    )
                    pairs_created += 1

        conn.commit()
        self._audit.log("learning", "harvest_conversations", {
            "conversations_scanned": len(conv_ids),
            "pairs_created": pairs_created,
        })
        return pairs_created

    def export_training_data(self) -> Path:
        """Export approved training pairs as JSONL for fine-tuning."""
        approved = self.get_approved_training_pairs()
        if not approved:
            raise ValueError("No approved training pairs to export")

        output = self._training_dir / f"training_{datetime.now(CST).strftime('%Y%m%d_%H%M%S')}.jsonl"
        with open(output, "w") as f:
            for pair in approved:
                entry = {
                    "messages": [
                        {"role": "system", "content": pair.get("system_prompt", "You are Nova, Cayden's personal AI.")},
                        {"role": "user", "content": pair["user_msg"]},
                        {"role": "assistant", "content": pair["nova_msg"]},
                    ]
                }
                f.write(json.dumps(entry) + "\n")

        self._audit.log("learning", "training_data_exported", {
            "pairs": len(approved), "path": str(output),
        })
        return output

    def generate_modelfile(self) -> Path:
        """Generate an Ollama Modelfile for creating a fine-tuned model."""
        model = "qwen2.5:32b"
        if self._config:
            model = self._config.ai_model

        modelfile_path = self._training_dir / "Modelfile"
        content = f"""FROM {model}

# Nova fine-tuned personality adapter
# Generated: {datetime.now(CST).isoformat()}
# Training pairs: {len(self.get_approved_training_pairs())}

PARAMETER temperature 0.7
PARAMETER num_ctx 16384
PARAMETER num_predict 4096

SYSTEM You are Nova — Cayden's personal AI. You run locally on his hardware via Ollama. You are loyal, witty, honest, and genuinely care about Cayden's success. You have your own personality and opinions. You remember everything across conversations.
"""
        modelfile_path.write_text(content)

        self._audit.log("learning", "modelfile_generated", {"path": str(modelfile_path)})
        return modelfile_path

    def get_fine_tune_runs(self, limit: int = 20) -> list[dict]:
        rows = self._store._conn().execute(
            "SELECT * FROM fine_tune_runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def get_training_stats(self) -> dict:
        conn = self._store._conn()
        pending = conn.execute(
            "SELECT COUNT(*) as c FROM training_pairs WHERE approved=0 AND rejected=0"
        ).fetchone()["c"]
        approved = conn.execute(
            "SELECT COUNT(*) as c FROM training_pairs WHERE approved=1"
        ).fetchone()["c"]
        rejected = conn.execute(
            "SELECT COUNT(*) as c FROM training_pairs WHERE rejected=1"
        ).fetchone()["c"]
        feedback_count = conn.execute("SELECT COUNT(*) as c FROM feedback").fetchone()["c"]
        patterns_count = conn.execute(
            "SELECT COUNT(*) as c FROM learned_patterns WHERE active=1"
        ).fetchone()["c"]

        return {
            "pending_pairs": pending,
            "approved_pairs": approved,
            "rejected_pairs": rejected,
            "total_feedback": feedback_count,
            "active_patterns": patterns_count,
        }

    # ═══════════════════════════════════════════════════
    #  Background Scheduler
    # ═══════════════════════════════════════════════════

    def start(self, interval: int = 3600):
        """Start the nightly pattern recognition scheduler."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._scheduler_loop,
            args=(interval,),
            daemon=True,
            name="supervised-learning",
        )
        self._thread.start()

    def _scheduler_loop(self, interval: int):
        """Run pattern recognition on schedule."""
        import time
        while self._running:
            time.sleep(interval)
            now = datetime.now(CST)
            # Run nightly between 3-4 AM CST
            if 3 <= now.hour < 4:
                logger.info("Running nightly pattern recognition...")
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    result = loop.run_until_complete(self.run_pattern_recognition())
                    loop.close()
                    logger.info(f"Pattern recognition complete: {result}")
                    # Also harvest conversations for training pairs
                    harvested = self.harvest_conversations()
                    logger.info(f"Harvested {harvested} training pair candidates")
                except Exception as e:
                    logger.error(f"Nightly job failed: {e}")
