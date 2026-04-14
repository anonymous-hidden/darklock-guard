"""
Home AI Assistant - Remote Log Backup
======================================
Sends log entries to a remote backup server.
Runs as a background thread consuming from the logger's backup queue.

SECURITY:
- The AI has ZERO access or awareness of this system
- Uses HTTPS with API key or SSH for transport
- Retries on failure with backoff
- Operates independently of the AI layer
"""

import json
import os
import queue
import threading
import time
from typing import Optional

import httpx

from logger import HomeAILogger


class RemoteLogBackup:
    """Background service that ships logs to a remote backup server."""

    def __init__(self, config: dict, logger: HomeAILogger):
        self._config = config.get("backup", {})
        self._logger = logger
        self._enabled = self._config.get("enabled", False)

        self._method = self._config.get("method", "https")
        self._remote_url = self._config.get("remote_url", "")
        self._backup_key = os.environ.get("HOME_AI_BACKUP_KEY", "")
        self._send_interval = self._config.get("send_interval_seconds", 60)
        self._retry_count = self._config.get("retry_count", 3)
        self._batch_size = 100  # Max entries per batch

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        self._logger.info("backup", "Remote log backup initialized", {
            "enabled": self._enabled,
            "method": self._method,
        })

    def start(self):
        """Start the background backup thread."""
        if not self._enabled:
            self._logger.info("backup", "Remote backup is disabled")
            return

        if self._method == "https" and not self._remote_url:
            self._logger.warning("backup",
                                 "No remote_url configured — backup disabled")
            return

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="log-backup",
            daemon=True,
        )
        self._thread.start()
        self._logger.info("backup", "Backup thread started")

    def stop(self):
        """Stop the background backup thread."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
        self._logger.info("backup", "Backup thread stopped")

    def _run_loop(self):
        """Main loop: drain the backup queue and send batches."""
        while not self._stop_event.is_set():
            try:
                entries = self._drain_queue()
                if entries:
                    self._send_batch(entries)
            except Exception as e:
                # Never crash the backup thread — log and continue
                self._logger.error("backup", f"Backup loop error: {e}")

            self._stop_event.wait(timeout=self._send_interval)

    def _drain_queue(self) -> list[dict]:
        """Drain up to batch_size entries from the logger's backup queue."""
        entries = []
        backup_queue = self._logger.backup_queue
        for _ in range(self._batch_size):
            try:
                entry = backup_queue.get_nowait()
                entries.append(entry)
            except queue.Empty:
                break
        return entries

    def _send_batch(self, entries: list[dict]):
        """Send a batch of log entries to the remote server."""
        if self._method == "https":
            self._send_https(entries)
        else:
            self._logger.warning("backup",
                                 f"Unsupported backup method: {self._method}")

    def _send_https(self, entries: list[dict]):
        """Send log entries via HTTPS POST."""
        payload = {
            "entries": entries,
            "count": len(entries),
        }

        headers = {
            "Content-Type": "application/json",
        }
        if self._backup_key:
            headers["Authorization"] = f"Bearer {self._backup_key}"

        for attempt in range(1, self._retry_count + 1):
            try:
                with httpx.Client(timeout=30) as client:
                    resp = client.post(
                        self._remote_url,
                        json=payload,
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        self._logger.info("backup",
                                          f"Shipped {len(entries)} log entries")
                        return
                    else:
                        self._logger.warning("backup",
                                             f"Backup server returned {resp.status_code} "
                                             f"(attempt {attempt}/{self._retry_count})")
            except httpx.HTTPError as e:
                self._logger.warning("backup",
                                     f"HTTP error (attempt {attempt}): {e}")
            except Exception as e:
                self._logger.error("backup",
                                   f"Unexpected error (attempt {attempt}): {e}")

            # Backoff before retry
            if attempt < self._retry_count:
                time.sleep(2 ** attempt)

        self._logger.error("backup",
                           f"Failed to ship {len(entries)} entries after "
                           f"{self._retry_count} attempts")
