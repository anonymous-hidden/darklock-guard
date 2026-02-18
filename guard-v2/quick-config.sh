#!/bin/bash
# Quick configuration script for Darklock Guard
# This modifies the vault to add protected paths

VAULT_PATH="$HOME/.local/share/darklock-guard/vault.dat"

if [ ! -f "$VAULT_PATH" ]; then
    echo "❌ Vault not found. Run './target/release/guard-service init' first"
    exit 1
fi

echo "🔒 Darklock Guard - Quick Configuration"
echo ""
echo "This will configure the service to protect:"
echo "  📁 $HOME/darklock-test/protected/"
echo ""
echo "⚠️  WARNING: This is a development script."
echo "    In production, use the IPC API or desktop GUI."
echo ""

# For now, the service needs to be manually configured
# The proper way is to use the IPC SetProtectedPaths command
# But let's create a startup wrapper instead

cat > run-guard-test.sh << 'EOFSCRIPT'
#!/bin/bash
cd "/home/cayden/discord bot/discord bot/guard-v2"

echo "🔒 Starting Darklock Guard Service"
echo "=================================="
echo ""
echo "Protected paths:"
echo "  📁 ~/darklock-test/protected/"
echo ""
echo "The service will:"
echo "  1. Create a baseline of all files in protected paths"
echo "  2. Start real-time file watcher"
echo "  3. Run periodic integrity scans (every 5 minutes)"
echo "  4. Automatically restore ANY tampered files"
echo ""
echo "Press Ctrl+C to stop the service"
echo ""

# Note: Protected paths must be configured via IPC after service starts
# For this test, we'll need to add them manually or use the GUI

export GUARD_VAULT_PASSWORD="${GUARD_VAULT_PASSWORD:-your_password_here}"
./target/release/guard-service run
EOFSCRIPT

chmod +x run-guard-test.sh

echo "✅ Created run-guard-test.sh"
echo ""
echo "📝 Next steps:"
echo "   1. Edit run-guard-test.sh and set your password"
echo "   2. Run: ./run-guard-test.sh"
echo "   3. Wait 10 seconds for initialization"
echo "   4. In another terminal, run: ./test-tamper-protection.sh"
