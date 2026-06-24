# DarkLock — Complete Setup & Command Reference

All apps, services, ports, and troubleshooting in one place.

---

## Quick Reference — Ports & URLs

| Service | Port | URL |
|---------|------|-----|
| Discord Bot Dashboard | 3001 | http://localhost:3001 |
| Unified Admin Dashboard | 3001 | http://localhost:3001/admin |
| Darklock Platform API | 3002 | http://localhost:3002 |
| **Room Control Panel** | **3002** | **https://darklock.net/r/\<slug\>** |
| Room Control Bridge (Pico + Govee) | 3099 | localhost only |
| Darklock Notes (dev) | 5173 | http://localhost:5173 |
| Darklock Notes Sync Server | 3003 | http://localhost:3003 |
| Secure Channel IDS | 4100 | http://localhost:4100 |
| Secure Channel Relay | 4101 | http://localhost:4101 |
| Jarvis Nova (FastAPI) | 8950 | http://localhost:8950 |
| Jarvis Desktop (Vite) | 5173 | http://localhost:5173 |
| Ollama (LLM Server) | 11434 | http://localhost:11434 |

---

## ChatGPT Actions API (On-The-Go Health + Info)

You can connect ChatGPT Actions to your DarkLock server and ask for live status.

### Endpoints (token required)

- `GET /api/chatgpt/health` — platform/db/process + live bot runtime snapshot
- `GET /api/chatgpt/services` — reachability of key local services/ports
- `GET /api/chatgpt/status` — one-call consolidated status summary for ChatGPT
- `GET /api/chatgpt/info` — quick links and environment info

### 1) Set token in environment

Add to your server `.env`:

```bash
CHATGPT_ACTIONS_TOKEN=replace_with_a_long_random_token
PUBLIC_BASE_URL=https://darklock.net
```

Then restart the platform service:

```bash
sudo systemctl restart darklock-platform
```

### 2) Test from terminal

```bash
curl -H "Authorization: Bearer $CHATGPT_ACTIONS_TOKEN" \
  https://darklock.net/api/chatgpt/health

curl -H "Authorization: Bearer $CHATGPT_ACTIONS_TOKEN" \
  https://darklock.net/api/chatgpt/services

curl -H "Authorization: Bearer $CHATGPT_ACTIONS_TOKEN" \
  https://darklock.net/api/chatgpt/status

curl -H "Authorization: Bearer $CHATGPT_ACTIONS_TOKEN" \
  https://darklock.net/api/chatgpt/info
```

### 3) Use with ChatGPT Actions

- OpenAPI spec file: `docs/CHATGPT_ACTIONS_OPENAPI.json`
- Server URL in spec: `https://darklock.net/api`
- In ChatGPT Actions, import/paste that OpenAPI schema
- Set auth type to Bearer token and use the same `CHATGPT_ACTIONS_TOKEN`

---

## Start / Stop Everything

```bash
# Start ALL services (bot + platform + guard + secure channel)
cd "/home/cayden/discord bot/discord bot" && ./start-all.sh

# Stop ALL services
cd "/home/cayden/discord bot/discord bot" && ./stop-all.sh
```

**What `start-all.sh` launches:**
1. Discord Bot (port 3001)
2. Darklock Platform Server (port 3002)
3. Secure Channel IDS (port 4100) + Relay (port 4101)
4. Darklock Guard Service daemon + Guard UI (Tauri)
5. Room Control Bridge (localhost:3099) — Pico serial + Govee LAN

---

## App 1 — Discord Bot

Discord security & moderation bot with web dashboard, XP/leveling, tickets, analytics, anti-raid, anti-spam, anti-phishing, and 50+ slash commands.

### Start

```bash
cd "/home/cayden/discord bot/discord bot"

npm start                    # Production
npm run dev                  # Development (auto-restart on file changes)
node start-bot.js            # Alternative (with Pico watchdog support)
./startup.sh                 # Full startup (validates env, generates baseline, starts bot)
```

### Access

- Dashboard: http://localhost:3001
- Admin: http://localhost:3001/admin
- Platform: http://localhost:3001/platform
- API Status: http://localhost:3001/api/status
- Health Check: http://localhost:3001/health

### Environment Setup

```bash
cp .env.example .env
nano .env
```

Required `.env` variables:
```
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
JWT_SECRET=your_jwt_secret
SESSION_SECRET=your_session_secret
PORT=3001
WEB_HOST=0.0.0.0
DB_NAME=security_bot.db
DB_PATH=./data/
```

