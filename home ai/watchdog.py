"""
Home AI Assistant - Watchdog System
====================================
Independent monitoring process that watches:
  - Logging activity (detects if logging stops)
  - System health (API responsiveness)
  - Anomalies (unexpected behavior)

If logging stops or anomalies are detected:
  - Alerts are generated
  - The execution layer can be disabled
  - Emergency shutdown can be triggered

SECURITY: The watchdog is completely independent of the AI.
"""

import os
import signal
import sys
import threading
import time
from typing import Optional

import httpx

from logger import HomeAILogger


class Watchdog:
    """
    Independent process monitor for the Home AI system.
    Runs as a background thread and can force-shutdown the system
    if critical invariants are violated.
    """

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("watchdog", {})
        self._logger = logger
        self._enabled = self._config.get("enabled", True)

        self._check_interval = self._config.get("check_interval_seconds", 30)
        self._max_log_gap = self._config.get("max_log_gap_seconds", 300)
        self._shutdown_on_anomaly = self._config.get("shutdown_on_anomaly", True)
        self._health_endpoints = self._config.get("health_check_endpoints", [])

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Track consecutive failures
        self._consecutive_log_failures = 0
        self._consecutive_health_failures = 0
        self._max_consecutive_failures = 3

        # Reference to the execution layer (can be disabled)
        self._executor = None
        self._ssh_module = None

        self._logger.info("watchdog", "Watchdog initialized", {
            "enabled": self._enabled,
            "check_interval": self._check_interval,
            "max_log_gap": self._max_log_gap,
        })

    def set_executor(self, executor):
        """Register the executor so the watchdog can disable it."""
        self._executor = executor

    def set_ssh_module(self, ssh_module):
        """Register the SSH module so the watchdog can disable it."""
        self._ssh_module = ssh_module

    def start(self):
        """Start the watchdog monitoring thread."""
        if not self._enabled:
            self._logger.info("watchdog", "Watchdog is disabled")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._monitor_loop,
            name="watchdog",
            daemon=True,
        )
        self._thread.start()
        self._logger.info("watchdog", "Watchdog started")

    def stop(self):
        """Stop the watchdog."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
        self._logger.info("watchdog", "Watchdog stopped")

    def _monitor_loop(self):
        """Main monitoring loop."""
        while not self._stop_event.is_set():
            try:
                self._check_logging()
                self._check_health_endpoints()
            except Exception as e:
                self._logger.error("watchdog", f"Monitor loop error: {e}")

            self._stop_event.wait(timeout=self._check_interval)

    def _check_logging(self):
        """Check that logging is still active."""
        last_log = self._logger.last_log_time
        gap = time.time() - last_log

        if gap > self._max_log_gap:
            self._consecutive_log_failures += 1
            self._logger.critical("watchdog",
                                  f"Logging gap detected: {gap:.0f}s "
                                  f"(max: {self._max_log_gap}s)", {
                                      "gap_seconds": gap,
                                      "consecutive_failures": self._consecutive_log_failures,
                                  })

            if (self._consecutive_log_failures >= self._max_consecutive_failures
                    and self._shutdown_on_anomaly):
                self._emergency_action("Logging stopped — disabling execution")
        else:
            self._consecutive_log_failures = 0

    def _check_health_endpoints(self):
        """Check that health endpoints respond."""
        for endpoint in self._health_endpoints:
            try:
                with httpx.Client(timeout=5) as client:
                    resp = client.get(endpoint)
                    if resp.status_code != 200:
                        self._consecutive_health_failures += 1
                        self._logger.warning("watchdog",
                                             f"Health check failed: {endpoint} "
                                             f"returned {resp.status_code}")
                    else:
                        self._consecutive_health_failures = 0
            except Exception as e:
                self._consecutive_health_failures += 1
                self._logger.warning("watchdog",
                                     f"Health check error for {endpoint}: {e}")

            if (self._consecutive_health_failures >= self._max_consecutive_failures
                    and self._shutdown_on_anomaly):
                self._emergency_action("Health checks failing — disabling execution")

    def _emergency_action(self, reason: str):
        """
        Emergency response: disable execution layers.
        Does NOT kill the process — just disables dangerous operations.
        """
        self._logger.critical("watchdog", f"EMERGENCY ACTION: {reason}")

        # Disable the executor by replacing its handlers with no-ops
        if self._executor is not None:
            self._executor._handlers.clear()
            self._logger.critical("watchdog", "Executor handlers cleared")

        # Disable SSH
        if self._ssh_module is not None:
            self._ssh_module._enabled = False
            self._logger.critical("watchdog", "SSH module disabled")

        self._logger.critical("watchdog",
                              "Execution layers disabled. "
                              "Manual intervention required to restore.")
