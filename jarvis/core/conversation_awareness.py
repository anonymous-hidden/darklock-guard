"""
Nova — Conversation Awareness
================================
Tracks what's happening inside the CURRENT conversation so Nova stays
contextually grounded across multiple turns.

Tracks:
- Active topics / intent stack
- Named entities mentioned (projects, people, files, URLs, error messages)
- Questions Nova asked that have NOT been answered yet
- Current conversation mode (chat / task / debug / planning)
- Unresolved references ("that file", "the error", "my project")
- Confidence that the topic is still ongoing
"""

import re
import threading
from collections import deque
from datetime import datetime
from typing import Optional


# ── Entity extraction (fast regex, no NLP deps) ──────────────────────────────

_FILE_PAT = re.compile(
    r'(?:^|\s)([\w./~-][\w./~-]{0,60}\.(?:py|js|ts|jsx|tsx|json|yaml|yml|md|sh|env|toml|lock))\b',
    re.IGNORECASE,
)
_URL_PAT = re.compile(r'https?://\S+', re.IGNORECASE)
_ERROR_PAT = re.compile(
    r'\b(?:error|exception|traceback|TypeError|ValueError|AttributeError|'
    r'SyntaxError|ImportError|ModuleNotFound|404|500|ENOENT)\b', re.IGNORECASE
)
_PROJECT_PAT = re.compile(
    r'\b(?:darklock|nova|jarvis|discord\s*bot|pi5|raspberry|calendar.app|'
    r'desktop|frontend|backend|api|database|db)\b', re.IGNORECASE
)
_QUESTION_PAT = re.compile(r'\?$')

# Mode detection heuristics
_MODE_DEBUG    = re.compile(r'\b(?:error|bug|broken|crash|traceback|fix|debug|not working|failing)\b', re.I)
_MODE_PLAN     = re.compile(r'\b(?:plan|design|architect|should i|what if|how would|approach|strategy)\b', re.I)
_MODE_TASK     = re.compile(r'\b(?:create|build|write|make|add|implement|update|change|install|run|start)\b', re.I)
_MODE_REVIEW   = re.compile(r'\b(?:review|check|look at|read|analyse|analyze|explain|summarize|what does)\b', re.I)


def _extract_entities(text: str) -> dict[str, list[str]]:
    """Extract named entities from a message."""
    return {
        "files": list(dict.fromkeys(_FILE_PAT.findall(text))),
        "urls": list(dict.fromkeys(_URL_PAT.findall(text))),
        "errors": list(dict.fromkeys(_ERROR_PAT.findall(text))),
        "projects": list(dict.fromkeys(_PROJECT_PAT.findall(text))),
    }


def _detect_mode(text: str) -> str:
    """Infer conversational mode from message content."""
    if _MODE_DEBUG.search(text):
        return "debug"
    if _MODE_PLAN.search(text):
        return "planning"
    if _MODE_TASK.search(text):
        return "task"
    if _MODE_REVIEW.search(text):
        return "review"
    return "chat"


