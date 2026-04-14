"""
Home AI — Log & Data Cleanup System
=====================================
Automatically cleans old logs, structured logs, backups, and
pycache across both Home AI and Discord Bot projects.

Runs on startup and then on a configurable interval (default: daily).
Retention periods are configurable in config.yaml under "log_cleanup".
"""

import gzip
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


class LogCleaner:
    """Scheduled log rotation and cleanup for all servers."""

    # Defaults (overridden by config.yaml)
    DEFAULT_CONFIG = {
        "enabled": True,
        "interval_hours": 24,           # Run cleanup every 24 hours
        "log_retention_days": 7,         # Delete .log files older than 7 days
        "structured_max_mb": 20,         # Trim structured.jsonl to 20 MB
        "backup_retention_days": 30,     # Delete backup JSON files older than 30 days
        "db_backup_retention_days": 60,  # Delete .db.gz backups older than 60 days
        "clean_pycache": True,           # Remove __pycache__ dirs on each run
        "compress_old_logs": True,       # gzip logs older than 3 days before deletion
    }

    def __init__(self, config: dict, logger):
        self._logger = logger
        raw = config.get("log_cleanup", {})
        self._config = {**self.DEFAULT_CONFIG, **raw}
        self._running = False
        self._thread: Optional[threading.Thread] = None

        # Project roots
        self._home_ai_root = Path(__file__).parent
        self._discord_bot_root = self._home_ai_root.parent

    # ── Public API ─────────────────────────────────────────

    def start(self):
        """Start the cleanup scheduler (runs immediately, then on interval)."""
        if not self._config["enabled"]:
            self._logger.info("log_cleaner", "Log cleaner disabled in config")
            return

        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="log-cleaner")
        self._thread.start()
        self._logger.info("log_cleaner", "Log cleaner started", {
            "interval_hours": self._config["interval_hours"],
            "log_retention_days": self._config["log_retention_days"],
        })

    def stop(self):
        """Stop the cleanup scheduler."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    def run_now(self) -> dict:
        """Run cleanup immediately and return stats."""
        return self._cleanup()

    # ── Scheduler Loop ─────────────────────────────────────

    def _loop(self):
        """Background loop — run cleanup, then sleep."""
        # Initial run at startup
        try:
            stats = self._cleanup()
            self._logger.info("log_cleaner", "Startup cleanup complete", stats)
        except Exception as e:
            self._logger.error("log_cleaner", f"Startup cleanup failed: {e}")

        interval = self._config["interval_hours"] * 3600
        while self._running:
            # Sleep in small increments so stop() is responsive
            slept = 0
            while slept < interval and self._running:
                time.sleep(min(60, interval - slept))
                slept += 60

            if not self._running:
                break

            try:
                stats = self._cleanup()
                self._logger.info("log_cleaner", "Scheduled cleanup complete", stats)
            except Exception as e:
                self._logger.error("log_cleaner", f"Scheduled cleanup failed: {e}")

    # ── Core Cleanup Logic ─────────────────────────────────

    def _cleanup(self) -> dict:
        """Run all cleanup tasks. Returns summary stats."""
        stats = {
            "logs_deleted": 0,
            "logs_compressed": 0,
            "structured_trimmed_mb": 0,
            "backups_deleted": 0,
            "pycache_cleared": 0,
            "bytes_freed": 0,
        }

        # 1. Clean Home AI logs
        self._clean_log_dir(
            self._home_ai_root / "logs",
            exclude={"home_ai.log"},  # Active log managed by RotatingFileHandler
            stats=stats,
        )

        # 2. Clean Discord Bot logs
        self._clean_log_dir(
            self._discord_bot_root / "logs",
            exclude=set(),  # All bot logs are fair game based on age
            stats=stats,
        )

        # 3. Trim structured.jsonl (keep only the tail)
        self._trim_structured_log(stats)

        # 4. Clean old backups
        self._clean_backups(stats)

        # 5. Clear pycache
        if self._config["clean_pycache"]:
            self._clean_pycache(stats)

        return stats

    # ── Log File Cleanup ───────────────────────────────────

    def _clean_log_dir(self, log_dir: Path, exclude: set, stats: dict):
        """Delete or compress log files older than retention period."""
        if not log_dir.is_dir():
            return

        retention_days = self._config["log_retention_days"]
        compress_threshold_days = max(1, retention_days - 3)
        now = time.time()

        for entry in log_dir.iterdir():
            if not entry.is_file():
                continue

            name = entry.name

            # Skip excluded (actively written) files
            if name in exclude:
                continue

            # Only handle .log, .log.N (rotated), and .gz files
            if not (name.endswith(".log") or ".log." in name or name.endswith(".gz")):
                # Handle .jsonl separately
                if name.endswith(".jsonl"):
                    continue
                continue

            age_days = (now - entry.stat().st_mtime) / 86400

            if age_days > retention_days:
                size = entry.stat().st_size
                entry.unlink()
                stats["logs_deleted"] += 1
                stats["bytes_freed"] += size
            elif (age_days > compress_threshold_days
                  and self._config["compress_old_logs"]
                  and not name.endswith(".gz")):
                self._gzip_file(entry)
                stats["logs_compressed"] += 1

    def _gzip_file(self, filepath: Path):
        """Compress a file with gzip and remove the original."""
        gz_path = filepath.with_suffix(filepath.suffix + ".gz")
        try:
            with open(filepath, "rb") as f_in, gzip.open(gz_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            filepath.unlink()
        except OSError as e:
            self._logger.warning("log_cleaner", f"Failed to compress {filepath.name}: {e}")

    # ── Structured Log Trimming ────────────────────────────

    def _trim_structured_log(self, stats: dict):
        """Trim structured.jsonl if it exceeds the size limit.

        Keeps the most recent entries (tail of the file).
        """
        jsonl_path = self._home_ai_root / "logs" / "structured.jsonl"
        if not jsonl_path.is_file():
            return

        max_bytes = self._config["structured_max_mb"] * 1024 * 1024
        current_size = jsonl_path.stat().st_size

        if current_size <= max_bytes:
            return

        # Keep the last max_bytes worth of data
        trim_amount = current_size - max_bytes
        try:
            with open(jsonl_path, "rb") as f:
                f.seek(trim_amount)
                # Find the next newline to avoid cutting a JSON line in half
                f.readline()
                remaining = f.read()

            with open(jsonl_path, "wb") as f:
                f.write(remaining)

            freed = current_size - len(remaining)
            stats["structured_trimmed_mb"] = round(freed / (1024 * 1024), 2)
            stats["bytes_freed"] += freed
        except OSError as e:
            self._logger.warning("log_cleaner", f"Failed to trim structured.jsonl: {e}")

    # ── Backup Cleanup ─────────────────────────────────────

    def _clean_backups(self, stats: dict):
        """Delete old backup files past retention."""
        backup_dir = self._discord_bot_root / "data" / "backups"
        if not backup_dir.is_dir():
            return

        now = time.time()
        json_retention = self._config["backup_retention_days"] * 86400
        db_retention = self._config["db_backup_retention_days"] * 86400

        for entry in backup_dir.iterdir():
            if not entry.is_file():
                continue

            age = now - entry.stat().st_mtime
            should_delete = False

            if entry.name.endswith(".json") and age > json_retention:
                should_delete = True
            elif entry.name.endswith(".db.gz") and age > db_retention:
                should_delete = True

            if should_delete:
                size = entry.stat().st_size
                entry.unlink()
                stats["backups_deleted"] += 1
                stats["bytes_freed"] += size

    # ── Pycache Cleanup ────────────────────────────────────

    def _clean_pycache(self, stats: dict):
        """Remove __pycache__ directories from both projects."""
        for root in (self._home_ai_root, self._discord_bot_root):
            if not root.is_dir():
                continue
            for pycache in root.rglob("__pycache__"):
                if pycache.is_dir():
                    size = sum(f.stat().st_size for f in pycache.rglob("*") if f.is_file())
                    shutil.rmtree(pycache, ignore_errors=True)
                    stats["pycache_cleared"] += 1
                    stats["bytes_freed"] += size
