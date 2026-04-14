#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Darklock AI — STOP
# Managed by Home AI Assistant
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIGURE THESE (fill in before first run) ───────────────
PROCESS_NAME="darklock/apps/server"   # matches tsx watch process path
# ─────────────────────────────────────────────────────────────

echo "=== Stopping Darklock ==="

if ! pgrep -f "$PROCESS_NAME" > /dev/null 2>&1; then
    echo "Not running — nothing to do."
    exit 0
fi

# Graceful shutdown (SIGTERM)
pkill -TERM -f "$PROCESS_NAME" 2>/dev/null && echo "Sent SIGTERM..."
sleep 3

# Force kill if still alive
if pgrep -f "$PROCESS_NAME" > /dev/null 2>&1; then
    pkill -KILL -f "$PROCESS_NAME" 2>/dev/null
    echo "Force-killed remaining processes."
fi

echo "Stopped."

# ── Systemd alternative ───────────────────────────────────────
# systemctl stop darklock.service && echo "Service stopped."
