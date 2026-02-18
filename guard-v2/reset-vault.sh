#!/bin/bash
# Reset Guard vault and start fresh
# WARNING: This deletes your existing vault!

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "⚠️  RESET DARKLOCK GUARD VAULT"
echo "==============================="
echo ""
echo "This will DELETE the existing vault and create a new one."
echo "Any stored configuration will be lost."
echo ""
read -p "Continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled."
    exit 0
fi

# Stop any running service
pkill -f "guard-service|darklock-guard" 2>/dev/null || true
sleep 1

# Delete old vault
echo ""
echo "🗑️  Removing old vault..."
rm -f /home/cayden/.local/share/guard/vault.dat
rm -f /home/cayden/.local/share/darklock-guard/vault.dat

# Prompt for new password
echo ""
echo "🔐 Create new vault password (min 8 chars):"
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

# Build service if needed
if [ ! -f "$SCRIPT_DIR/crates/guard-service/target/debug/guard-service" ]; then
    echo ""
    echo "📦 Building guard service..."
    cd "$SCRIPT_DIR/crates/guard-service"
    cargo build
fi

# Initialize new vault
echo ""
echo "🔧 Creating new vault..."
cd "$SCRIPT_DIR/crates/guard-service"
export GUARD_VAULT_PASSWORD="$VAULT_PASSWORD"
export GUARD_VAULT_PASSWORD_CONFIRM="$VAULT_PASSWORD"
echo "$VAULT_PASSWORD" | cargo run -- init || {
    echo "❌ Failed to create vault"
    exit 1
}

# Create .env
cat > "$SCRIPT_DIR/desktop/.env" <<EOF
GUARD_VAULT_PASSWORD=$VAULT_PASSWORD
VITE_API_URL=http://localhost:3001
VITE_PLATFORM_URL=http://localhost:3002
VITE_DEV_MODE=true
VITE_LOG_LEVEL=info
EOF

echo ""
echo "✅ Vault reset complete!"
echo ""
echo "Your new vault password is: $VAULT_PASSWORD"
echo "(save this somewhere safe!)"
echo ""
echo  "To start the app, run:"
echo "  cd $SCRIPT_DIR && GUARD_VAULT_PASSWORD='$VAULT_PASSWORD' ./start.sh"