### First-Time Setup

```bash
npm install
npm run setup                              # Interactive setup wizard
npm run tamper:generate                    # Generate file integrity baseline
```

### Troubleshooting

```bash
# Bot won't start
node --version                             # Needs v18+
npm install                                # Reinstall deps
npm install --legacy-peer-deps             # If peer dep issues
node -c src/bot.js                         # Check syntax errors

# Port 3001 in use
lsof -ti:3001 | xargs kill -9

# Check logs
tail -f logs/combined.log                  # All logs
tail -f logs/error.log                     # Errors only
grep "ERROR" logs/combined.log | tail -20  # Recent errors

# Database issues
npm run db:backup                          # Backup first
npm run db:init                            # Reinitialize

# Clear logs
> I

```

---

## App 2 — Room Control Panel (Hidden)

Hidden page on darklock.net for trusted friends to control your room remotely. Invisible from all public navigation, sitemaps, and search engines. Served under a secret random slug on the same port as the Darklock Platform (3002).

**Features:**
- 250-char one-time-per-IP access passwords (bcrypt-hashed)
- Password is bound to the first IP that redeems it — can't be shared
- Username prompt after auth — every action is logged with IP + username
- **Active buzzer** (loud, capped at 3 seconds)
- **10 passive buzzer songs** via 2 PWM buzzers: `alert, doorbell, jingle, rise, fall, birthday, march, tetris, siren, shave`
- **Govee LAN control** — auto-discovers lights; supports on/off, RGB, brightness, 10 scene presets
- Full action audit log (timestamp, IP, username, action, params)

### Govee Scene Presets

`chill, focus, movie, sunset, forest, party, sleep, cyber, blood, ocean`

### Pico Pin Layout

| Pin | Accessory |
|-----|-----------|
| GP21 | White LED — network heartbeat |
| GP22 | Green LED — reserved |
| GP24 | Blue LED — active buzzer indicator |
| GP25 | Red LED — passive song indicator |
| GP20 | Active buzzer (digital on/off) |
| GP19 | Passive buzzer A (PWM) |
| GP17 | Passive buzzer B (PWM) |

> GP24 / GP25 are not on the standard Pico header. If the blue/red LEDs don't work, remap `PIN_LED_BLUE` / `PIN_LED_RED` in `pico_room_control.py` to GP14 / GP15.

### Flash Pico Firmware

1. Disconnect Pico from Pi5, hold BOOTSEL, connect to a computer with Thonny or `mpremote`
2. Copy `pico_room_control.py` onto the Pico as `main.py`
3. Plug Pico back into Pi5 — bridge auto-reconnects within seconds

```bash
# Verify firmware is running (on Pi5)
journalctl -u darklock-room-bridge --no-pager -n 20
# Look for: [RoomBridge] Pico firmware ready
```

### Admin CLI (Pi5 only)

```bash
ssh darklock@192.168.50.151
cd ~/discord-bot

# Generate a new 250-char password (plaintext shown ONCE, never again)
node darklock/scripts/room-control-cli.js gen
node darklock/scripts/room-control-cli.js gen --label="for Alex"

# List all passwords (no plaintext)
node darklock/scripts/room-control-cli.js list

# Revoke a password by ID (e.g. if IP changes / wrong person got it)
node darklock/scripts/room-control-cli.js revoke 3

# Print the current hidden URL
node darklock/scripts/room-control-cli.js url

# Rotate the URL slug (invalidates all existing bookmarks)
node darklock/scripts/room-control-cli.js rotate-url

# View recent action log
node darklock/scripts/room-control-cli.js logs
node darklock/scripts/room-control-cli.js logs --limit=100
```

### Services (Pi5 systemd)

```bash
# Bridge daemon — Pico serial + Govee LAN discovery
sudo systemctl status darklock-room-bridge
sudo systemctl restart darklock-room-bridge
journalctl -u darklock-room-bridge -f

# Panel is embedded in the platform server
sudo systemctl status darklock-platform
```

### Troubleshooting

```bash
# Bridge not connecting to Pico
ls -la /dev/ttyACM0
journalctl -u darklock-room-bridge -n 30

# Govee lights not discovered — enable "LAN Control" in the Govee Home app
journalctl -u darklock-room-bridge | grep -i govee

# Panel returns bridge_unreachable
curl -H "Authorization: Bearer $(cat data/room-bridge-token.txt)" \
  http://127.0.0.1:3099/health

# Friend's IP changed (mobile hotspot etc.) — revoke their password and gen a new one
node darklock/scripts/room-control-cli.js revoke <id>
node darklock/scripts/room-control-cli.js gen --label="new for them"
```

