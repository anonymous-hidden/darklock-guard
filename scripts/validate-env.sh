#!/bin/sh
# Environment validation for Docker startup
# Fails fast on missing REQUIRED variables

set -e

echo "🔍 Validating environment variables..."

# REQUIRED: Core Discord bot configuration
REQUIRED_VARS="DISCORD_TOKEN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET JWT_SECRET AUDIT_ENCRYPTION_KEY"

MISSING=""

for VAR in $REQUIRED_VARS; do
    eval "VALUE=\${$VAR}"
    if [ -z "$VALUE" ]; then
        MISSING="$MISSING $VAR"
    fi
done

if [ -n "$MISSING" ]; then
    echo "❌ FATAL: Missing required environment variables:"
    for VAR in $MISSING; do
        echo "   - $VAR"
    done
    echo ""
    echo "These variables are REQUIRED for the bot to function."
    echo "Please set them in your .env file or docker-compose environment."
    exit 1
fi

echo "✅ All required environment variables present"
exit 0
