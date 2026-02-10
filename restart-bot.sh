#!/bin/bash
# Quick command to restart bot and register new commands

cd "/home/cayden/discord bot/discord bot"

echo "🔄 Stopping existing bot process..."
pkill -f "node src/bot.js" 2>/dev/null || echo "No existing process found"

echo "⏳ Waiting 2 seconds..."
sleep 2

echo "🚀 Starting bot (commands will auto-register)..."
npm start

# The bot will automatically call registerSlashCommands() on startup
# New commands should appear in Discord within 1-2 minutes
