#!/usr/bin/env bash
# ============================================================
# JARVIS-Lite — Start Backend
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Activate venv
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Start Ollama if not running
OLLAMA_BIN=$(command -v ollama 2>/dev/null || echo "$HOME/.local/bin/ollama")
if [ -x "$OLLAMA_BIN" ]; then
    if ! curl -s http://127.0.0.1:11434/api/tags &>/dev/null; then
        echo "→ Starting Ollama server..."
        $OLLAMA_BIN serve &>/dev/null &
        sleep 2
    fi
fi

# Start JARVIS backend
python3 main.py
