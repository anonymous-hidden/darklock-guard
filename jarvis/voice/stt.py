"""
Nova — Speech-to-Text
==============================
Local STT using faster-whisper.  Entirely offline.
Install:  pip install faster-whisper sounddevice numpy
"""

import asyncio
from logs.audit import AuditLogger


class SpeechToText:
    """Local speech-to-text powered by faster-whisper."""

    def __init__(self, model_size: str = "base.en", audit: AuditLogger | None = None):
        self._model_size = model_size
        self._audit = audit
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
                self._model = WhisperModel(self._model_size, device="cpu", compute_type="int8")
                if self._audit:
                    self._audit.log("voice", "stt_model_loaded", {"model": self._model_size})
            except ImportError:
                raise RuntimeError(
                    "faster-whisper not installed. Run: pip install faster-whisper sounddevice numpy"
                )

    def transcribe(self, audio_bytes: bytes, sample_rate: int = 16000) -> str:
        """Transcribe raw PCM int16 audio bytes → text."""
        self._ensure_model()
        import numpy as np
        audio = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = self._model.transcribe(audio, beam_size=5, language="en")
        text = " ".join(seg.text for seg in segments).strip()
        if self._audit:
            self._audit.log("voice", "transcribed", {"length": len(text)})
        return text

    async def transcribe_async(self, audio_bytes: bytes, sample_rate: int = 16000) -> str:
        return await asyncio.to_thread(self.transcribe, audio_bytes, sample_rate)

    def record_and_transcribe(self, duration: float = 5.0, sample_rate: int = 16000) -> str:
        """Record from microphone for `duration` seconds and transcribe."""
        try:
            import sounddevice as sd
            import numpy as np
        except ImportError:
            raise RuntimeError("sounddevice not installed. Run: pip install sounddevice numpy")

        audio = sd.rec(int(duration * sample_rate), samplerate=sample_rate,
                       channels=1, dtype="int16")
        sd.wait()
        return self.transcribe(audio.tobytes(), sample_rate)
