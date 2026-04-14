#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Darklock Pi5 — Full Deployment Script
#  Run this ON the Pi5 after rsync. Expects to be in /mnt/nvme/discord-bot/
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*"; }

DEPLOY_DIR="/mnt/nvme/discord-bot"
cd "$DEPLOY_DIR"

# ── Step 1: Stop all existing services ──────────────────────────────
log "Stopping all Darklock services..."
SERVICES=(
    darklock-bot darklock-platform darklock-ids darklock-relay
    darklock-notes darklock-hardware darklock-rfid darklock-pico
    discord-bot pico-led-bridge pico-guild-display nova-monitor
)
for svc in "${SERVICES[@]}"; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        sudo systemctl stop "$svc" 2>/dev/null && ok "Stopped $svc" || warn "Could not stop $svc"
    fi
done

# ── Step 2: Install Node.js dependencies ────────────────────────────
log "Installing main project dependencies..."
npm install --production --no-audit --no-fund 2>&1 | tail -3
ok "Main dependencies installed"

# Install Secure Channel IDS dependencies
log "Installing Secure Channel IDS dependencies..."
if [[ -d "secure-channel/services/dl_ids" ]]; then
    cd secure-channel/services/dl_ids
    npm install --production --no-audit --no-fund 2>&1 | tail -3
    cd "$DEPLOY_DIR"
    ok "IDS dependencies installed"
fi

# Install Secure Channel RLY dependencies
log "Installing Secure Channel RLY dependencies..."
if [[ -d "secure-channel/services/dl_rly" ]]; then
    cd secure-channel/services/dl_rly
    npm install --production --no-audit --no-fund 2>&1 | tail -3
    cd "$DEPLOY_DIR"
    ok "RLY dependencies installed"
fi

# Install Darklock Notes server dependencies + build
log "Installing Darklock Notes server dependencies..."
if [[ -d "darklock-notes/apps/server" ]]; then
    cd darklock-notes
    npm install --no-audit --no-fund 2>&1 | tail -3
    cd "$DEPLOY_DIR"
    ok "Notes monorepo dependencies installed"

    log "Building Notes server..."
    cd darklock-notes/apps/server
    npx tsc --build tsconfig.json 2>&1 || {
        warn "TypeScript build had issues, trying alternative..."
        npx tsc 2>&1 || true
    }
    cd "$DEPLOY_DIR"
    if [[ -f "darklock-notes/apps/server/dist/index.js" ]]; then
        ok "Notes server built"
    else
        warn "Notes server dist/index.js not found — check build"
    fi
fi

# ── Step 3: Create fresh .env files ─────────────────────────────────
log "Setting up environment files..."

# IDS .env — fix paths for Pi5
cat > secure-channel/services/dl_ids/.env <<IDSENV
IDS_PORT=4100
IDS_JWT_SECRET=${IDS_JWT_SECRET:-$(openssl rand -hex 64)}
IDS_DB_PATH=/mnt/nvme/discord-bot/secure-channel/services/dl_ids/data/ids.db
NODE_ENV=production
IDSENV
ok "IDS .env created"

# RLY .env — fix paths for Pi5
cat > secure-channel/services/dl_rly/.env <<RLYENV
RLY_PORT=4101
RLY_JWT_SECRET=${RLY_JWT_SECRET:-$(openssl rand -hex 64)}
RLY_DB_PATH=/mnt/nvme/discord-bot/secure-channel/services/dl_rly/data/rly.db
NODE_ENV=production
RLYENV
ok "RLY .env created"

# Notes server .env
cat > darklock-notes/apps/server/.env <<NOTESENV
NODE_ENV=production
PORT=3003
JWT_SECRET=${NOTES_JWT_SECRET:-CHANGE_ME_GENERATE_RANDOM_SECRET}
DUMMY_SALT_KEY=${NOTES_DUMMY_SALT_KEY:-CHANGE_ME_GENERATE_RANDOM_SECRET}
NOTES_APP_URL=https://admin.darklock.net/platform/notes/
NOTES_OAUTH_STATE_SECRET=${NOTES_OAUTH_STATE_SECRET:-CHANGE_ME_GENERATE_RANDOM_SECRET}
NOTES_GOOGLE_CLIENT_ID=${NOTES_GOOGLE_CLIENT_ID:-SET_YOUR_GOOGLE_CLIENT_ID}
NOTES_GOOGLE_CLIENT_SECRET=${NOTES_GOOGLE_CLIENT_SECRET:-SET_YOUR_GOOGLE_CLIENT_SECRET}
NOTES_GOOGLE_REDIRECT_URI=https://admin.darklock.net/api/notes/auth/google/callback
NOTESENV
ok "Notes server .env created"

