#!/usr/bin/env bash
# ============================================================
# JARVIS-Lite — Install Script (Linux)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     JARVIS-Lite — Installation       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── 1. Python check ──────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "✗ Python 3 not found.  Install Python 3.10+."
    exit 1
fi
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "✓ Python $PY_VER found"

# ── 2. Virtual environment ───────────────────────
if [ ! -d ".venv" ]; then
    echo "→ Creating virtual environment..."
    python3 -m venv .venv
fi
source .venv/bin/activate
echo "✓ Virtual environment activated"

# ── 3. Python dependencies ───────────────────────
echo "→ Installing Python dependencies..."
pip install -q -r requirements.txt
echo "✓ Python packages installed"

# ── 4. Ollama check ─────────────────────────────
if command -v ollama &>/dev/null; then
    echo "✓ Ollama found: $(which ollama)"
elif [ -f "$HOME/.local/bin/ollama" ]; then
    echo "✓ Ollama found: $HOME/.local/bin/ollama"
else
    echo ""
    echo "⚠  Ollama not found.  Install it:"
    echo "   curl -fsSL https://ollama.com/install.sh | sh"
    echo ""
fi

# ── 5. Pull LLaMA model (if Ollama available) ───
OLLAMA_BIN=$(command -v ollama 2>/dev/null || echo "$HOME/.local/bin/ollama")
if [ -x "$OLLAMA_BIN" ]; then
    MODEL=$(python3 -c "import yaml; print(yaml.safe_load(open('config.yaml'))['ai']['model'])" 2>/dev/null || echo "llama3.2:3b")
    echo "→ Ensuring model '$MODEL' is available..."
    $OLLAMA_BIN pull "$MODEL" 2>/dev/null && echo "✓ Model ready" || echo "⚠  Could not pull model.  Make sure 'ollama serve' is running."
fi

# ── 6. .env file ────────────────────────────────
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✓ Created .env from template"
fi

# ── 7. Create required directories ──────────────
mkdir -p logs data data/backups
echo "✓ Directories created"

# ── 8. Node.js + Desktop app ────────────────────
if command -v node &>/dev/null; then
    echo "→ Setting up desktop app..."
    cd desktop
    if [ ! -d "node_modules" ]; then
        npm install --silent 2>/dev/null || npm install
    fi
    echo "→ Building frontend..."
    npm run build 2>/dev/null && echo "✓ Desktop frontend built" || echo "⚠  Frontend build failed (non-critical)"
    cd ..
else
    echo "⚠  Node.js not found — desktop app won't be built."
    echo "   Install Node.js 18+ for the Electron desktop UI."
fi

echo ""
echo "  ════════════════════════════════════════"
echo "  Installation complete!"
echo ""
echo "  Start the backend:   ./start.sh"
echo "  Start desktop app:   cd desktop && npm run dev"
echo "  Or both at once:     ./start.sh && (cd desktop && npm run dev)"
echo "  ════════════════════════════════════════"
echo ""
