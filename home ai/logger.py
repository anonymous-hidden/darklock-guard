"""
Home AI Assistant - Centralized Logging System
===============================================
CRITICAL SYSTEM: Logs everything — user input, AI responses,
parsed commands, execution results, and errors.

Logs are stored locally and queued for remote backup.
The AI has NO ability to modify, disable, or access this module.
"""

import json
import logging
import os
import queue
import threading
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Optional


class HomeAILogger:
    """Central logging hub for the entire Home AI system."""

    def __init__(self, config: dict):
        self._config = config.get("logging", {})
        self._log_dir = Path(self._config.get("local_path", "logs"))
        self._log_dir.mkdir(parents=True, exist_ok=True)

        # Queue for remote backup (consumed by backup module)
        self.backup_queue: queue.Queue = queue.Queue(maxsize=10000)

        # Track last log time for watchdog
        self._last_log_time = time.time()
        self._lock = threading.Lock()

        # Set up Python logging
        self._setup_python_logger()

        # Structured log file for machine-readable entries
        self._structured_log_path = self._log_dir / "structured.jsonl"

        self.info("logger", "Logging system initialized", {
            "log_dir": str(self._log_dir),
            "level": self._config.get("level", "INFO"),
        })

    def _setup_python_logger(self):
        """Configure rotating file + console logging."""
        self._logger = logging.getLogger("home_ai")
        self._logger.setLevel(
            getattr(logging, self._config.get("level", "INFO").upper(), logging.INFO)
        )
        self._logger.handlers.clear()

        # Rotating file handler
        max_bytes = self._config.get("max_file_size_mb", 50) * 1024 * 1024
        rotation_count = self._config.get("rotation_count", 10)
        file_handler = RotatingFileHandler(
            self._log_dir / "home_ai.log",
            maxBytes=max_bytes,
            backupCount=rotation_count,
        )
        file_handler.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        ))
        self._logger.addHandler(file_handler)

        # Console handler
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s"
        ))
        self._logger.addHandler(console_handler)

    @property
    def last_log_time(self) -> float:
        with self._lock:
            return self._last_log_time

    def _write_structured(self, entry: dict):
        """Append a structured JSON log entry to the JSONL file and backup queue."""
        with self._lock:
            self._last_log_time = time.time()

        line = json.dumps(entry, default=str) + "\n"
        try:
            with open(self._structured_log_path, "a") as f:
                f.write(line)
        except OSError as e:
            self._logger.error(f"Failed to write structured log: {e}")

        # Enqueue for remote backup (non-blocking)
        try:
            self.backup_queue.put_nowait(entry)
        except queue.Full:
            self._logger.warning("Backup queue full — dropping oldest entry")
            try:
                self.backup_queue.get_nowait()
                self.backup_queue.put_nowait(entry)
            except queue.Empty:
                pass

    def _log(self, level: str, category: str, message: str,
             data: Optional[dict] = None):
        """Core log method."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "category": category,
            "message": message,
            "data": data or {},
        }
        self._write_structured(entry)
        log_fn = getattr(self._logger, level.lower(), self._logger.info)
        log_fn(f"[{category}] {message}")

    # ── Public logging methods ──────────────────────────────

    def info(self, category: str, message: str, data: Optional[dict] = None):
        self._log("INFO", category, message, data)

    def warning(self, category: str, message: str, data: Optional[dict] = None):
        self._log("WARNING", category, message, data)

    def error(self, category: str, message: str, data: Optional[dict] = None):
        self._log("ERROR", category, message, data)

    def critical(self, category: str, message: str, data: Optional[dict] = None):
        self._log("CRITICAL", category, message, data)

    # ── Specialized logging methods ─────────────────────────

    def log_user_input(self, user_input: str, source: str = "text"):
        """Log user input (text or voice)."""
        if self._config.get("log_user_input", True):
            self.info("user_input", "User input received", {
                "input": user_input,
                "source": source,
            })

    def log_ai_response(self, response: str, model: str = ""):
        """Log the AI's raw response."""
        if self._config.get("log_ai_responses", True):
            self.info("ai_response", "AI response generated", {
                "response": response[:2000],  # Truncate very long responses
                "model": model,
            })

    def log_parsed_command(self, command: dict):
        """Log a parsed command from the AI output."""
        if self._config.get("log_commands", True):
            self.info("parsed_command", "Command parsed from AI output", {
                "command": command,
            })

    def log_execution_result(self, command_name: str, success: bool,
                             result: Any, duration_ms: float = 0):
        """Log the result of executing a command."""
        if self._config.get("log_execution_results", True):
            level = "INFO" if success else "ERROR"
            self._log(level, "execution_result", f"Command '{command_name}' executed", {
                "command": command_name,
                "success": success,
                "result": str(result)[:2000],
                "duration_ms": round(duration_ms, 2),
            })

    def log_permission_decision(self, command_name: str, risk: str,
                                approved: bool, method: str = "auto"):
        """Log permission approval/denial."""
        self.info("permission", f"Permission {'granted' if approved else 'denied'}", {
            "command": command_name,
            "risk_level": risk,
            "approved": approved,
            "method": method,
        })

    def log_security_event(self, event_type: str, details: dict):
        """Log security-relevant events (blocked commands, auth failures, etc.)."""
        self.warning("security", f"Security event: {event_type}", details)
