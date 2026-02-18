#!/bin/bash
# Real-world tamper protection test for Darklock Guard
set -e

TEST_DIR=~/darklock-test/protected
GUARD_BIN="./target/release/guard-service"

echo "🔒 Darklock Guard Real-World Tamper Test"
echo "=========================================="
echo ""

# Verify files exist
if [ ! -f "$TEST_DIR/important.txt" ]; then
    echo "❌ Test files not found. Run setup first."
    exit 1
fi

echo "📋 Initial file contents:"
echo "  important.txt: $(cat $TEST_DIR/important.txt)"
echo "  config.json: $(cat $TEST_DIR/config.json)"
echo "  baseline-file.txt: $(cat $TEST_DIR/baseline-file.txt)"
echo ""

echo "⏳ Waiting for service to initialize and create baseline..."
echo "   (The service needs to scan files and create backups - wait 10 seconds)"
sleep 10

echo ""
echo "🔥 TEST 1: File Modification Attack"
echo "------------------------------------"
echo "Tampering with important.txt..."
echo "HACKED - This file was modified by an attacker!" > "$TEST_DIR/important.txt"
echo "Modified content: $(cat $TEST_DIR/important.txt)"
echo "Waiting 3 seconds for detection + restore..."
sleep 3

if grep -q "This is my protected document v1" "$TEST_DIR/important.txt"; then
    echo "✅ PASS: File was automatically restored to original content!"
    echo "   Current: $(cat $TEST_DIR/important.txt)"
else
    echo "❌ FAIL: File was not restored"
    echo "   Current: $(cat $TEST_DIR/important.txt)"
fi

echo ""
echo "🔥 TEST 2: File Deletion Attack"
echo "--------------------------------"
echo "Deleting config.json..."
rm -f "$TEST_DIR/config.json"
echo "File deleted: $([ ! -f $TEST_DIR/config.json ] && echo 'YES' || echo 'NO')"
echo "Waiting 3 seconds for detection + restore..."
sleep 3

if [ -f "$TEST_DIR/config.json" ] && grep -q "Secret config data" "$TEST_DIR/config.json"; then
    echo "✅ PASS: Deleted file was automatically restored!"
    echo "   Current: $(cat $TEST_DIR/config.json)"
else
    echo "❌ FAIL: File was not restored"
fi

echo ""
echo "🔥 TEST 3: Content Overwrite Attack"
echo "------------------------------------"
echo "Overwriting baseline-file.txt with malicious content..."
echo "VIRUS PAYLOAD - MALWARE INSTALLED" > "$TEST_DIR/baseline-file.txt"
echo "Malicious content: $(cat $TEST_DIR/baseline-file.txt)"
echo "Waiting 3 seconds for detection + restore..."
sleep 3

if grep -q "Original content" "$TEST_DIR/baseline-file.txt"; then
    echo "✅ PASS: Malicious changes were reverted!"
    echo "   Current: $(cat $TEST_DIR/baseline-file.txt)"
else
    echo "❌ FAIL: File was not restored"
    echo "   Current: $(cat $TEST_DIR/baseline-file.txt)"
fi

echo ""
echo "🔥 TEST 4: Permission Change Attack"
echo "------------------------------------"
ORIGINAL_PERMS=$(stat -c %a "$TEST_DIR/script.sh")
echo "Original permissions: $ORIGINAL_PERMS"
echo "Changing permissions to 777 (world-writable)..."
chmod 777 "$TEST_DIR/script.sh"
NEW_PERMS=$(stat -c %a "$TEST_DIR/script.sh")
echo "Changed permissions: $NEW_PERMS"
echo "Waiting 3 seconds for detection + restore..."
sleep 3

RESTORED_PERMS=$(stat -c %a "$TEST_DIR/script.sh")
if [ "$RESTORED_PERMS" = "$ORIGINAL_PERMS" ]; then
    echo "✅ PASS: Permissions were restored!"
    echo "   Restored to: $RESTORED_PERMS"
else
    echo "⚠️  Warning: Permissions not restored (current: $RESTORED_PERMS)"
    echo "   (Permission restoration may take longer or require audit loop)"
fi

echo ""
echo "======================================"
echo "🎉 Testing Complete!"
echo "======================================"
echo ""
echo "📊 Check service logs for detailed events:"
echo "   tail -f ~/.local/share/darklock-guard/logs/events.log"
echo ""
echo "📦 Check backup store integrity:"
echo "   ls -la ~/.local/share/darklock-guard/backups/"
echo ""
echo "💡 Note: If tests failed, the service may still be:"
echo "   - Creating the initial baseline"
echo "   - Starting the file watcher"
echo "   Try waiting 30s after service start before running tests"