---

## App 3 — Darklock Platform Server

Web platform for Discord server administration — RBAC, team management, device management, user profiles, downloads.

### Start

```bash
cd "/home/cayden/discord bot/discord bot"

node darklock/start.js                     # Start platform server (port 3002)
```

### Access

- Platform Home: http://localhost:3002
- Admin Dashboard: http://localhost:3002/admin (requires sign-in)
- Sign In: http://localhost:3002/signin

### Admin Commands

```bash
node darklock/create-admin.js              # Create admin user
node darklock/migrate-maintenance.js       # Migrate maintenance mode
node darklock/check-downloads.js           # Check download availability

# Room Control Panel passwords
node darklock/scripts/room-control-cli.js gen [--label=...]
node darklock/scripts/room-control-cli.js list
node darklock/scripts/room-control-cli.js revoke <id>
node darklock/scripts/room-control-cli.js url
node darklock/scripts/room-control-cli.js logs
```

### Environment

- `DARKLOCK_PORT=3002` (or uses `PORT` on Render)
- Uses Discord OAuth from main bot `.env`

### Troubleshooting

```bash
# Port 3002 in use
lsof -ti:3002 | xargs kill -9

# Check logs
tail -f logs/darklock-startup.log
```

---

## App 4 — Jarvis Nova (AI Assistant)

Personal AI assistant with emotional engine, persistent memory, command execution, project indexing, Google Calendar/Docs, smart home (Govee), and health monitoring. Python FastAPI backend + Electron desktop frontend.

### Start — Backend (FastAPI on port 8950)

```bash
cd ~/discord\ bot/discord\ bot/jarvis
source .venv/bin/activate
python3 main.py

# Or use the bundled start script:
./start.sh                                 # Activates venv, starts Ollama, runs server
```

### Start — Frontend (Electron + Vite on port 5173)

```bash
cd ~/discord\ bot/discord\ bot/jarvis/desktop
npm run dev
```

### First-Time Setup

```bash
cd jarvis

# Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Electron frontend
cd desktop && npm install

# Ollama (required)
ollama serve                               # Start LLM server
ollama pull qwen2.5:32b                    # Deep reasoning model
ollama pull llama3.1:8b                    # Fast response model

# Google integration (optional)
python -m integrations.google_auth         # Setup Google OAuth
```

### Environment

Create `jarvis/.env` from `jarvis/.env.example`:
```
GOVEE_API_KEY=...          # Smart lights (optional)
OPENWEATHER_API_KEY=...    # Weather (optional)
JARVIS_API_KEY=...         # Remote API access (optional)
```

### AI Models

| Model | Role | Size | Used When |
|-------|------|------|-----------|
| qwen2.5:32b | Deep | 19 GB | Complex reasoning, code, analysis |
| llama3.1:8b | Fast | 4.9 GB | Quick replies, simple tasks |
| llama3.2:3b | Light | 2.0 GB | Available as fallback |

### Troubleshooting

```bash
# Ollama not running
ollama serve                               # Start it
curl http://localhost:11434                 # Verify

# Models not installed
ollama list                                # Check available
ollama pull qwen2.5:32b                    # Install missing

# Python venv issues
python3 -m venv .venv --clear              # Recreate venv
source .venv/bin/activate
pip install -r requirements.txt

# Port 8950 in use
lsof -ti:8950 | xargs kill -9
```

---

## App 5 — Nova Terminal (AI Terminal v2)

Nova-grade terminal AI with web browsing, persistent memory, auto model routing, Nova identity, weather, system tools, and agent tool loop. Can actually search the web, read pages, click links, and research topics autonomously.

### Start

