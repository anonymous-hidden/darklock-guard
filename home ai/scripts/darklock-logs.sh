#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Darklock AI — VIEW LOGS  (read-only, no side effects)
# Managed by Home AI Assistant
# Risk: LOW — runs without approval prompt
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIGURE THIS (fill in before first run) ─────────────────────────────────
LOG_FILE="/home/cayden/darklock/apps/server/server.log"
# ─────────────────────────────────────────────────────────────────────────────

echo "=== Darklock — Last 50 Log Lines ==="
echo "Time: $(date)"
echo "Log: $LOG_FILE"
echo ""

if [ -f "$LOG_FILE" ]; then
    tail -50 "$LOG_FILE"
else
    echo "(log file not found: $LOG_FILE)"
    echo "Darklock may not have run yet, or the path needs updating."
fi

echo ""
echo "Done."
