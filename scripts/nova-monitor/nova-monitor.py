#!/usr/bin/env python3
"""
Nova Monitor — AI-powered service watchdog for Darklock Pi5
Checks service health, auto-restarts failures, escalates to Claude for
complex diagnostics, and sends Discord + email alerts.
"""

import asyncio
import hashlib
import json
import logging
import os
import signal
import smtplib
import subprocess
import sys
import time
from datetime import datetime, timezone
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

import aiohttp

# ── Logging ────────────────────────────────────────────────────────────
LOG_FMT = "[%(asctime)s] %(levelname)-7s %(message)s"
logging.basicConfig(level=logging.INFO, format=LOG_FMT)
log = logging.getLogger("nova")

# ── Globals ────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
STATE: dict = {}           # runtime state (restart counts, last alerts, etc.)
RUNNING = True
INTEGRITY_HASHES: dict = {}  # path → sha256 baseline


# ═══════════════════════════════════════════════════════════════════════
#  Configuration
# ═══════════════════════════════════════════════════════════════════════

def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_state(cfg: dict):
    state_file = cfg["nova"]["state_file"]
    try:
        with open(state_file, "w") as f:
            json.dump(STATE, f, indent=2, default=str)
    except Exception as e:
        log.warning("Could not save state: %s", e)


def load_state(cfg: dict):
    global STATE
    state_file = cfg["nova"]["state_file"]
    try:
        if os.path.exists(state_file):
            with open(state_file) as f:
                STATE = json.load(f)
    except Exception:
        STATE = {}


# ═══════════════════════════════════════════════════════════════════════
#  Service Health Checking
# ═══════════════════════════════════════════════════════════════════════

def check_systemd_unit(unit: str) -> tuple[bool, str]:
    """Check if a systemd unit is active. Returns (is_active, status_text)."""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", unit],
            capture_output=True, text=True, timeout=10
        )
        status = result.stdout.strip()
        return status == "active", status
    except Exception as e:
        return False, str(e)


