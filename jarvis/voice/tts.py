"""
Nova — Text-to-Speech
==============================
Local TTS using Piper.  Low latency, fully offline.
Install system package:  sudo apt install piper  (or download from GitHub)
"""

import asyncio
import shutil
from pathlib import Path

from logs.audit import AuditLogger


class TextToSpeech:
    """Local text-to-speech powered by Piper."""

    def __init__(self, model: str = "en_US-lessac-medium", audit: AuditLogger | None = None):
        self._model = model
        self._audit = audit
        self._piper_path = shutil.which("piper")

    @property
    def available(self) -> bool:
        return self._piper_path is not None

    async def speak(self, text: str) -> bytes | None:
        """Convert text → raw PCM audio bytes.  Returns None if Piper missing."""
        if not self._piper_path:
            return None
        try:
            proc = await asyncio.create_subprocess_exec(
                self._piper_path,
                "--model", self._model,
                "--output-raw",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(input=text.encode()), timeout=30)
            if self._audit:
                self._audit.log("voice", "tts_generated", {
                    "text_length": len(text), "audio_bytes": len(stdout),
                })
            return stdout
        except Exception as e:
            if self._audit:
                self._audit.log("voice", "tts_error", {"error": str(e)})
            return None

    async def speak_to_file(self, text: str, output_path: Path) -> bool:
        audio = await self.speak(text)
        if audio:
            output_path.write_bytes(audio)
            return True
        return False