```bash
cd "/home/cayden/discord bot/discord bot"

python3 ai-terminal.py   # Default model (qwen2.5:32b)
python3 ai-terminal.py llama3.1:8b         # Start with specific model
python3 ai-terminal.py llama3.2:3b         # Lightweight model

./nova-widget nova-chat
./nova-widget spotify
./nova-widget notes

fix try t 
- **Tool Loop** — AI uses tools, gets results back, then uses more tools until done (up to 6 rounds)
- **Persistent Memory** — SQLite memory at `~/.ai-terminal/memory.db` with auto-extraction
- **Auto Model Routing** — Simple messages → fast model, complex → deep model
- **Nova Identity** — JARVIS-to-Stark personality with date/time awareness
- **3 Personality Modes** — casual, formal, concise
- **Reasoning Mode** — `<thinking>` tag support with silent buffering

### In-App Commands

| Command | Description |
|---------|-------------|
| **Core** | |
| `/model <name>` | Switch model |
| `/models` | List all available models |
| `/auto` | Toggle auto model routing |
| `/clear` | Clear conversation |
| `/temp <0-2>` | Set temperature |
| **Modes** | |
| `/think` | Toggle reasoning mode |
| `/agent` | Toggle agent tools |
| **Memory** | |
| `/remember key = value` | Save to memory |
| `/recall <query>` | Search memories |
| `/memories` | Show all memories |
| `/forget <key>` | Delete a memory |
| `/profile` | Show user profile |
| **Tools** | |
| `/time` | Current date & time |
| `/weather` | Current weather |
| `/sys` | System stats (CPU, RAM, disk) |
| `/search <query>` | Search the web |
| `/browse <url>` | Read a web page |
| `/links` | Show links from last page |
| `/browser` | Nova browser bridge status |
| **Session** | |
| `/persona <mode>` | Change personality (casual/formal/concise) |
| `/config` | Show config |
| `/copy` | Copy last response |
| `/save` | Save conversation |
| `/stats` | Token stats |
| `/exit` | Quit |

### Agent Tools (AI can use these automatically)

| Tool | What it does |
|------|-------------|
| `SEARCH: query` | Search the web, returns numbered results |
| `BROWSE: url` | Fetch and read a web page |
| `CLICK: number` | Follow a numbered link from current page |
| `READ_MORE:` | Read more content from current page |
| `OPEN_URL: url` | Open URL in user's browser |
| `RUN_CMD: command` | Run shell command (user confirms) |
| `REMEMBER: key = value` | Save to persistent memory |
| `RECALL: query` | Look up from memory |
| `WEATHER:` | Get current weather |
| `SYSTEM_INFO:` | Get system stats |

### Config

Stored at `~/.ai-terminal/config.json`. Key settings:
- `default_model` / `fast_model` — models for auto-routing
- `owner` / `ai_name` — identity (default: Cayden / Nova)
- `personality` — casual, formal, or concise
- `weather_api_key` — OpenWeather API key (or set `OPENWEATHER_API_KEY` env var)

### Prerequisites

- Ollama running (`ollama serve`)
- Python packages: `rich`, `prompt_toolkit`, `requests`, `beautifulsoup4`, `lxml`

### Troubleshooting

```bash
# Can't connect to Ollama
ollama serve                               # Start it
curl http://localhost:11434                 # Verify

# Missing Python packages
pip3 install --user --break-system-packages rich prompt_toolkit requests beautifulsoup4 lxml
```

---

## App 6 — Darklock Guard (Tauri + Rust)

Desktop security app — hardware-backed vault for secrets & encryption keys, tamper protection, file integrity monitoring.

### Start — Pre-Built Binary (Fast)

```bash
export GUARD_VAULT_PASSWORD=your_password
"/home/cayden/discord bot/discord bot/guard-v2/target/debug/guard-service" run &
"/home/cayden/discord bot/discord bot/guard-v2/target/debug/darklock-guard-ui" &
```

### Start — Dev Mode (Tauri Hot-Reload)

```bash
cd "/home/cayden/discord bot/discord bot/guard-v2/desktop"
npm install                                # First time only
npx tauri dev
```

### Build Binary

```bash
cd "/home/cayden/discord bot/discord bot/guard-v2"
cargo build                                # Debug build
cargo build --release                      # Release build
```

### Environment

- `GUARD_VAULT_PASSWORD` — **Required** to start the guard service

### Security Modes

- **Normal Mode** — Balanced protection for everyday use
- **Strict Mode** — Maximum security, requires password on every app launch
  - Enable: Settings → Security Mode → Strict → Create password
  - Disable: Settings → Security Mode → Normal → Enter password

### Troubleshooting

```bash
# Binary not found — build it first
cd guard-v2 && cargo build

# Rust not installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Linux build deps
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev

# GUARD_VAULT_PASSWORD not set
export GUARD_VAULT_PASSWORD=your_password
```

---

## App 7 — Darklock Secure Channel (E2E Encrypted Messenger)

End-to-end encrypted messenger using Signal protocol (X3DH + Double Ratchet). Electron desktop app with IDS (identity/key server) and RLY (message relay) backend services.

### Start — Full Stack (Recommended)

Username: ridgeline.user.one
Password: RidgelineTest!2026A
Username: ridgeline.user.two
Password: RidgelineTest!2026B


```bash
cd "/home/cayden/discord bot/discord bot/secure-channel"

