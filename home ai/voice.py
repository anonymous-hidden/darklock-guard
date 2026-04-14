"""
Home AI Assistant - Voice Module
=================================
Handles speech-to-text (STT) and text-to-speech (TTS).
Uses Whisper for STT and pyttsx3 for local TTS.

Voice input is transcribed and fed into the same orchestrator
pipeline as text input — no special privileges for voice.
"""

import asyncio
import io
import queue
import threading
import wave
from typing import Callable, Optional

from logger import HomeAILogger


class VoiceModule:
    """Handles voice input (STT) and voice output (TTS)."""

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("voice", {})
        self._logger = logger
        self._enabled = self._config.get("enabled", False)

        self._stt_engine = self._config.get("stt_engine", "whisper")
        self._tts_engine = self._config.get("tts_engine", "pyttsx3")
        self._sample_rate = self._config.get("sample_rate", 16000)
        self._silence_timeout = self._config.get("silence_timeout", 3)

        self._whisper_model = None
        self._tts = None
        self._tts_lock = threading.Lock()

        if self._enabled:
            self._init_engines()

        self._logger.info("voice", "Voice module initialized", {
            "enabled": self._enabled,
            "stt": self._stt_engine,
            "tts": self._tts_engine,
        })

    def _init_engines(self):
        """Lazy-initialize STT and TTS engines."""
        try:
            import whisper
            self._whisper_model = whisper.load_model("base")
            self._logger.info("voice", "Whisper STT model loaded")
        except ImportError:
            self._logger.warning("voice",
                                 "whisper not installed — STT disabled")
        except Exception as e:
            self._logger.error("voice", f"Failed to load Whisper: {e}")

        try:
            import pyttsx3
            self._tts = pyttsx3.init()
            self._tts.setProperty("rate", 175)
            self._logger.info("voice", "pyttsx3 TTS engine initialized")
        except ImportError:
            self._logger.warning("voice",
                                 "pyttsx3 not installed — TTS disabled")
        except Exception as e:
            self._logger.error("voice", f"Failed to init pyttsx3: {e}")

    def transcribe(self, audio_data: bytes, sample_rate: int = 16000) -> str:
        """
        Transcribe audio bytes to text using Whisper.
        Returns the transcribed text.
        """
        if self._whisper_model is None:
            self._logger.warning("voice", "STT not available")
            return ""

        try:
            import numpy as np
            import tempfile
            import os

            # Write audio to temp WAV file for Whisper
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                tmp_path = f.name
                with wave.open(f, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(sample_rate)
                    wav.writeframes(audio_data)

            result = self._whisper_model.transcribe(tmp_path)
            text = result.get("text", "").strip()

            os.unlink(tmp_path)

            self._logger.info("voice", "Audio transcribed", {
                "text_length": len(text),
            })
            return text

        except Exception as e:
            self._logger.error("voice", f"Transcription failed: {e}")
            return ""

    def speak(self, text: str):
        """Speak text aloud using TTS (blocking call, thread-safe)."""
        if self._tts is None:
            self._logger.warning("voice", "TTS not available")
            return

        with self._tts_lock:
            try:
                self._tts.say(text)
                self._tts.runAndWait()
            except Exception as e:
                self._logger.error("voice", f"TTS failed: {e}")

    def speak_async(self, text: str):
        """Speak text in a background thread."""
        thread = threading.Thread(target=self.speak, args=(text,), daemon=True)
        thread.start()

    @property
    def stt_available(self) -> bool:
        return self._whisper_model is not None

    @property
    def tts_available(self) -> bool:
        return self._tts is not None
