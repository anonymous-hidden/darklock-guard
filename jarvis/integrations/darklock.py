"""
Nova — Darklock Integration
==============================
Connects Nova to the Darklock platform:
  • Read bug reports from the admin dashboard
  • Monitor server health (local + remote Pi5)
  • Restart services when they crash
  • Pull system status and recent logs

Uses the Darklock admin v4 API for bug reports and the Pi5 SSH
connector for remote server management.
"""

import os
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from integrations.pi5_ssh import Pi5SSHClient, Pi5Health


@dataclass
class BugReport:
    id: int
    title: str
    severity: str
    status: str
    source: str
    reporter: str
    description: str
    created_at: str
    assigned_to: Optional[str] = None
    internal_notes: Optional[str] = None

    def summary(self) -> str:
        return (f"#{self.id} [{self.severity}] {self.title} "
                f"(status: {self.status}, from: {self.source})")

    def detail(self) -> str:
        lines = [
            f"Bug #{self.id}: {self.title}",
            f"  Severity: {self.severity}",
            f"  Status: {self.status}",
            f"  Source: {self.source}",
            f"  Reporter: {self.reporter}",
            f"  Created: {self.created_at}",
        ]
        if self.assigned_to:
            lines.append(f"  Assigned: {self.assigned_to}")
        if self.description:
            lines.append(f"  Description: {self.description[:300]}")
        if self.internal_notes:
            lines.append(f"  Notes: {self.internal_notes[:200]}")
        return "\n".join(lines)