async def check_http_health(url: str, timeout: int = 10) -> tuple[bool, str]:
    """Check an HTTP health endpoint. Returns (is_healthy, detail)."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status < 400:
                    return True, f"HTTP {resp.status}"
                return False, f"HTTP {resp.status}"
    except asyncio.TimeoutError:
        return False, "timeout"
    except aiohttp.ClientConnectorError:
        return False, "connection refused"
    except Exception as e:
        return False, str(e)


async def check_service(name: str, svc_cfg: dict) -> dict:
    """Full health check for a single service."""
    result = {"name": name, "timestamp": datetime.now(timezone.utc).isoformat()}

    # Systemd status
    unit = svc_cfg.get("systemd_unit")
    if unit:
        active, status_text = check_systemd_unit(unit)
        result["systemd_active"] = active
        result["systemd_status"] = status_text
    else:
        result["systemd_active"] = None

    # HTTP health
    url = svc_cfg.get("health_url")
    if url:
        healthy, detail = await check_http_health(url)
        result["http_healthy"] = healthy
        result["http_detail"] = detail
    else:
        result["http_healthy"] = None

    # Overall verdict
    if result["systemd_active"] is False:
        result["healthy"] = False
        result["reason"] = f"systemd unit {unit} is {result['systemd_status']}"
    elif result["http_healthy"] is False:
        result["healthy"] = False
        result["reason"] = f"HTTP health check failed: {result['http_detail']}"
    else:
        result["healthy"] = True
        result["reason"] = "ok"

    return result


# ═══════════════════════════════════════════════════════════════════════
#  Auto-Recovery
# ═══════════════════════════════════════════════════════════════════════

def restart_service(unit: str) -> tuple[bool, str]:
    """Restart a systemd service. Returns (success, output)."""
    log.info("Restarting %s ...", unit)
    try:
        result = subprocess.run(
            ["sudo", "systemctl", "restart", unit],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            log.info("  → %s restarted successfully", unit)
            return True, "ok"
        log.error("  → restart failed: %s", result.stderr.strip())
        return False, result.stderr.strip()
    except Exception as e:
        log.error("  → restart exception: %s", e)
        return False, str(e)


def get_journal_logs(unit: str, lines: int = 30) -> str:
    """Get recent journal logs for a unit."""
    try:
        result = subprocess.run(
            ["journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "short-iso"],
            capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip()
    except Exception:
        return "(could not retrieve logs)"


async def handle_failure(name: str, svc_cfg: dict, check_result: dict, cfg: dict):
    """Handle a service failure: restart, escalate, alert."""
    unit = svc_cfg["systemd_unit"]
    state_key = f"failures_{name}"
    restart_key = f"restarts_{name}"

    STATE.setdefault(state_key, 0)
    STATE.setdefault(restart_key, 0)
    STATE[state_key] = STATE[state_key] + 1

    max_restarts = cfg["nova"]["max_restart_attempts"]
    cooldown = cfg["nova"]["restart_cooldown"]
    last_restart_key = f"last_restart_{name}"
    last_restart = STATE.get(last_restart_key, 0)
    now = time.time()

    log.warning("[%s] UNHEALTHY — %s (failure #%d)", name, check_result["reason"], STATE[state_key])

    # Try restart if within limits and past cooldown
    if STATE[restart_key] < max_restarts and (now - last_restart) > cooldown:
        success, output = restart_service(unit)
        STATE[restart_key] = STATE[restart_key] + 1
        STATE[last_restart_key] = now

        if success:
            # Wait a moment and recheck
            await asyncio.sleep(5)
            recheck = await check_service(name, svc_cfg)
            if recheck["healthy"]:
                log.info("[%s] Recovered after restart", name)
                await send_alert(
                    cfg, f"✅ {name} recovered",
                    f"Service **{name}** was down ({check_result['reason']}) "
                    f"and was automatically restarted by Nova.\n"
                    f"Status: healthy again.",
                    level="info", service=name
                )
                STATE[state_key] = 0
                STATE[restart_key] = 0
                return
            else:
                log.error("[%s] Still unhealthy after restart", name)

    # Escalate — too many failures or restart didn't help
    escalate_threshold = cfg["nova"]["escalate_after_failures"]
    if STATE[state_key] >= escalate_threshold:
        log.error("[%s] Escalating to Claude AI for diagnosis", name)
        journal = get_journal_logs(unit)
        diagnosis = await ask_claude(cfg, name, svc_cfg, check_result, journal)

        await send_alert(
            cfg, f"🚨 {name} DOWN — AI Diagnosis",
            f"**Service:** {name} ({svc_cfg['description']})\n"
            f"**Reason:** {check_result['reason']}\n"
            f"**Restart attempts:** {STATE[restart_key]}/{max_restarts}\n"
            f"**Consecutive failures:** {STATE[state_key]}\n\n"
            f"**Nova AI Diagnosis:**\n{diagnosis}\n\n"
            f"**Recent logs (last 30 lines):**\n```\n{journal[-1500:]}\n```",
            level="critical", service=name
        )
        # Reset counter so we don't spam Claude every cycle
        STATE[state_key] = 0
    else:
        await send_alert(
            cfg, f"⚠️ {name} is down",
            f"**Service:** {name} ({svc_cfg['description']})\n"
            f"**Reason:** {check_result['reason']}\n"
            f"**Restart attempts:** {STATE[restart_key]}/{max_restarts}\n"
            f"Nova is monitoring and will escalate if it doesn't recover.",
            level="warning", service=name
        )


# ═══════════════════════════════════════════════════════════════════════
#  Claude AI Integration
# ═══════════════════════════════════════════════════════════════════════

async def ask_claude(cfg: dict, service_name: str, svc_cfg: dict,
                     check_result: dict, journal_logs: str) -> str:
    """Ask Claude to diagnose a service failure."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return "(Claude API key not configured — set ANTHROPIC_API_KEY)"

    model = cfg["claude"]["model"]
    prompt = (
        f"You are Nova, an AI operations agent monitoring the Darklock platform on a Raspberry Pi 5.\n"
        f"A service has failed and automatic restarts haven't resolved it.\n\n"
        f"Service: {service_name}\n"
        f"Description: {svc_cfg['description']}\n"
        f"Systemd unit: {svc_cfg['systemd_unit']}\n"
        f"Health URL: {svc_cfg.get('health_url', 'N/A')}\n"
        f"Failure reason: {check_result['reason']}\n\n"
        f"Recent journal logs:\n```\n{journal_logs[-3000:]}\n```\n\n"
        f"Diagnose the root cause and suggest specific recovery steps. "
        f"Be concise (under 200 words). Include the exact commands to run if applicable."
    )

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": model,
                    "max_tokens": cfg["claude"]["max_tokens"],
                    "temperature": cfg["claude"]["temperature"],
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data["content"][0]["text"]
                else:
                    body = await resp.text()
                    return f"(Claude API error {resp.status}: {body[:200]})"
    except Exception as e:
        return f"(Claude API call failed: {e})"


