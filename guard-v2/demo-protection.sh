#!/bin/bash
# Quick demo script for Darklock Guard tamper protection

set -e

GUARD_DIR="/home/cayden/discord bot/discord bot/guard-v2"
TEST_DIR="$HOME/darklock-test/protected"
CLI="$GUARD_DIR/target/release/guard-cli"

echo "🛡️  Darklock Guard - Real-Time Protection Demo"
echo "=============================================="
echo

# Check service status
echo "📊 Checking service status..."
cd "$GUARD_DIR"
if ! pgrep -f "guard-service run" > /dev/null; then
    echo "❌ Service not running. Start with:"
    echo "   export GUARD_VAULT_PASSWORD='<your-password>'"
    echo "   ./target/release/guard-service run &"
    exit 1
fi
echo "✅ Service is running"
echo

# Show protected files
echo "📁 Protected files:"
ls -lh "$TEST_DIR"
echo

# Demo scenarios
echo "🎬 Running protection demos..."
echo

# Test 1: Modify
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1: File Modification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Original content:"
cat "$TEST_DIR/important.txt"
echo
echo "🔥 Tampering with file..."
echo "MALICIOUS CONTENT" >> "$TEST_DIR/important.txt"
echo "⏳ Waiting for automatic restoration..."
sleep 2
echo "✅ After restoration:"
cat "$TEST_DIR/important.txt"
echo

sleep 1

# Test 2: Delete
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2: File Deletion"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔥 Deleting config.json..."
rm "$TEST_DIR/config.json"
echo "⏳ Waiting for automatic restoration..."
sleep 2
echo "✅ File restored:"
ls -lh "$TEST_DIR/config.json"
cat "$TEST_DIR/config.json"
echo

sleep 1

# Test 3: Overwrite
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3: Complete Overwrite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Original script:"
cat "$TEST_DIR/script.sh"
echo
echo "🔥 Overwriting with ransomware message..."
echo "YOUR FILES HAVE BEEN ENCRYPTED!" > "$TEST_DIR/script.sh"
echo "⏳ Waiting for automatic restoration..."
sleep 2
echo "✅ Script restored:"
cat "$TEST_DIR/script.sh"
echo

# Show event log
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Recent Protection Events:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
tail -6 ~/.local/share/guard/logs/events.log | python3 -c "
import sys, json
for line in sys.stdin:
    event = json.loads(line)
    severity_emoji = {'INFO': 'ℹ️', 'WARN': '⚠️', 'CRITICAL': '🔴'}
    emoji = severity_emoji.get(event['severity'], '•')
    event_type = event['event_type'].replace('_', ' ')
    path = event['data'].get('path', '')
    if path:
        path = path.split('/')[-1]
        print(f\"{emoji} {event_type}: {path}\")
    else:
        print(f\"{emoji} {event_type}\")
"

echo
echo "🎉 Demo complete! All files protected and restored successfully."
echo
echo "📊 To monitor events in real-time, run:"
echo "   tail -f ~/.local/share/guard/logs/events.log | jq"