class DarklockClient:
    """Client for the Darklock admin API + Pi5 SSH management."""

    def __init__(self, config, audit=None, activity_tracker=None):
        self._config = config
        self._audit = audit
        self._activity = activity_tracker

        # Darklock API settings (local or remote)
        self._base_url = config.get("darklock.api_url") or "http://127.0.0.1:3002"
        self._admin_url = f"{self._base_url}/api/v4/admin"

        # Admin auth — use a service token or admin JWT
        self._admin_token = os.environ.get("DARKLOCK_ADMIN_TOKEN", "")

        # Pi5 SSH client
        pi5_host = config.get("darklock.pi5_host") or "192.168.50.150"
        pi5_user = config.get("darklock.pi5_user") or "darklock"
        pi5_port = config.get("darklock.pi5_ssh_port") or 22
        pi5_key  = config.get("darklock.pi5_ssh_key") or None
        if pi5_key:
            pi5_key = os.path.expanduser(pi5_key)

        self.pi5 = Pi5SSHClient(
            host=pi5_host, user=pi5_user, port=pi5_port,
            key_path=pi5_key, audit=audit,
        )

    def _log(self, event: str, data: dict):
        if self._audit:
            self._audit.log("darklock", event, data)

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self._admin_token:
            h["Cookie"] = f"admin_token={self._admin_token}"
        return h

    # ── Bug Reports ────────────────────────────────

    async def get_bug_reports(self, status: Optional[str] = None,
                              severity: Optional[str] = None,
                              limit: int = 20) -> list[BugReport]:
        """Fetch bug reports from Darklock admin API."""
        params = {"limit": limit, "offset": 0}
        if status:
            params["status"] = status
        if severity:
            params["severity"] = severity

        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(
                    f"{self._admin_url}/bug-reports",
                    params=params,
                    headers=self._headers(),
                )
                if r.status_code == 200:
                    data = r.json()
                    reports = data if isinstance(data, list) else data.get("reports", data.get("data", []))
                    result = []
                    for row in reports:
                        result.append(BugReport(
                            id=row.get("id", 0),
                            title=row.get("title", ""),
                            severity=row.get("severity", "unknown"),
                            status=row.get("status", "open"),
                            source=row.get("source", ""),
                            reporter=row.get("reporter", ""),
                            description=row.get("description", ""),
                            created_at=row.get("created_at", ""),
                            assigned_to=row.get("assigned_to"),
                            internal_notes=row.get("internal_notes"),
                        ))
                    self._log("bug_reports_fetched", {"count": len(result)})
                    return result
                elif r.status_code == 401:
                    self._log("bug_reports_auth_failed", {"status": 401})
                    return []
                else:
                    self._log("bug_reports_error", {"status": r.status_code})
                    return []
        except Exception as e:
            self._log("bug_reports_error", {"error": str(e)[:200]})
            return []

    async def get_bug_report(self, report_id: int) -> Optional[BugReport]:
        """Fetch a single bug report by ID."""
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(
                    f"{self._admin_url}/bug-reports/{report_id}",
                    headers=self._headers(),
                )
                if r.status_code == 200:
                    row = r.json()
                    if isinstance(row, dict) and "report" in row:
                        row = row["report"]
                    return BugReport(
                        id=row.get("id", report_id),
                        title=row.get("title", ""),
                        severity=row.get("severity", "unknown"),
                        status=row.get("status", "open"),
                        source=row.get("source", ""),
                        reporter=row.get("reporter", ""),
                        description=row.get("description", ""),
                        created_at=row.get("created_at", ""),
                        assigned_to=row.get("assigned_to"),
                        internal_notes=row.get("internal_notes"),
                    )
        except Exception as e:
            self._log("bug_report_error", {"id": report_id, "error": str(e)[:200]})
        return None

    async def update_bug_report(self, report_id: int, **fields) -> bool:
        """Update a bug report (status, severity, internal_notes, assigned_to)."""
        allowed = {"status", "severity", "internal_notes", "assigned_to"}
        payload = {k: v for k, v in fields.items() if k in allowed}
        if not payload:
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.put(
                    f"{self._admin_url}/bug-reports/{report_id}",
                    json=payload,
                    headers=self._headers(),
                )
                success = r.status_code == 200
                self._log("bug_report_updated", {
                    "id": report_id, "fields": payload, "success": success})
                return success
        except Exception as e:
            self._log("bug_report_update_error", {"id": report_id, "error": str(e)[:200]})
            return False

    # ── Server Health ──────────────────────────────

    async def check_server_health(self) -> dict:
        """Check Darklock server health — both local HTTP and Pi5 SSH."""
        result = {
            "local_http": None,
            "pi5": None,
        }

        # Local HTTP health check
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                t0 = time.time()
                r = await c.get(f"{self._base_url}/health")
                latency = (time.time() - t0) * 1000
                result["local_http"] = {
                    "online": r.status_code == 200,
                    "status_code": r.status_code,
                    "latency_ms": round(latency, 1),
                }
        except Exception as e:
            result["local_http"] = {"online": False, "error": str(e)[:200]}

        # Pi5 SSH health
        try:
            pi5_health = await self.pi5.health_check()
            result["pi5"] = pi5_health.to_dict()
        except Exception as e:
            result["pi5"] = {"online": False, "error": str(e)[:200]}

        self._log("health_check", result)
        return result

    async def get_darklock_status(self) -> str:
        """Get a human-readable Darklock status summary."""
        health = await self.check_server_health()

        parts = []
        # Local
        local = health.get("local_http", {})
        if local.get("online"):
            parts.append(f"Darklock HTTP: online ({local.get('latency_ms', 0):.0f}ms)")
        else:
            parts.append(f"Darklock HTTP: OFFLINE ({local.get('error', 'unknown')})")

        # Pi5
        pi5 = health.get("pi5", {})
        if pi5.get("online"):
            dl_active = "running" if pi5.get("darklock_active") else "DOWN"
            parts.append(f"Pi5: online | Darklock service: {dl_active}")
            if pi5.get("cpu_temp"):
                parts.append(f"CPU temp: {pi5['cpu_temp']}")
            if pi5.get("memory"):
                parts.append(f"RAM: {pi5['memory']}")
            if pi5.get("disk"):
                parts.append(f"Disk: {pi5['disk']}")
            if pi5.get("uptime"):
                parts.append(f"Uptime: {pi5['uptime']}")
        else:
            parts.append(f"Pi5: OFFLINE ({pi5.get('error', 'unreachable')})")

        return " | ".join(parts)

    # ── Service Management ─────────────────────────

    async def restart_darklock(self) -> str:
        """Restart the Darklock service on the Pi5."""
        self._log("restart_requested", {})
        if self._activity:
            self._activity.action("🔄 Restarting Darklock on Pi5")

        result = await self.pi5.restart_darklock()
        if result.success:
            msg = "Darklock restarted successfully on Pi5"
            # Verify it came back up
            import asyncio
            await asyncio.sleep(5)
            verify = await self.pi5.run("systemctl is-active darklock")
            if verify.success and verify.stdout.strip() == "active":
                msg += " — verified active"
            else:
                msg += " — warning: service may not be fully up yet"
        else:
            msg = f"Failed to restart Darklock: {result.stderr or result.stdout}"

        self._log("restart_result", {"success": result.success, "message": msg})
        if self._activity:
            icon = "✅" if result.success else "❌"
            self._activity.system_event(f"{icon} Darklock restart: {msg}")
        return msg

    async def get_darklock_logs(self, lines: int = 30) -> str:
        """Get recent Darklock service logs from Pi5."""
        result = await self.pi5.darklock_logs(lines=lines)
        if result.success:
            return result.stdout
        return f"Failed to get logs: {result.stderr}"

    # ── Pi5 Health (simple) ────────────────────────

    async def pi5_health_check(self) -> Pi5Health:
        """Full Pi5 health check via SSH."""
        return await self.pi5.health_check()

    async def pi5_health_summary(self) -> str:
        """Human-readable Pi5 health summary."""
        health = await self.pi5.health_check()
        return health.summary()