# ═══════════════════════════════════════════════════════════════════════
#  Alerts — Discord + Email
# ═══════════════════════════════════════════════════════════════════════

async def send_discord_alert(cfg: dict, title: str, message: str, level: str):
    """Send an alert via Discord webhook."""
    webhook_url = cfg["alerts"].get("discord_webhook_url", "")
    if not webhook_url:
        return

    color_map = {"info": 0x22c55e, "warning": 0xeab308, "critical": 0xef4444}
    color = color_map.get(level, 0x6366f1)

    payload = {
        "username": "Nova Monitor",
        "embeds": [{
            "title": title,
            "description": message[:4000],
            "color": color,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "footer": {"text": "Nova AI • Darklock Pi5"}
        }]
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(webhook_url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status not in (200, 204):
                    log.warning("Discord webhook returned %d", resp.status)
    except Exception as e:
        log.warning("Discord alert failed: %s", e)


def send_email_alert(cfg: dict, title: str, message: str):
    """Send an alert via email (SMTP)."""
    alerts = cfg["alerts"]
    if not alerts.get("smtp_user") or not alerts.get("smtp_pass") or not alerts.get("email_to"):
        return

    msg = MIMEText(message.replace("**", "").replace("```", ""), "plain", "utf-8")
    msg["Subject"] = f"[Nova] {title}"
    msg["From"] = alerts["email_from"]
    msg["To"] = alerts["email_to"]

    try:
        with smtplib.SMTP(alerts["smtp_host"], alerts["smtp_port"], timeout=15) as server:
            server.starttls()
            server.login(alerts["smtp_user"], alerts["smtp_pass"])
            server.sendmail(alerts["smtp_user"], [alerts["email_to"]], msg.as_string())
        log.info("Email alert sent: %s", title)
    except Exception as e:
        log.warning("Email alert failed: %s", e)


async def send_nova_desktop_report(cfg: dict, title: str, message: str,
                                    level: str, service: str = ""):
    """Push a security/health report to the Nova AI desktop app (localhost:8950)."""
    nova_cfg = cfg.get("nova_desktop", {})
    if not nova_cfg.get("enabled", False):
        return

    url = nova_cfg.get("url", "http://localhost:8950").rstrip("/") + "/pi5/report"
    payload = {
        "title": title,
        "message": message,
        "level": level,
        "service": service,
        "source": "pi5-monitor",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url, json=payload,
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status != 200:
                    log.warning("Nova desktop report returned %d", resp.status)
    except Exception as e:
        # Desktop may be offline — don't crash the monitor
        log.debug("Nova desktop report failed (offline?): %s", e)


async def send_alert(cfg: dict, title: str, message: str, level: str = "info",
                     service: str = ""):
    """Send alert through all configured channels, respecting cooldown."""
    cooldown = cfg["alerts"].get("alert_cooldown", 300)
    alert_key = f"alert_{title}"
    last_alert = STATE.get(alert_key, 0)
    now = time.time()

    if (now - last_alert) < cooldown:
        log.debug("Alert suppressed (cooldown): %s", title)
        return

    STATE[alert_key] = now
    log.info("ALERT [%s]: %s", level, title)

    await send_discord_alert(cfg, title, message, level)
    send_email_alert(cfg, title, message)
    await send_nova_desktop_report(cfg, title, message, level, service)


# ═══════════════════════════════════════════════════════════════════════
#  File Integrity Monitoring (Tamper Detection Layer 2)
# ═══════════════════════════════════════════════════════════════════════

def hash_file(filepath: str) -> Optional[str]:
    """SHA-256 hash of a file."""
    try:
        h = hashlib.sha256()
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def build_integrity_baseline(cfg: dict):
    """Build initial hash baseline for watched paths."""
    global INTEGRITY_HASHES
    import glob

    paths = cfg.get("integrity", {}).get("watch_paths", [])
    for pattern in paths:
        for filepath in glob.glob(pattern):
            if os.path.isfile(filepath):
                h = hash_file(filepath)
                if h:
                    INTEGRITY_HASHES[filepath] = h
                    log.debug("Baseline: %s → %s", filepath, h[:12])

    log.info("Integrity baseline built: %d files", len(INTEGRITY_HASHES))


async def check_integrity(cfg: dict):
    """Check watched files against baseline. Alert on changes."""
    import glob

    if not INTEGRITY_HASHES:
        return

    paths = cfg.get("integrity", {}).get("watch_paths", [])
    for pattern in paths:
        for filepath in glob.glob(pattern):
            if not os.path.isfile(filepath):
                continue

            current_hash = hash_file(filepath)
            baseline_hash = INTEGRITY_HASHES.get(filepath)

            if baseline_hash is None:
                # New file appeared — add to baseline
                if current_hash:
                    INTEGRITY_HASHES[filepath] = current_hash
                    log.info("New file detected: %s", filepath)
                continue

            if current_hash != baseline_hash:
                log.warning("INTEGRITY CHANGE: %s", filepath)
                await send_alert(
                    cfg,
                    f"🔒 File integrity change detected",
                    f"**File:** `{filepath}`\n"
                    f"**Previous hash:** `{baseline_hash[:16]}...`\n"
                    f"**Current hash:** `{current_hash[:16] if current_hash else 'DELETED'}...`\n\n"
                    f"This may indicate unauthorized modification. "
                    f"Nova is the 2nd security layer — the tamper detection system will also flag this.\n\n"
                    f"**Action:** Investigate immediately. If this was an authorized deployment, "
                    f"restart Nova to rebuild the baseline.",
                    level="critical"
                )
                # Update baseline so we don't spam
                INTEGRITY_HASHES[filepath] = current_hash


# ═══════════════════════════════════════════════════════════════════════
#  Health API (so other systems can check Nova itself)
# ═══════════════════════════════════════════════════════════════════════

async def health_server(cfg: dict):
    """Run a tiny HTTP server so external systems can check Nova is alive."""
    from aiohttp import web

    async def handle_health(request):
        return web.json_response({
            "status": "ok",
            "service": "nova-monitor",
            "uptime": time.time() - STATE.get("start_time", time.time()),
            "last_check": STATE.get("last_check_time"),
            "services_monitored": len(cfg.get("services", {})),
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

    async def handle_status(request):
        return web.json_response({
            "state": STATE,
            "integrity_files": len(INTEGRITY_HASHES),
            "config": {k: v.get("description", k) for k, v in cfg.get("services", {}).items()}
        })

    app = web.Application()
    app.router.add_get("/health", handle_health)
    app.router.add_get("/status", handle_status)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 9500)
    await site.start()
    log.info("Nova health API listening on :9500")


# ═══════════════════════════════════════════════════════════════════════
#  Main Loop
# ═══════════════════════════════════════════════════════════════════════

async def main_loop():
    global RUNNING

    cfg = load_config()
    load_state(cfg)
    STATE["start_time"] = time.time()

    log.info("═══════════════════════════════════════")
    log.info("  Nova Monitor v1.0 — Darklock Pi5")
    log.info("  Services: %d", len(cfg.get("services", {})))
    log.info("  Check interval: %ds", cfg["nova"]["check_interval"])
    log.info("═══════════════════════════════════════")

    # Build integrity baseline
    build_integrity_baseline(cfg)

    # Start health API
    await health_server(cfg)

    # Send startup alert
    svc_list = ", ".join(cfg.get("services", {}).keys())
    await send_alert(
        cfg, "🟢 Nova Monitor started",
        f"Nova is now monitoring **{len(cfg.get('services', {}))}** services on Darklock Pi5.\n"
        f"Services: {svc_list}\n"
        f"Integrity files: {len(INTEGRITY_HASHES)}\n"
        f"Check interval: {cfg['nova']['check_interval']}s",
        level="info"
    )

    check_interval = cfg["nova"]["check_interval"]
    integrity_interval = cfg["nova"]["integrity_check_interval"]
    last_integrity_check = 0

    while RUNNING:
        try:
            # Reload config (allows live changes)
            cfg = load_config()

            # Check all services
            for name, svc_cfg in cfg.get("services", {}).items():
                result = await check_service(name, svc_cfg)

                if result["healthy"]:
                    # Clear failure counters on recovery
                    if STATE.get(f"failures_{name}", 0) > 0:
                        log.info("[%s] Recovered", name)
                        STATE[f"failures_{name}"] = 0
                        STATE[f"restarts_{name}"] = 0
                else:
                    await handle_failure(name, svc_cfg, result, cfg)

            STATE["last_check_time"] = datetime.now(timezone.utc).isoformat()

            # Periodic integrity check
            now = time.time()
            if (now - last_integrity_check) > integrity_interval:
                await check_integrity(cfg)
                last_integrity_check = now

            save_state(cfg)
            await asyncio.sleep(check_interval)

        except Exception as e:
            log.error("Main loop error: %s", e, exc_info=True)
            await asyncio.sleep(10)


def shutdown(signum, frame):
    global RUNNING
    log.info("Shutdown signal received")
    RUNNING = False


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        log.info("Interrupted")
    finally:
        log.info("Nova Monitor stopped")