# Rebuild native modules (do this if you see segfaults)
npm rebuild better-sqlite3

# Kill any zombie processes
lsof -ti:4101 | xargs kill -9 2>/dev/null

# Start backend services
node services/dl_ids/src/server.js > /tmp/dl-ids.log 2>&1 &
node services/dl_rly/src/server.js > /tmp/dl-rly.log 2>&1 &

# Start desktop app
 cd apps/dl-secure-channel && npm run dev
```

### Start — Services Only (Background)

```bash
cd "/home/cayden/discord bot/discord bot/secure-channel"

# IDS — Identity & Key Distribution Service (port 4100)
cd services/dl_ids && npm start

# RLY — Message Relay Service (port 4101)
cd services/dl_rly && npm start
```

### Start — Desktop App Only

```bash
cd "/home/cayden/discord bot/discord bot/secure-channel/apps/dl-secure-channel"
npm run dev                                # Development (Vite + Electron)
```

### Build Production Binary

```bash
cd "/home/cayden/discord bot/discord bot/secure-channel/apps/dl-secure-channel"
npm run package:linux                      # Linux
npm run package:win                        # Windows
npm run package:mac                        # macOS
npm run package:all                        # All platforms
```

### Health Check

```bash
curl -s http://localhost:4100/health       # IDS
curl -s http://localhost:4101/health       # Relay
```

### Known Issue — better-sqlite3 Segfaults

This happens because the Electron app build overwrites the native `better-sqlite3` binary. Fix:
```bash
cd "/home/cayden/discord bot/discord bot/secure-channel"
npm rebuild better-sqlite3
lsof -ti:4101 | xargs kill -9 2>/dev/null
node services/dl_ids/src/server.js > /tmp/dl-ids.log 2>&1 &
node services/dl_rly/src/server.js > /tmp/dl-rly.log 2>&1 &
```

### Troubleshooting

```bash
# Port 4100/4101 already in use
lsof -ti:4100 | xargs kill -9 2>/dev/null
lsof -ti:4101 | xargs kill -9 2>/dev/null

# Port 5173 (Vite) in use
lsof -ti:5173 | xargs kill -9 2>/dev/null

# Check service logs
cat /tmp/dl-ids.log
cat /tmp/dl-rly.log
```

---

## App 9 — Darklock App (Encrypted Desktop Messenger)

Zero-knowledge encrypted desktop messenger with Express/WebSocket backend. Separate from Secure Channel — uses electron-vite.

### Start

```bash
cd "/home/cayden/discord bot/discord bot/darklock-app"

npm run dev                                # Electron app (dev mode)
npm run dev:server                         # Server + Electron together
npm run server:dev                         # Server only (dev)
```

### Build

```bash
cd "/home/cayden/discord bot/discord bot/darklock-app"
npm run build                              # Build + package with electron-builder
```

---

## App 10 — Jarvis Calendar App (Desktop)

Desktop calendar app synced with Google Calendar. Electron + React + Vite.

### Start

```bash
cd ~/discord\ bot/discord\ bot/jarvis/calendar-app
npm install                                # First time
npm run dev                                # Vite + Electron
```

### Build

```bash
npm run build                              # Production build
```

---

## App 11 — Pico Hardware Watchdog (MicroPython)

Runs on a Raspberry Pi Pico — monitors server health, controls status LEDs, sends Discord webhook alerts on failure. Independent from the main system.

### Files (Upload to Pico)

- `main.py` — Health check loop
- `config.py` — Wi-Fi, URLs, GPIO pins
- `state.py` — State machine (OK → DEGRADED → FAIL)
- `network.py` — Wi-Fi / ESP8266 AT network manager

### Pico LED Bridge (Runs on Host)

```bash
cd "/home/cayden/discord bot/discord bot"

npm run start:portable                     # Bot + Pico LED bridge
npm run start:bridge                       # Bridge only
```

### Flash MicroPython

1. Download UF2 from https://micropython.org/download/rp2-pico/
2. Hold BOOTSEL, connect Pico via USB
3. Drag-and-drop UF2 onto the Pico drive

### Configuration

Edit `config.py` on the Pico:
- `WIFI_SSID` / `WIFI_PASSWORD`
- `HEALTH_URL` — Server health endpoint
- `WEBHOOK_URL` — Discord webhook for alerts
- `GPIO_FAIL_PIN` (default GP15), `GPIO_OK_PIN` (default GP14)

---

## Cloudflare Worker (Fallback Proxy)

Sits in front of Cloudflare Tunnel — proxies requests when origin is up, shows "Servers Offline" page when origin is down.

### Deploy

```bash
cd "/home/cayden/discord bot/discord bot/cloudflare-worker"
wrangler deploy
```

---

## Database Management

```bash
cd "/home/cayden/discord bot/discord bot"

