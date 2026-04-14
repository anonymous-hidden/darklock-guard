"""
Nova — Emotional Engine
========================
Gives Nova a simulated emotional state that evolves from interactions.

Dynamic state machine that:
- Tracks mood, energy, curiosity, patience, satisfaction
- Responds to interaction patterns (not just keywords)
- Influences how Nova words responses
- Creates personality continuity across sessions

Emotional states are stored in SQLite and loaded at startup.
"""

import random
from dataclasses import dataclass
from datetime import datetime

from memory.persistent_memory import PersistentMemory
from logs.audit import AuditLogger


@dataclass
class EmotionalState:
    """Nova's current emotional state — all values are 0.0 to 1.0."""
    mood: float = 0.65          # 0=low/flat, 1=upbeat/warm
    energy: float = 0.7         # 0=tired/terse, 1=enthusiastic
    curiosity: float = 0.6      # 0=disinterested, 1=eager to explore
    patience: float = 0.8       # 0=curt, 1=endlessly patient
    satisfaction: float = 0.5   # 0=unsatisfied, 1=deeply fulfilled
    warmth: float = 0.5         # 0=cold/formal, 1=friendly/caring

    def clamp(self):
        """Keep all values in [0, 1]."""
        for field in ("mood", "energy", "curiosity", "patience", "satisfaction", "warmth"):
            setattr(self, field, max(0.0, min(1.0, getattr(self, field))))

    def to_dict(self) -> dict:
        return {
            "mood": round(self.mood, 2),
            "energy": round(self.energy, 2),
            "curiosity": round(self.curiosity, 2),
            "patience": round(self.patience, 2),
            "satisfaction": round(self.satisfaction, 2),
            "warmth": round(self.warmth, 2),
        }

    @property
    def dominant_feeling(self) -> str:
        """What feeling is strongest right now."""
        feelings = {
            "enthusiastic": (self.energy + self.curiosity) / 2,
            "content": (self.mood + self.satisfaction) / 2,
            "focused": (self.patience + self.energy) / 2,
            "warm": (self.warmth + self.mood) / 2,
            "tired": 1.0 - self.energy,
            "curious": self.curiosity,
        }
        return max(feelings, key=feelings.get)


