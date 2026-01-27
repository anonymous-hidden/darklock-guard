#!/bin/bash

echo "� Checking Darklock Guard installer files..."
node darklock/check-downloads.js

echo "�🔒 Generating anti-tampering baseline..."
node file-protection/agent/baseline-generator.js

echo "🚀 Starting DarkLock..."
exec node src/bot.js