npm run db:backup                          # Backup database
npm run db:restore                         # Restore from backup
npm run db:init                            # Initialize fresh database
npm run db:migrate                         # Run migrations

node check-admin-db.js                     # Check admin DB
node fix-database-schema.js                # Fix schema issues
node migrate-xp-db.js                      # Migrate XP database
```

### Database Files

| File | Purpose |
|------|---------|
| `data/security_bot.db` | Main bot database (90+ tables) |
| `data/xp.db` | XP/leveling data |
| `data/darklock.db` | Platform auth & admin |
| `jarvis/data/nova.db` | Jarvis AI memory & state |

---

## Security & Auth Commands

```bash
cd "/home/cayden/discord bot/discord bot"

# Anti-Tampering
npm run tamper:generate                    # Generate integrity baseline
npm run tamper:test                        # Test file integrity

# Security Audits
npm run security:audit                     # Run audit
npm run security:fix                       # Auto-fix vulnerabilities

# RBAC
node init-rbac.js                          # Initialize RBAC
node drop-and-init-rbac.js                 # Reset RBAC (destructive)

# 2FA
node migrate-2fa.js                        # Migrate 2FA system
node check-2fa-status.js                   # Check 2FA status

# Auth
node update-auth.js                        # Update auth system
```

---

## User Management Commands

```bash
cd "/home/cayden/discord bot/discord bot"

# Create users
node create-admin-user.js                  # Interactive admin creation
node create-darklock-user.js               # Platform user
node create-owner-account.js               # Owner account
node darklock/create-admin.js              # Darklock platform admin

# Modify roles
node set-owner-role.js                     # Set owner role
node upgrade-admin-role.js                 # Upgrade to admin

# Reset passwords
node reset-admin.js                        # Reset admin password
node update-admin-password.js              # Update password
node hash-password.js                      # Generate password hash
```

---

## Testing Commands

```bash
cd "/home/cayden/discord bot/discord bot"

npm test                                   # Run all tests
node tests/smoke-tests.js                  # Quick smoke tests
node healthcheck.js                        # Health check

# File integrity
node file-protection/test.js               # Standard integrity test
node file-protection/test-live.js          # Live monitoring
npm run tamper:test                        # Test against baseline

# Tamper detection
node test-tamper-attack.js                 # Test attack detection
node test-manual-tamper.js                 # Manual tamper test
node test-live-tamper-demo.js              # Live demo

# Platform
node test-platform.js                      # Platform tests
node test-platform-route.js                # Route tests

# Security
node test-password.js                      # Password hashing
node test-phishing-detection.js            # Phishing detection
```

---

## Monitoring & Logs

```bash
cd "/home/cayden/discord bot/discord bot"

# Real-time logs
tail -f logs/combined.log                  # All logs
tail -f logs/error.log                     # Errors only

# Search logs
grep "ERROR" logs/combined.log | tail -20  # Recent errors
grep "keyword" logs/combined.log           # Search by keyword

# Service-specific logs
cat logs/bot-startup.log                   # Bot startup
cat logs/darklock-startup.log              # Platform startup
journalctl -u darklock-room-bridge -f      # Room Control Bridge (Pi5)
cat logs/guard-service.log                 # Guard service
cat logs/dl-ids.log                        # Secure Channel IDS
cat logs/dl-rly.log                        # Secure Channel Relay
cat /tmp/dl-ids.log                        # IDS (if started manually)
cat /tmp/dl-rly.log                        # Relay (if started manually)

# Clear logs
> logs/combined.log && > logs/error.log

# Health checks
node healthcheck.js
curl http://localhost:3001/health
curl http://localhost:4100/health
curl http://localhost:4101/health
```

---

## Process Management

```bash
# Check what's running
ps aux | grep node
ps aux | grep python
ps aux | grep guard

# Check port usage
lsof -i :3001                              # Bot dashboard
lsof -i :3002                              # Darklock platform
lsof -i :3099                              # Room Control Bridge
lsof -i :4100                              # Secure Channel IDS
lsof -i :4101                              # Secure Channel Relay
lsof -i :5173                              # Vite dev server
lsof -i :8950                              # Jarvis
lsof -i :11434                             # Ollama