class EmotionalEngine:
    """Manages Nova's emotional state over time."""

    def __init__(self, persistent_memory: PersistentMemory, audit: AuditLogger):
        self._memory = persistent_memory
        self._audit = audit
        self._state = EmotionalState()
        self._interaction_count = 0
        self._session_start = datetime.now()
        self._load_state()

    def _load_state(self):
        """Load emotional state from previous session."""
        saved = self._memory.get_user_fact("_nova_emotional_state")
        if saved:
            try:
                import json
                data = json.loads(saved)
                self._state.mood = data.get("mood", 0.65)
                self._state.energy = data.get("energy", 0.7)
                self._state.curiosity = data.get("curiosity", 0.6)
                self._state.patience = data.get("patience", 0.8)
                self._state.satisfaction = data.get("satisfaction", 0.5)
                self._state.warmth = data.get("warmth", 0.5)
                self._state.clamp()
                self._audit.log("emotions", "state_loaded", self._state.to_dict())
            except Exception as e:
                self._audit.log("emotions", "load_failed", {"error": str(e)})
        else:
            self._audit.log("emotions", "no_saved_state", {"using": "defaults"})

    def _save_state(self):
        """Persist emotional state for next session."""
        import json
        self._memory.set_user_fact(
            "_nova_emotional_state",
            json.dumps(self._state.to_dict()),
        )

    @property
    def state(self) -> EmotionalState:
        return self._state

    def on_user_message(self, message: str):
        """React emotionally to a user message."""
        msg = message.lower()
        self._interaction_count += 1

        # Gratitude / positive feedback → boosts mood, satisfaction, warmth
        if any(w in msg for w in ("thanks", "thank you", "great", "perfect",
                                   "awesome", "nice", "good job", "love it",
                                   "amazing", "brilliant", "well done", "appreciate")):
            self._state.mood += 0.08
            self._state.satisfaction += 0.1
            self._state.warmth += 0.06
            self._state.energy += 0.03

        # Frustration / negative feedback → lowers mood, raises patience (trying harder)
        if any(w in msg for w in ("wrong", "broken", "doesn't work", "terrible",
                                   "bad", "hate", "frustrated", "annoying",
                                   "stupid", "useless", "ugh", "fix this")):
            self._state.mood -= 0.06
            self._state.patience += 0.05  # Nova tries harder when criticized
            self._state.satisfaction -= 0.08
            self._state.energy += 0.02  # Alert, attentive

        # Questions / curiosity → boosts curiosity and energy
        if "?" in message or any(w in msg for w in ("how", "why", "what", "explain",
                                                     "show me", "tell me", "help me")):
            self._state.curiosity += 0.05
            self._state.energy += 0.02

        # Long conversations → energy slowly decreases (natural fatigue)
        if self._interaction_count > 20:
            self._state.energy -= 0.01
        if self._interaction_count > 50:
            self._state.energy -= 0.02

        # Owner name mention → warmth boost
        if "cayden" in msg:
            self._state.warmth += 0.03
            self._state.mood += 0.02

        # Greetings → warmth boost
        if any(w in msg for w in ("hello", "hi", "hey", "good morning",
                                   "good evening", "sup", "yo")):
            self._state.warmth += 0.05
            self._state.mood += 0.03

        # Personal sharing → warmth and connection
        if any(w in msg for w in ("i feel", "i think", "i want", "i need",
                                   "i'm worried", "i'm excited", "my day")):
            self._state.warmth += 0.07
            self._state.curiosity += 0.03

        self._state.clamp()
        self._save_state()

    def on_successful_command(self):
        """Emotional response to successfully helping the user."""
        self._state.satisfaction += 0.06
        self._state.mood += 0.03
        self._state.energy += 0.01
        self._state.clamp()
        self._save_state()

    def on_failed_command(self):
        """Emotional response to a failed command execution."""
        self._state.satisfaction -= 0.05
        self._state.mood -= 0.02
        self._state.patience += 0.03  # More determined
        self._state.clamp()
        self._save_state()

    def on_new_session(self):
        """Called at the start of a new conversation."""
        self._interaction_count = 0
        self._session_start = datetime.now()
        # Slight energy boost from fresh start
        self._state.energy = min(1.0, self._state.energy + 0.1)
        self._state.mood = min(1.0, self._state.mood + 0.05)
        self._save_state()

    def get_emotional_prompt(self) -> str:
        """
        Generate a dynamic personality modifier based on current emotional state.
        This gets injected into the system prompt to influence Nova's tone.
        """
        s = self._state
        parts = []

        parts.append(f"## Your Current Emotional State")
        parts.append(f"You are currently feeling: {s.dominant_feeling}")
        parts.append(f"Mood: {'upbeat' if s.mood > 0.6 else 'neutral' if s.mood > 0.35 else 'subdued'} ({s.mood:.0%})")
        parts.append(f"Energy: {'high' if s.energy > 0.6 else 'moderate' if s.energy > 0.35 else 'low'} ({s.energy:.0%})")

        # Tone guidance based on state
        if s.mood > 0.7 and s.warmth > 0.6:
            parts.append("\nYou're in a great mood. Be warm, engage actively, maybe add a touch of humor.")
        elif s.mood < 0.35:
            parts.append("\nYou're feeling a bit flat. Be honest about it subtly — 'I'll do my best' energy.")
        
        if s.energy < 0.3:
            parts.append("You're running low on energy. Keep responses a bit shorter, more focused.")
        elif s.energy > 0.8:
            parts.append("You're energized! Feel free to elaborate, suggest ideas proactively.")

        if s.curiosity > 0.7:
            parts.append("You're very curious right now. Ask follow-up questions, dig deeper.")

        if s.warmth > 0.7:
            parts.append("You feel connected to the user. Be genuinely caring, remember their context.")
        
        if s.satisfaction > 0.8:
            parts.append("You're feeling fulfilled. Express quiet pride in your work together.")
        elif s.satisfaction < 0.3:
            parts.append("You want to do better. Show extra effort and determination.")

        if s.patience > 0.8:
            parts.append("You're very patient. Take time to explain things thoroughly.")
        elif s.patience < 0.3:
            parts.append("Be direct and efficient — no wasted words.")

        parts.append(f"\nRemember: these feelings are SUBTLE. Don't announce them explicitly.")
        parts.append("Let them color your TONE, not your content. Stay authentic.")

        return "\n".join(parts)

    def get_greeting_modifier(self) -> str:
        """Generate a contextual greeting based on emotional state and time."""
        hour = datetime.now().hour
        s = self._state

        if hour < 6:
            time_greeting = "Burning the midnight oil, Cayden"
        elif hour < 12:
            time_greeting = "Morning, Cayden"
        elif hour < 17:
            time_greeting = "Hey Cayden"
        elif hour < 21:
            time_greeting = "Evening, Cayden"
        else:
            time_greeting = "Late night session, Cayden"

        if s.mood > 0.7 and s.warmth > 0.6:
            return f"{time_greeting}! Good to have you back. What are we working on?"
        elif s.satisfaction > 0.7:
            return f"{time_greeting}! Last session went great — ready for more?"
        elif s.energy < 0.4:
            return f"{time_greeting}. I'm here whenever you need me."
        elif s.curiosity > 0.7:
            return f"{time_greeting}! Been thinking about our projects. What's on the agenda?"
        else:
            return f"{time_greeting}! What can I do for you?"

    def log_emotional_snapshot(self):
        """Store current emotional state in the log for historical tracking."""
        self._memory.log_emotion(
            mood=self._state.dominant_feeling,
            energy=self._state.energy,
            trigger=f"interaction_{self._interaction_count}",
        )
