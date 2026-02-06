#!/bin/bash
set -e

echo "🚀 DarkLock Startup Sequence"
echo "=============================="

# Step 1: Validate critical environment variables
echo ""
echo "Step 1/4: Environment validation"
sh scripts/validate-env.sh || exit 1

# Step 2: Check Darklock Guard installer files (optional, warning only)
echo ""
echo "Step 2/4: Checking Darklock Guard installer files (optional)"
node darklock/check-downloads.js || echo "⚠️  Installer check skipped or failed (non-critical)"

# Step 3: Generate anti-tampering baseline
echo ""
echo "Step 3/4: Generating anti-tampering baseline"
node file-protection/agent/baseline-generator.js || {
    echo "⚠️  Baseline generation failed (continuing with existing baseline)"
}

# Step 4: Start the bot
echo ""
echo "Step 4/4: Starting DarkLock bot"
echo "=============================="
exec node src/bot.js