# Nova monitor .env
cat > scripts/nova-monitor/.env <<NOVAENV
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-sk-ant-api03-PLACEHOLDER}
NOVAENV
ok "Nova .env created (set ANTHROPIC_API_KEY if needed)"

# ── Step 4: Create data directories ─────────────────────────────────
log "Creating data directories..."
mkdir -p secure-channel/services/dl_ids/data
mkdir -p secure-channel/services/dl_rly/data
mkdir -p darklock-notes/apps/server/data
mkdir -p darklock/data
mkdir -p data
mkdir -p logs
ok "Data directories created"

# ── Step 5: Setup Nova monitor Python venv ───────────────────────────
log "Setting up Nova monitor Python environment..."
if [[ -d "scripts/nova-monitor" ]]; then
    cd scripts/nova-monitor
    python3 -m venv venv 2>/dev/null || python3 -m venv --without-pip venv
    source venv/bin/activate
    pip install --quiet -r requirements.txt 2>&1 | tail -3
    deactivate
    cd "$DEPLOY_DIR"
    ok "Nova Python venv created"
fi

# ── Step 6: Install systemd services ────────────────────────────────
log "Installing systemd service files..."

# Darklock Platform (port 3002) — standalone server
sudo tee /etc/systemd/system/darklock-platform.service > /dev/null <<'EOF'
[Unit]
Description=Darklock Platform Server
After=network.target
Wants=network.target

[Service]
Type=simple
User=darklock
WorkingDirectory=/mnt/nvme/discord-bot
EnvironmentFile=/mnt/nvme/discord-bot/.env
ExecStart=/usr/bin/node darklock/start.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=darklock-platform

[Install]
WantedBy=multi-user.target
EOF
ok "darklock-platform.service"

# Discord Bot (port 3001)
sudo tee /etc/systemd/system/darklock-bot.service > /dev/null <<'EOF'
[Unit]
Description=Darklock Discord Bot
After=network.target darklock-platform.service
Wants=darklock-platform.service

[Service]
Type=simple
User=darklock
WorkingDirectory=/mnt/nvme/discord-bot
EnvironmentFile=/mnt/nvme/discord-bot/.env
ExecStart=/usr/bin/node src/bot.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=darklock-bot

[Install]
WantedBy=multi-user.target
EOF
ok "darklock-bot.service"

# Secure Channel IDS (port 4100)
sudo tee /etc/systemd/system/darklock-ids.service > /dev/null <<'EOF'
[Unit]
Description=Darklock Identity Service (IDS)
After=network.target
Wants=network.target

[Service]
Type=simple
User=darklock
WorkingDirectory=/mnt/nvme/discord-bot/secure-channel/services/dl_ids
EnvironmentFile=/mnt/nvme/discord-bot/secure-channel/services/dl_ids/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=darklock-ids

[Install]
WantedBy=multi-user.target
EOF
ok "darklock-ids.service"

# Secure Channel RLY (port 4101)
sudo tee /etc/systemd/system/darklock-relay.service > /dev/null <<'EOF'
[Unit]
Description=Darklock Relay Service (RLY)
After=network.target darklock-ids.service
Wants=darklock-ids.service

[Service]
Type=simple
User=darklock
WorkingDirectory=/mnt/nvme/discord-bot/secure-channel/services/dl_rly
EnvironmentFile=/mnt/nvme/discord-bot/secure-channel/services/dl_rly/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=darklock-relay

[Install]
WantedBy=multi-user.target
EOF
ok "darklock-relay.service"

# Darklock Notes server (port 3003)
sudo tee /etc/systemd/system/darklock-notes.service > /dev/null <<'EOF'
[Unit]
Description=Darklock Secure Notes Server
After=network.target darklock-platform.service
Wants=network.target

[Service]
Type=simple
User=darklock
WorkingDirectory=/mnt/nvme/discord-bot/darklock-notes/apps/server
EnvironmentFile=/mnt/nvme/discord-bot/darklock-notes/apps/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=darklock-notes

[Install]
WantedBy=multi-user.target
EOF
ok "darklock-notes.service"

