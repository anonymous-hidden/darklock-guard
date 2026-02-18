#!/bin/bash
# Quick start script for Darklock Guard
# Builds and runs the guard service, then launches the desktop app

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default password if not set (for quick testing)
if [ -z "$GUARD_VAULT_PASSWORD" ]; then
    export GUARD_VAULT_PASSWORD="darklock2026"
fi

echo "🚀 Starting Darklock Guard"
echo "=========================="
echo ""

# Check if service is already running
if pgrep -f "guard-service|darklock-guard" > /dev/null; then
    echo "⚠️  Guard service is already running"
    read -p "Kill and restart? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pkill -f "guard-service|darklock-guard" || true
        sleep 1
    else
        echo "Skipping service start..."
        cd "$SCRIPT_DIR/desktop"
        exec npx tauri dev
        exit 0
    fi
fi

# Build the service if needed
if [ ! -f "$SCRIPT_DIR/crates/guard-service/target/debug/guard-service" ]; then
    echo "📦 Building guard service (debug mode)..."
    cd "$SCRIPT_DIR/crates/guard-service"
    cargo build
    echo ""
fi

# Initialize vault if needed
VAULT_PATH="$HOME/.local/share/guard/vault.dat"
ALT_VAULT_PATH="$HOME/.local/share/darklock-guard/vault.dat"
if [ ! -f "$VAULT_PATH" ] && [ ! -f "$ALT_VAULT_PATH" ]; then
    echo "🔐 Initializing vault with password: $GUARD_VAULT_PASSWORD"
    cd "$SCRIPT_DIR/crates/guard-service"
    export GUARD_VAULT_PASSWORD_CONFIRM="$GUARD_VAULT_PASSWORD"
    cargo run -- init || {
        echo "❌ Failed to initialize vault"
        echo "If vault already exists, just skip this step."
    }
    echo ""
else
    echo "✓ Vault already exists, using existing vault"
fi

# Create .env for desktop app
cat > "$SCRIPT_DIR/desktop/.env" <<EOF
GUARD_VAULT_PASSWORD=$GUARD_VAULT_PASSWORD
VITE_API_URL=http://localhost:3001
VITE_PLATFORM_URL=http://localhost:3002
VITE_DEV_MODE=true
VITE_LOG_LEVEL=info
EOF

# Start the guard service in background
echo "🛡️  Starting guard service..."
cd "$SCRIPT_DIR/crates/guard-service"
GUARD_VAULT_PASSWORD="$GUARD_VAULT_PASSWORD" cargo run -- run &
SERVICE_PID=$!

# Wait for service to start
echo "⏳ Waiting for service to initialize..."
sleep 3

# Check if service is running
if ! kill -0 $SERVICE_PID 2>/dev/null; then
    echo "❌ Service failed to start"
    exit 1
fi

echo "✅ Guard service running (PID: $SERVICE_PID)"
echo ""

# Start desktop app
echo "🖥️  Starting desktop app..."
cd "$SCRIPT_DIR/desktop"

# Trap to kill service on exit
trap "echo ''; echo '🛑 Stopping guard service...'; kill $SERVICE_PID 2>/dev/null || true" EXIT

exec npx tauri dev