class ConversationAwareness:
    """
    Per-conversation state tracker. One instance is shared across all
    conversations — each conversation gets its own scope via conversation_id.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Map: conv_id → ConvState dict
        self._states: dict[int, dict] = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def on_user_message(self, conv_id: int, text: str):
        """Process an incoming user message to update awareness state."""
        with self._lock:
            state = self._get_or_create(conv_id)
            entities = _extract_entities(text)
            mode = _detect_mode(text)

            # Merge entities into conversation-level sets
            for k, vals in entities.items():
                state["entities"][k] = list(dict.fromkeys(
                    state["entities"].get(k, []) + vals
                ))[-10:]  # cap at 10 per type

            # Update mode (most recent wins, but we record history)
            if mode != "chat":
                state["mode"] = mode

            # Detect unresolved references — "that", "the file", "it", etc.
            unresolved = _find_unresolved_refs(text)
            state["unresolved_refs"] = unresolved

            # Rolling topic window (keep last 5 non-trivial words as topic)
            topic = _extract_topic(text)
            if topic:
                state["topic_stack"].append(topic)

            # Mark any pending Nova questions as answered
            if state["pending_questions"]:
                state["pending_questions"].clear()

            state["user_turn_count"] += 1
            state["last_active"] = datetime.now().isoformat()
            state["message_window"].append({"role": "user", "text": text[:300]})

    def on_nova_message(self, conv_id: int, text: str):
        """Process Nova's outgoing response to track questions she asked."""
        with self._lock:
            state = self._get_or_create(conv_id)

            # Detect questions Nova is asking (lines ending with ?)
            questions = [
                line.strip() for line in text.split('\n')
                if _QUESTION_PAT.search(line.strip()) and len(line.strip()) > 10
            ]
            if questions:
                # Only keep the last question (if Nova asked multiple, track the last)
                state["pending_questions"] = questions[-1:]

            state["nova_turn_count"] += 1
            state["message_window"].append({"role": "assistant", "text": text[:300]})

    def on_new_conversation(self, conv_id: int):
        """Reset state for a fresh conversation."""
        with self._lock:
            self._states[conv_id] = self._blank_state()

    def get_context_for_prompt(self, conv_id: Optional[int]) -> str:
        """Return a compact context string for injection into the system prompt."""
        if conv_id is None:
            return ""
        with self._lock:
            state = self._states.get(conv_id)
        if not state:
            return ""

        parts = ["## Conversation Awareness"]

        # Mode
        mode = state["mode"]
        if mode != "chat":
            parts.append(f"Current mode: **{mode}**")

        # Active topic
        if state["topic_stack"]:
            recent_topic = state["topic_stack"][-1]
            parts.append(f"Current topic: {recent_topic}")

        # Active entities — everything mentioned so far
        ent_lines = []
        for k, vals in state["entities"].items():
            if vals:
                ent_lines.append(f"  {k}: {', '.join(vals[:5])}")
        if ent_lines:
            parts.append("Entities in this conversation:\n" + "\n".join(ent_lines))

        # Unresolved references (helps Nova understand "that file", "the error")
        if state["unresolved_refs"]:
            parts.append(
                f"User may be referring to: {', '.join(state['unresolved_refs'])}"
            )

        # Pending questions Nova asked
        if state["pending_questions"]:
            parts.append(
                f"Nova asked (awaiting answer): {state['pending_questions'][0]}"
            )

        # Turn count (helps calibrate verbosity)
        turns = state["user_turn_count"]
        if turns > 1:
            parts.append(f"Turn {turns} of this conversation.")

        return "\n".join(parts) if len(parts) > 1 else ""

    def get_state(self, conv_id: int) -> dict:
        """Return a copy of the raw state for diagnostics."""
        with self._lock:
            return dict(self._states.get(conv_id, {}))

    def clear_old_conversations(self, keep_last: int = 20):
        """Prune oldest conversation states to avoid memory growth."""
        with self._lock:
            if len(self._states) > keep_last:
                oldest = sorted(
                    self._states.keys(),
                    key=lambda cid: self._states[cid]["last_active"]
                )[: len(self._states) - keep_last]
                for cid in oldest:
                    del self._states[cid]

    # ── Internal ──────────────────────────────────────────────────────────────

    def _get_or_create(self, conv_id: int) -> dict:
        if conv_id not in self._states:
            self._states[conv_id] = self._blank_state()
        return self._states[conv_id]

    @staticmethod
    def _blank_state() -> dict:
        return {
            "mode": "chat",
            "topic_stack": deque(maxlen=5),
            "entities": {},
            "unresolved_refs": [],
            "pending_questions": [],
            "user_turn_count": 0,
            "nova_turn_count": 0,
            "last_active": datetime.now().isoformat(),
            "message_window": deque(maxlen=10),
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

_STOP_WORDS = {
    "the", "a", "an", "is", "it", "to", "in", "on", "at", "of", "for",
    "and", "or", "but", "that", "this", "with", "can", "you", "i", "me",
    "my", "we", "be", "do", "does", "did", "has", "have", "was", "are",
    "what", "how", "why", "when", "where", "which", "get", "got", "just",
    "like", "make", "will", "not", "if", "so", "then", "its", "he", "she",
}

_REF_WORDS = re.compile(
    r'\b(?:that|those|this|these|it|them|the file|the error|the code|'
    r'the project|the issue|the bug|the function|the class|the module|'
    r'the script|the server|the api|the frontend|the backend)\b', re.I
)


def _extract_topic(text: str) -> str:
    """Extract a 2-5 word topic from the message."""
    # Remove question marks, punctuation
    clean = re.sub(r'[?!.,;:"\']', '', text.lower())
    words = [w for w in clean.split() if w not in _STOP_WORDS and len(w) > 2]
    return " ".join(words[:4]) if words else ""


def _find_unresolved_refs(text: str) -> list[str]:
    """Detect pronouns/references that point to something mentioned earlier."""
    matches = _REF_WORDS.findall(text)
    return list(dict.fromkeys(matches))[:5]