# Nova Monitor
sudo tee /etc/systemd/system/nova-monitor.service > /dev/null <<'EOF'
[Unit]
Description=Nova AI Monitor — Darklock Service Watchdog
After=network.target darklock-platform.service darklock-bot.service darklock-ids.service darklock-relay.service darklock-notes.service
Wants=network.target

[Service]
Type=simple
User=darklock
WorkingDirectory=/mnt/nvme/discord-bot/scripts/nova-monitor
EnvironmentFile=/mnt/nvme/discord-bot/scripts/nova-monitor/.env
ExecStart=/mnt/nvme/discord-bot/scripts/nova-monitor/venv/bin/python3 nova-monitor.py
Restart=always
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nova-monitor

[Install]
WantedBy=multi-user.target
EOF
ok "nova-monitor.service"

# Remove the duplicate discord-bot.service if it exists
if [[ -f /etc/systemd/system/discord-bot.service ]]; then
    sudo systemctl disable discord-bot.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/discord-bot.service
    ok "Removed duplicate discord-bot.service"
fi

# ── Step 7: Reload systemd and enable services ──────────────────────
log "Reloading systemd daemon..."
sudo systemctl daemon-reload
ok "Daemon reloaded"

log "Enabling all services..."
ENABLE_SERVICES=(
    darklock-platform darklock-bot darklock-ids darklock-relay
    darklock-notes nova-monitor cloudflared
)
for svc in "${ENABLE_SERVICES[@]}"; do
    sudo systemctl enable "$svc" 2>/dev/null && ok "Enabled $svc" || warn "Could not enable $svc"
done

# Also keep hardware services if they exist
for svc in darklock-hardware darklock-rfid pico-led-bridge; do
    if [[ -f "/etc/systemd/system/${svc}.service" ]]; then
        sudo systemctl enable "$svc" 2>/dev/null || true
    fi
done

# ── Step 8: Start services in order ─────────────────────────────────
log "Starting services..."

start_and_wait() {
    local svc=$1
    local wait=${2:-3}
    sudo systemctl start "$svc" 2>/dev/null
    sleep "$wait"
    if systemctl is-active --quiet "$svc"; then
        ok "$svc is running"
    else
        err "$svc failed to start"
        journalctl -u "$svc" -n 5 --no-pager 2>/dev/null
    fi
}

start_and_wait darklock-platform 5
start_and_wait darklock-bot 5
start_and_wait darklock-ids 3
start_and_wait darklock-relay 3
start_and_wait darklock-notes 3
start_and_wait cloudflared 3

# Start hardware services
for svc in darklock-hardware darklock-rfid pico-led-bridge; do
    if [[ -f "/etc/systemd/system/${svc}.service" ]]; then
        start_and_wait "$svc" 2
    fi
done

# Start Nova last (it monitors everything else)
start_and_wait nova-monitor 5

# ── Step 9: Verify everything ────────────────────────────────────────
log "Running health checks..."
echo ""

check_port() {
    local name=$1 port=$2
    if ss -tlnp | grep -q ":${port} "; then
        ok "$name is listening on port $port"
    else
        err "$name is NOT listening on port $port"
    fi
}

check_port "Discord Bot"      3001
check_port "Platform Server"  3002
check_port "Notes Server"     3003
check_port "IDS"              4100
check_port "RLY"              4101
check_port "Nova Health API"  9500

echo ""
log "Checking Cloudflare tunnel..."
if systemctl is-active --quiet cloudflared; then
    ok "Cloudflare tunnel is running"
else
    err "Cloudflare tunnel is NOT running"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Darklock Pi5 deployment complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  Services:"
for svc in darklock-platform darklock-bot darklock-ids darklock-relay darklock-notes nova-monitor cloudflared; do
    status=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    if [[ "$status" == "active" ]]; then
        echo -e "    ${GREEN}●${NC} $svc"
    else
        echo -e "    ${RED}●${NC} $svc ($status)"
    fi
done
echo ""
echo "  URLs:"
echo "    Local:  http://192.168.50.151:3001 (Bot)"
echo "            http://192.168.50.151:3002 (Platform)"
echo "    Public: https://darklock.net"
echo "            https://admin.darklock.net"
echo "            https://platform.darklock.net"
echo "    Nova:   http://192.168.50.151:9500/health"
echo ""
echo "  Management:"
echo "    journalctl -u darklock-bot -f      # Bot logs"
echo "    journalctl -u nova-monitor -f      # Nova logs"
echo "    sudo systemctl restart darklock-bot # Restart a service"
echo ""
