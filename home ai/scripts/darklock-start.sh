#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Darklock AI — START
# Managed by Home AI Assistant
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIGURE THESE (fill in before first run) ───────────────
PROJECT_DIR="/home/cayden/darklock"
PROCESS_NAME="darklock/apps/server"
LOG_FILE="$PROJECT_DIR/apps/server/server.log"

# Darklock server — tsx watch (dev) mode
START_CMD="npm run dev --workspace=apps/server"
# ─────────────────────────────────────────────────────────────

echo "=== Starting Darklock ==="

if pgrep -f "$PROCESS_NAME" > /dev/null 2>&1; then
    echo "Already running — nothing to do."
    pgrep -fa "$PROCESS_NAME" | head -3
    exit 0
fi

cd "$PROJECT_DIR"
nohup bash -c "$START_CMD" >> "$LOG_FILE" 2>&1 &
sleep 2

if pgrep -f "$PROCESS_NAME" > /dev/null 2>&1; then
    echo "Started successfully (PID $(pgrep -f "$PROCESS_NAME" | head -1))"
else
    echo "ERROR: Process did not start. Last log lines:"
    tail -20 "$LOG_FILE" 2>/dev/null || true
    exit 1
fi

# ── Systemd alternative (uncomment + comment blocks above) ───
# systemctl start darklock.service && echo "Service started."

echo "Done."
