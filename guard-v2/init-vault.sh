#!/bin/bash
# Quick vault initialization script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$SCRIPT_DIR/desktop"

echo "🔐 Darklock Guard - Vault Setup"
echo "================================"
echo ""

# Check if guard-service is built
if [ ! -f "$SCRIPT_DIR/target/debug/guard-service" ] && [ ! -f "$SCRIPT_DIR/crates/guard-service/target/release/darklock-guard" ]; then
    echo "⚙️  Building guard service..."
    cd "$SCRIPT_DIR/crates/guard-service"
    cargo build --release
    echo ""
fi

# Prompt for vault password
echo "Create a vault password (min 8 characters):"
read -sp "Password: " VAULT_PASSWORD
echo ""
read -sp "Confirm: " VAULT_PASSWORD_CONFIRM
echo ""

if [ "$VAULT_PASSWORD" != "$VAULT_PASSWORD_CONFIRM" ]; then
    echo "❌ Passwords do not match"
    exit 1
fi

if [ ${#VAULT_PASSWORD} -lt 8 ]; then
    echo "❌ Password must be at least 8 characters"
    exit 1
fi

# Initialize vault
echo ""
echo "🔧 Initializing vault..."
cd "$SCRIPT_DIR/crates/guard-service"
export GUARD_VAULT_PASSWORD="$VAULT_PASSWORD"
export GUARD_VAULT_PASSWORD_CONFIRM="$VAULT_PASSWORD"
cargo run --release -- init

# Create .env file
echo ""
echo "📝 Creating desktop app config..."
cat > "$DESKTOP_DIR/.env" <<EOF
# Darklock Guard - Desktop App Configuration
GUARD_VAULT_PASSWORD=$VAULT_PASSWORD
VITE_API_URL=http://localhost:3001
VITE_PLATFORM_URL=http://localhost:3002
VITE_DEV_MODE=true
VITE_LOG_LEVEL=info
EOF

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start the guard service:"
echo "     cd crates/guard-service && GUARD_VAULT_PASSWORD='$VAULT_PASSWORD' cargo run --release -- start &"
echo ""
echo "  2. Start the desktop app:"
echo "     cd desktop && npx tauri dev"
echo ""
