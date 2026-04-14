"""
JARVIS-Lite — Hotword Detection
=================================
Detects the wake word "Jarvis" from continuous STT sampling.
"""

from logs.audit import AuditLogger
from typing import Callable


class HotwordDetector:
    """Simple hotword detector — checks STT output for the wake word."""

    def __init__(self, hotword: str = "jarvis", audit: AuditLogger | None = None):
        self._hotword = hotword.lower()
        self._audit = audit
        self._running = False
        self._callback: Callable | None = None

    def on_detected(self, callback: Callable):
        """Register callback invoked when the hotword is heard."""
        self._callback = callback

    def check_text(self, text: str) -> bool:
        """Check if transcribed text contains the hotword."""
        if self._hotword in text.lower():
            if self._audit:
                self._audit.log("voice", "hotword_detected", {"text": text})
            if self._callback:
                self._callback()
            return True
        return False

    async def start(self):
        self._running = True
        if self._audit:
            self._audit.log("voice", "hotword_listening", {"hotword": self._hotword})

    def stop(self):
        self._running = False

    @property
    def is_listening(self) -> bool:
        return self._running
