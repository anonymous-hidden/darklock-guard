#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Darklock AI — RESTART
# Managed by Home AI Assistant
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Restarting Darklock ==="
bash "$SCRIPTS_DIR/darklock-stop.sh"
sleep 1
bash "$SCRIPTS_DIR/darklock-start.sh"
echo "Restart complete."
