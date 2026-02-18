#!/bin/bash
# Complete test orchestration for Darklock Guard
# Run this in one terminal, then run ./test-tamper-protection.sh in another

set -e

cd "/home/cayden/discord bot/discord bot/guard-v2"

echo "🔒 Darklock Guard - Real-World Test Runner"
echo "==========================================="
echo ""

# Check if vault exists
if [ ! -f ~/.local/share/darklock-guard/vault.dat ]; then
    echo "❌ Vault not initialized. Running init..."
    ./target/release/guard-service init
    echo ""
fi

# Check if test files exist
if [ ! -f ~/darklock-test/protected/important.txt ]; then
    echo "📝 Creating test files..."
    mkdir -p ~/darklock-test/protected
    cd ~/darklock-test/protected
    echo "This is my protected document v1" > important.txt
    echo "Secret config data" > config.json
    printf '#!/bin/bash\necho "Protected script"\n' > script.sh
    chmod +x script.sh
    echo "Original content" > baseline-file.txt
    echo "✅ Test files created in ~/darklock-test/protected"
    cd -
    echo ""
fi

echo "🚀 Starting Darklock Guard Service..."
echo ""
echo "⏱️  The service will:"
echo "   1. Load vault and settings"
echo "   2. Wait for IPC configuration (protected paths)"
echo "   3. Create baseline of protected files"
echo "   4. Start real-time monitoring"
echo ""
echo "📡 After service starts, run in ANOTHER terminal:"
echo "   cd '/home/cayden/discord bot/discord bot/guard-v2'"
echo "   ./ipc-client.py protect ~/darklock-test/protected"
echo "   ./test-tamper-protection.sh"
echo ""
echo "Press Ctrl+C to stop the service"
echo "----------------------------------------"
echo ""

# Start service with password from environment if set
if [ -z "$GUARD_VAULT_PASSWORD" ]; then
    ./target/release/guard-service run
else
    export GUARD_VAULT_PASSWORD
    ./target/release/guard-service run
fi
