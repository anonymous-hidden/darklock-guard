#!/usr/bin/env bash
# ============================================================
# Home AI Assistant — Quick Start Script
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🏠 Home AI Assistant — Setup & Launch"
echo "======================================"

# 1. Check Python
if ! command -v python3 &>/dev/null; then
    echo "✗ Python 3 not found. Please install Python 3.10+."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "✓ Python $PYTHON_VERSION found"

# 2. Create virtual environment if needed
if [ ! -d ".venv" ]; then
    echo "→ Creating virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate
echo "✓ Virtual environment activated"

# 3. Install Python dependencies
echo "→ Installing Python dependencies..."
pip install -q -r requirements.txt

# 4. Check .env
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "   Edit .env and set your CLAUDE_API_KEY before running."
    echo ""
fi

# 5. Build frontend (if Node.js is available)
if command -v node &>/dev/null; then
    echo "→ Setting up frontend..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm install --silent
    fi
    echo "→ Building frontend..."
    npm run build 2>/dev/null || echo "   (Frontend build skipped — will use Vite dev server)"
    cd ..
    echo "✓ Frontend ready"
else
    echo "⚠️  Node.js not found — frontend won't be built."
    echo "   Install Node.js 18+ for the web UI."
fi

# 6. Create required directories
mkdir -p logs scripts

# 7. Launch
echo ""
echo "Starting Home AI Assistant..."
echo ""
python3 main.py
