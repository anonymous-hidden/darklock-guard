#!/bin/sh
set -e

echo "🔒 Generating anti-tampering baseline..."
node file-protection/agent/baseline-generator.js

echo "🚀 Starting DarkLock..."
exec node src/bot.js
