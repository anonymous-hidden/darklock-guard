#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Darklock AI — STATUS CHECK
# Managed by Home AI Assistant
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIGURE THESE (fill in before first run) ───────────────
PROJECT_DIR="/home/cayden/darklock"
PROCESS_NAME="darklock/apps/server"
LOG_FILE="$PROJECT_DIR/apps/server/server.log"
# ─────────────────────────────────────────────────────────────

echo "=== Darklock Status ==="
echo "Time: $(date)"
echo ""

# Directory check
if [ -d "$PROJECT_DIR" ]; then
    echo "Directory: $PROJECT_DIR ✓"
else
    echo "ERROR: Project directory not found: $PROJECT_DIR"
    exit 1
fi

# Process check
echo ""
if pgrep -f "$PROCESS_NAME" > /dev/null 2>&1; then
    echo "Status: RUNNING ✓"
    pgrep -fa "$PROCESS_NAME" | head -5
    echo ""
    echo "Running since:"
    ps -o pid,etime,cmd -p "$(pgrep -f "$PROCESS_NAME" | head -1)" 2>/dev/null || true
else
    echo "Status: STOPPED"
fi

# Port check
echo ""
echo "Open ports (darklock):"
ss -tlnp 2>/dev/null | grep -E "$PROCESS_NAME|LISTEN" | head -10 || echo "(none found)"

# Disk usage
echo ""
echo "Disk usage:"
du -sh "$PROJECT_DIR" 2>/dev/null || echo "(unknown)"

# Recent logs
echo ""
echo "Recent logs (last 20 lines):"
if [ -f "$LOG_FILE" ]; then
    tail -20 "$LOG_FILE"
else
    echo "(log file not found: $LOG_FILE)"
fi

echo ""
echo "Done."
