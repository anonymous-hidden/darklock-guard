#!/bin/bash
# Auto-update bot status for Pico display
# Run this as a cron job or system service

BOT_DIR="/home/ubuntu/discord-bot"
STATUS_FILE="$BOT_DIR/data/bot_status.json"

while true; do
    # Get guild count from bot logs
    GUILD_COUNT=$(journalctl -u discord-bot -n 100 --no-pager | grep -oP 'Serving \K\d+(?= guilds)' | tail -1)
    
    # If we found a count, write it
    if [ -n "$GUILD_COUNT" ]; then
        echo "{\"online\": true, \"guild_count\": $GUILD_COUNT, \"timestamp\": \"$(date -Iseconds)\"}" > "$STATUS_FILE"
    fi
    
    sleep 5
done