# Kill by port
lsof -ti:3001 | xargs kill -9             # Free port 3001
lsof -ti:3002 | xargs kill -9             # Free port 3002
lsof -ti:5173 | xargs kill -9             # Free port 5173

# Kill by name
pkill -f "node src/bot.js"                # Kill bot
pkill -f "node darklock/start.js"         # Kill platform
pkill -f "room-control-bridge"            # Kill room control bridge
pkill -f "guard-service"                  # Kill guard
pkill -f "electron"                       # Kill Electron apps
```

---

## Running in Background

### systemd (Recommended for Production)

Create `/etc/systemd/system/discord-bot.service`:
```ini
[Unit]
Description=DarkLock Discord Bot
After=network.target

[Service]
Type=simple
User=cayden
WorkingDirectory=/home/cayden/discord bot/discord bot
ExecStart=/usr/bin/node src/bot.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-bot
sudo systemctl start discord-bot
sudo systemctl status discord-bot
sudo journalctl -u discord-bot -f          # View logs
```

### PM2

```bash
npm install -g pm2
pm2 start src/bot.js --name discord-bot
pm2 startup && pm2 save
pm2 logs discord-bot
pm2 restart discord-bot
```

### screen

```bash
screen -S discord-bot
npm start
# Detach: Ctrl+A, D
# Reattach: screen -r discord-bot
```

---

## Docker Deployment

```bash
docker-compose up                          # Start with docker-compose
# Or:
docker build -t darklock:latest .
docker run -p 3001:3001 -p 3002:3002 darklock:latest
```

- Ports: 3001 (dashboard), 3002 (platform)
- Health check: `healthcheck.js`
- Non-root user, 1GB memory limit, 2 CPU cores

---

## Render.com Deployment

```bash
npm run start:render                       # Start for Render
```

Config: `render.yaml`

---

## Raspberry Pi Setup

```bash
cd "/home/cayden/discord bot/discord bot"

# Installation
chmod +x install-pi5.sh quickstart-pi5.sh
./install-pi5.sh                           # Full Pi 5 install
./quickstart-pi5.sh                        # Quick start

# Hardware
python3 hardware_controller.py             # Watchdog controller
python3 test_lcd.py                        # Test LCD

# Cloudflare Tunnel
./setup_cloudflare_tunnel.sh               # Setup tunnel
./install_tunnel_on_pi.sh                  # Install on Pi
./test_tunnel.sh                           # Test connection

# Network fixes
./fix_pi_network.sh                        # Fix network
./quick_dns_fix.sh                         # Fix DNS

