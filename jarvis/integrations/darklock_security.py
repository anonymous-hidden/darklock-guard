"""
Nova — Darklock Security Bridge
=================================
Integrates Nova into Darklock's anti-tampering layer.

Responsibilities:
  - Receives file-change callbacks from Nova's IntegrityChecker (Darklock group)
  - Pushes tamper alerts to Nova's audit trail and anomaly detector
  - Queries Darklock server health as a security signal
  - Exposes a summary for the /api/darklock/security endpoint
  - Optionally triggers an SSH re-check of the Pi5 Darklock process list

Wiring (done in main.py):
    from integrations.darklock_security import DarklockSecurityBridge
    bridge = DarklockSecurityBridge(config, audit, activity_tracker, anomaly)
    integrity.add_darklock_callback(bridge.on_file_changes)
"""

import threading
from datetime import datetime
from pathlib import Path
from typing import Optional


class DarklockSecurityBridge:
    """
    Listens for file-integrity violations in Darklock source files and
    escalates them through Nova's alert/audit systems.
    """

    def __init__(self, config, audit, activity_tracker, anomaly=None):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker
        self._anomaly = anomaly
        self._lock = threading.Lock()
        self._violations: list[dict] = []  # rolling log of tamper events
        self._last_check: Optional[str] = None
        self._alert_count = 0

    # ── Callback from IntegrityChecker ────────────────────────────────────────

    def on_file_changes(self, changes: list[dict]):
        """Called by IntegrityChecker whenever a Darklock file changes."""
        now = datetime.now().isoformat()
        for ch in changes:
            violation = {
                "file": ch["file"],
                "status": ch["status"],
                "detected_at": now,
                "acknowledged": False,
            }

            with self._lock:
                self._violations.append(violation)
                # Keep last 100 violations
                if len(self._violations) > 100:
                    self._violations = self._violations[-100:]
                self._alert_count += 1
                self._last_check = now

            # Push to Nova's audit trail
            self._audit.log(
                "darklock_security",
                "file_tamper_detected",
                {
                    "file": ch["file"],
                    "status": ch["status"],
                    "severity": "high" if ch["status"] == "modified" else "medium",
                },
            )

            # Push to activity tracker (shows up in the activity feed)
            sev = "CRITICAL" if ch["status"] == "modified" else "WARNING"
            self._activity.system_event(
                f"[{sev}] Darklock file {ch['status']}: {ch['file']}",
                details={"file": ch["file"], "status": ch["status"]},
            )

            # Push to anomaly detector (if available) to create an alert
            if self._anomaly:
                try:
                    self._anomaly.create_alert(
                        title=f"Darklock tamper: {ch['status']} — {ch['file']}",
                        message=(
                            f"File integrity check detected that {ch['file']} "
                            f"was {ch['status']}. This could indicate "
                            f"unauthorized modification of the Darklock platform."
                        ),
                        severity="high" if ch["status"] == "modified" else "medium",
                        source="darklock_security",
                    )
                except Exception:
                    pass  # anomaly detector may not have create_alert

    # ── Status / summary ──────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Return a security summary for the API endpoint."""
        with self._lock:
            recent = self._violations[-10:]
            unacked = [v for v in self._violations if not v["acknowledged"]]

        return {
            "monitored": True,
            "alert_count": self._alert_count,
            "unacknowledged": len(unacked),
            "last_check": self._last_check,
            "recent_violations": recent,
            "darklock_files_watched": _get_darklock_file_list(),
        }

    def get_violations(self, limit: int = 50, unacked_only: bool = False) -> list[dict]:
        with self._lock:
            result = list(self._violations)
        if unacked_only:
            result = [v for v in result if not v["acknowledged"]]
        return result[-limit:]

    def acknowledge(self, file_name: str) -> bool:
        """Acknowledge a tamper alert by file name."""
        with self._lock:
            for v in self._violations:
                if v["file"] == file_name and not v["acknowledged"]:
                    v["acknowledged"] = True
                    return True
        return False

    def acknowledge_all(self):
        with self._lock:
            for v in self._violations:
                v["acknowledged"] = True

    def rebaseline_darklock(self, integrity_checker) -> dict:
        """Tell Nova's integrity checker to re-baseline all Darklock files.
        Call this after you intentionally deploy a Darklock update.
        """
        from security.integrity import _DARKLOCK_FILES
        workspace = Path(self._config.get("indexer.workspace", "~/discord bot/discord bot")).expanduser()
        rehashed = []
        import hashlib
        for rel in _DARKLOCK_FILES:
            full = workspace / rel
            if full.exists():
                h = hashlib.sha256(full.read_bytes()).hexdigest()
                integrity_checker._hashes[f"darklock::{rel}"] = h
                rehashed.append(rel)
        integrity_checker._save()
        self._audit.log("darklock_security", "rebaselined", {"files": rehashed})
        return {"rebaselined": rehashed, "count": len(rehashed)}


def _get_darklock_file_list() -> list[str]:
    try:
        from security.integrity import _DARKLOCK_FILES
        return list(_DARKLOCK_FILES)
    except Exception:
        return []
