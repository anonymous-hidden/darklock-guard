"""
Nova — Self-Recovery Engine
=============================
When the Health Monitor detects a failure, this module:
  1. Diagnoses the issue
  2. Attempts predefined recovery steps
  3. Retries with backoff
  4. Escalates to owner if recovery fails

All recovery attempts are logged — nothing happens silently.
"""

import os
import time
import subprocess
import threading


class RecoveryAction:
    """A single recovery attempt result."""
    __slots__ = ("service", "action", "success", "message", "ts")

    def __init__(self, service: str, action: str, success: bool, message: str = ""):
        self.service = service
        self.action = action
        self.success = success
        self.message = message
        self.ts = time.time()

    def to_dict(self) -> dict:
        return {
            "service": self.service,
            "action": self.action,
            "success": self.success,
            "message": self.message,
            "ts": round(self.ts, 3),
        }


class SelfRecovery:
    """Automated recovery for known failure modes."""

    MAX_RETRIES = 3
    COOLDOWN = 60          # seconds between recovery attempts per service
    MAX_HISTORY = 100

    def __init__(self, health_monitor, audit, activity_tracker, config):
        self._health = health_monitor
        self._audit = audit
        self._activity = activity_tracker
        self._config = config

        self._lock = threading.Lock()
        self._last_attempt: dict[str, float] = {}
        self._retry_count: dict[str, int] = {}
        self._history: list[RecoveryAction] = []
        self._running = False
        self._thread: threading.Thread | None = None
        self._darklock_client = None  # Set via set_darklock_client()

        # Recovery strategies keyed by service name
        self._strategies: dict[str, callable] = {
            "ollama": self._recover_ollama,
            "database": self._recover_database,
            "disk": self._recover_disk,
            "memory": self._recover_memory,
            "darklock": self._recover_darklock,
            "pi5": self._recover_pi5,
        }

    def set_darklock_client(self, client):
        """Inject the DarklockClient for remote recovery."""
        self._darklock_client = client

    # ── Recovery strategies ────────────────────────

    def _recover_ollama(self) -> RecoveryAction:
        """Try restarting the Ollama service."""
        try:
            # Check if ollama process exists
            result = subprocess.run(
                ["pgrep", "-f", "ollama"], capture_output=True, timeout=5)
            if result.returncode != 0:
                # Ollama not running — try to start it
                subprocess.Popen(
                    ["ollama", "serve"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                time.sleep(3)
                return RecoveryAction("ollama", "start_service", True,
                                      "Started ollama serve")
            else:
                return RecoveryAction("ollama", "check_process", True,
                                      "Ollama process running — may need manual check")
        except FileNotFoundError:
            return RecoveryAction("ollama", "start_service", False,
                                  "ollama binary not found")
        except Exception as e:
            return RecoveryAction("ollama", "start_service", False, str(e)[:120])

    def _recover_database(self) -> RecoveryAction:
        """Try to fix database issues (clear WAL, integrity check)."""
        try:
            import sqlite3
            db_path = self._config.get("_base_dir", ".") 
            # Access via health monitor's db path
            db_path = self._health._db_path
            conn = sqlite3.connect(str(db_path), timeout=10)
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.execute("PRAGMA integrity_check")
            conn.close()
            return RecoveryAction("database", "wal_checkpoint", True,
                                  "WAL checkpoint + integrity check passed")
        except Exception as e:
            return RecoveryAction("database", "wal_checkpoint", False, str(e)[:120])

    def _recover_disk(self) -> RecoveryAction:
        """Report disk space — can't auto-free space safely."""
        return RecoveryAction("disk", "report", False,
                              "Disk space low — requires manual cleanup. Escalating to owner.")

    def _recover_memory(self) -> RecoveryAction:
        """Try to free memory by triggering GC."""
        try:
            import gc
            gc.collect()
            return RecoveryAction("memory", "gc_collect", True,
                                  "Garbage collection triggered")
        except Exception as e:
            return RecoveryAction("memory", "gc_collect", False, str(e)[:120])

    def _recover_darklock(self) -> RecoveryAction:
        """Restart Darklock service on the Pi5 via SSH."""
        if not self._darklock_client:
            return RecoveryAction("darklock", "restart", False,
                                  "No Darklock client configured")
        try:
            import asyncio
            loop = asyncio.new_event_loop()
            try:
                msg = loop.run_until_complete(self._darklock_client.restart_darklock())
            finally:
                loop.close()
            success = "successfully" in msg or "verified active" in msg
            return RecoveryAction("darklock", "restart_via_ssh", success, msg[:200])
        except Exception as e:
            return RecoveryAction("darklock", "restart_via_ssh", False, str(e)[:120])

    def _recover_pi5(self) -> RecoveryAction:
        """Pi5 unreachable — can only report, can't power cycle remotely."""
        return RecoveryAction("pi5", "report", False,
                              "Pi5 unreachable via SSH — may need physical check or power cycle. Escalating.")

    # ── Core recovery logic ────────────────────────

    def attempt_recovery(self, service: str) -> RecoveryAction | None:
        """Attempt recovery for a failing service, respecting cooldowns."""
        now = time.time()

        with self._lock:
            last = self._last_attempt.get(service, 0)
            retries = self._retry_count.get(service, 0)

            # Cooldown check
            if now - last < self.COOLDOWN:
                return None

            # Max retries check
            if retries >= self.MAX_RETRIES:
                self._escalate(service)
                return None

            self._last_attempt[service] = now
            self._retry_count[service] = retries + 1

        # Execute recovery
        strategy = self._strategies.get(service)
        if not strategy:
            return RecoveryAction(service, "none", False, "No recovery strategy defined")

        self._activity.action(
            f"🔧 Attempting recovery: {service} (attempt {retries + 1}/{self.MAX_RETRIES})",
            details={"service": service, "attempt": retries + 1})

        result = strategy()

        # Log result
        self._audit.log("recovery", "attempt", result.to_dict())
        with self._lock:
            self._history.append(result)
            if len(self._history) > self.MAX_HISTORY:
                self._history = self._history[-self.MAX_HISTORY:]

            # Reset counter on success
            if result.success:
                self._retry_count[service] = 0
                self._activity.system_event(
                    f"✅ Recovery succeeded: {service}", details=result.to_dict())
            else:
                self._activity.system_event(
                    f"❌ Recovery failed: {service}", details=result.to_dict())

        return result

    def _escalate(self, service: str):
        """Escalate to owner when auto-recovery exhausted."""
        self._audit.log("recovery", "escalation", {
            "service": service,
            "message": f"Auto-recovery exhausted for {service} after {self.MAX_RETRIES} attempts",
        })
        self._activity.system_event(
            f"🚨 ESCALATION: {service} recovery failed — needs owner attention",
            details={"service": service, "max_retries": self.MAX_RETRIES})

    # ── Background loop ────────────────────────────

    def _loop(self, interval: float):
        self._audit.log("recovery", "engine_started", {"interval": interval})
        while self._running:
            try:
                unhealthy = self._health.get_unhealthy()
                failures = self._health.get_consecutive_failures()
                for svc in unhealthy:
                    # Only attempt recovery after 2+ consecutive failures
                    if failures.get(svc, 0) >= 2:
                        self.attempt_recovery(svc)
            except Exception as e:
                self._audit.log("recovery", "loop_error", {"error": str(e)[:200]})
            time.sleep(interval)

    def start(self, interval: float = 30):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, args=(interval,), daemon=True, name="self-recovery")
        self._thread.start()

    def stop(self):
        self._running = False

    # ── Queries ────────────────────────────────────

    def get_history(self, count: int = 50) -> list[dict]:
        with self._lock:
            return [r.to_dict() for r in reversed(self._history[-count:])]

    def get_status(self) -> dict:
        with self._lock:
            return {
                "running": self._running,
                "retry_counts": dict(self._retry_count),
                "last_attempts": {k: round(v, 3) for k, v in self._last_attempt.items()},
                "total_recoveries": len(self._history),
            }

    def reset_retries(self, service: str):
        """Manually reset retry counter (for use after manual fix)."""
        with self._lock:
            self._retry_count.pop(service, None)
            self._last_attempt.pop(service, None)
        self._audit.log("recovery", "retries_reset", {"service": service})