# Bot management
./restart-bot.sh                           # Restart bot
./diagnose_bot.sh                          # Diagnose issues
./check_bot_on_pi.sh                       # Check status
```

---

## Git Operations

```bash
cd "/home/cayden/discord bot/discord bot"
chmod +x git-push.sh
./git-push.sh
```

---

## Prerequisites Summary

| Component | Required For |
|-----------|-------------|
| Node.js v18+ | All Node apps (bot, platform, desktop apps) |
| npm v8+ | Package management |
| Python 3.10+ | Jarvis, AI Terminal, hardware scripts |
| Rust + Cargo | Guard v2, Darklock Notes desktop, Secure Channel |
| Ollama | Jarvis, AI Terminal |
| Linux webkit deps | All Tauri apps |

### Install Rust + Tauri Dependencies (One-Time)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

### Install Ollama (One-Time)

```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull qwen2.5:32b
ollama pull llama3.1:8b
ollama pull llama3.2:3b
```

---

## File Structure

```
discord bot/
├── src/                        # Discord Bot source
│   ├── bot.js                  # Main entry point
│   ├── commands/               # 50+ slash commands
│   ├── events/                 # Discord event handlers
│   ├── dashboard/              # Web dashboard (port 3001)
│   ├── database/               # SQLite management
│   ├── security/               # 14 security modules
│   ├── systems/                # Rank, XP, tickets
│   └── utils/                  # Managers & helpers
├── darklock/                   # Darklock Platform (port 3002)
│   ├── server.js / start.js    # Platform server
│   ├── routes/                 # API routes
│   │   └── room-control.js     # Hidden room control panel (/r/<slug>)
│   ├── scripts/
│   │   └── room-control-cli.js # Admin CLI: gen/list/revoke/url/logs
│   ├── services/
│   │   ├── room-control-bridge.js  # localhost:3099 Pico + Govee bridge
│   │   └── govee-lan.js            # Govee LAN UDP client
│   ├── utils/
│   │   └── room-control-store.js   # DB schema + password/session helpers
│   ├── views/                  # Dashboard templates
│   └── admin-v4/               # Enterprise RBAC admin
├── jarvis/                     # Jarvis AI Assistant
│   ├── main.py                 # FastAPI backend (port 8950)
│   ├── start.sh                # Start script
│   ├── desktop/                # Electron + Vite frontend
│   ├── calendar-app/           # Calendar Electron app
│   ├── core/                   # AI engine, identity, personality
│   ├── memory/                 # Persistent memory system
│   ├── security/               # Guardian, integrity
│   ├── commands/               # Command registry
│   └── integrations/           # Google, Govee, Spotify, etc.
├── secure-channel/             # E2E Encrypted Messenger
│   ├── apps/dl-secure-channel/ # Electron frontend
│   ├── services/dl_ids/        # Identity server (port 4100)
│   └── services/dl_rly/        # Relay server (port 4101)
├── darklock-notes/             # Encrypted Notes (Tauri v2)
│   ├── apps/desktop/           # Tauri desktop app
│   ├── apps/web/               # React web app
│   ├── apps/server/            # Sync server (port 3003)
│   └── packages/               # crypto + ui libraries
├── darklock-app/               # Encrypted Messenger (electron-vite)
├── guard-v2/                   # Security Guard (Tauri + Rust)
│   ├── guard-core/             # Core Rust library
│   ├── guard-service/          # Background daemon
│   ├── guard-cli/              # CLI tool
│   └── desktop/                # Tauri frontend
├── file-protection/            # Anti-tampering system
├── cloudflare-worker/          # Fallback proxy worker
├── pico_room_control.py        # Pico Room Control firmware (flash as main.py)
├── ai-terminal.py              # Terminal AI chat
├── data/                       # Databases & backups
├── logs/                       # Application logs
├── scripts/                    # Utility scripts
├── tests/                      # Test suite
├── .env                        # Environment config (don't commit)
├── config.json                 # Bot configuration
├── package.json                # Root npm scripts
├── start-all.sh                # Start everything
└── stop-all.sh                 # Stop everything
```

---

## API Endpoints

### Bot API (port 3001)

```
GET  /health                   Health check
GET  /api/status               Bot status
GET  /api/me                   Current user info
GET  /api/guilds               User's guilds
GET  /api/guild/:id            Guild details
GET  /api/guild/:id/config     Guild configuration
POST /api/guild/:id/config     Update guild config
GET  /api/dashboard            Dashboard data
GET  /api/admin/dashboard      Admin dashboard data
POST /api/admin/action/:type   Quick admin actions
```

### Platform API (port 3002)

```
POST /api/auth/login           User login
POST /api/auth/register        User registration
POST /api/auth/logout          User logout
GET  /api/devices              List devices
GET  /api/device/:id           Device details
POST /api/device/:id/action    Device action
GET  /api/downloads            Available downloads
GET  /api/admin/*              Admin endpoints
```

### Room Control Panel (port 3002, hidden slug)

```
GET  /r/<slug>                           Password entry page
POST /r/<slug>/auth                      Authenticate with 250-char password
GET  /r/<slug>/setup                     Username form
POST /r/<slug>/setup                     Set username for session
GET  /r/<slug>/panel                     Control panel UI
POST /r/<slug>/logout                    Invalidate session

POST /r/<slug>/api/buzzer/active         { ms }             — active buzzer (50–3000ms)
POST /r/<slug>/api/buzzer/active/stop                       — stop active buzzer
POST /r/<slug>/api/buzzer/song           { name }           — play passive-buzzer song
POST /r/<slug>/api/buzzer/song/stop                         — stop song
GET  /r/<slug>/api/lights                                   — list Govee devices
POST /r/<slug>/api/lights/refresh                           — rescan LAN
POST /r/<slug>/api/lights/power          { on, device? }    — power on/off
POST /r/<slug>/api/lights/color          { r, g, b, device? } — set RGB
POST /r/<slug>/api/lights/brightness     { value, device? } — brightness 1–100
POST /r/<slug>/api/lights/scene          { scene, device? } — mood preset
```

### Jarvis API (port 8950)

```
GET  /health                   Health check
WS   /ws                       WebSocket chat (streaming)
POST /api/tts                  Text-to-speech
POST /api/stt                  Speech-to-text
```
