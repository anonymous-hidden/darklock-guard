# DarkLock - Complete Setup & Command Guide

Discord security and moderation bot with dashboard, analytics, ticket system, leveling, and Darklock Guard platform.

---

## 🚀 ONE-COMMAND START - Everything at Once!

**Start ALL services with ONE command:**

```bash
cd "/home/cayden/discord bot/discord bot" && ./start-all.sh
```

**Stop everything:**
```bash
cd "/home/cayden/discord bot/discord bot" && ./stop-all.sh
```

**What starts:**
- ✅ Discord Bot (port 3001)
- ✅ Darklock Platform Server (port 3002)
- ✅ Darklock Guard Service + App (Tauri)
- ✅ Darklock Secure Channel — IDS (port 4100) + RLY (port 4101) + Tauri app

---

## ⚡ All-in-One Commands — Per App

### 1. Discord Bot only
```bash
cd "/home/cayden/discord bot/discord bot" && npm start
```
> Development mode (auto-restart on file change):
```bash
cd "/home/cayden/discord bot/discord bot" && npm run dev
```

### 2. Darklock Platform Server only (port 3002)
```bash
cd "/home/cayden/discord bot/discord bot" && node darklock/start.js
```

### 3. Darklock Guard — daemon + UI (Tauri)
> Pre-built binary (fast, no recompile):
```bash
export GUARD_VAULT_PASSWORD=darklock2026
"/home/cayden/discord bot/discord bot/guard-v2/target/debug/guard-service" run &
"/home/cayden/discord bot/discord bot/guard-v2/target/debug/darklock-guard-ui" &
```
> First-time build / dev mode:
```bash
cd "/home/cayden/discord bot/discord bot/guard-v2/desktop" && npm install && npx tauri dev
```
> Build the binary once:
```bash
cd "/home/cayden/discord bot/discord bot/guard-v2" && cargo build
```

### 4. Darklock Secure Channel — all three parts
> Run each in a separate terminal tab:
```bash
# Terminal 1 — IDS (Identity & Key Distribution, port 4100)
cd "/home/cayden/discord bot/discord bot/secure-channel/services/dl_ids" && npm install && node src/server.js

# Terminal 2 — RLY (Message Relay, port 4101)
cd "/home/cayden/discord bot/discord bot/secure-channel/services/dl_rly" && npm install && node src/server.js

# Terminal 3 — Tauri app (hot-reload dev)
cd "/home/cayden/discord bot/discord bot/secure-channel/apps/dl-secure-channel" && npm install && npm run tauri dev
```
> Or start IDS + RLY in the background then launch the app:
```bash
cd "/home/cayden/discord bot/discord bot/secure-channel/services/dl_ids" && node src/server.js >> /tmp/ids.log 2>&1 &
cd "/home/cayden/discord bot/discord bot/secure-channel/services/dl_rly" && node src/server.js >> /tmp/rly.log 2>&1 &
cd "/home/cayden/discord bot/discord bot/secure-channel/apps/dl-secure-channel" && npm run tauri dev
```
> Check IDS + RLY health:
```bash
curl -s http://localhost:4100/health && curl -s http://localhost:4101/health
```
> **First-time Rust setup (required once):**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Access URLs:**
- **Unified Admin Dashboard**: http://localhost:3001/admin (⭐ NEW - All admin functions in one place)
- Dashboard: http://localhost:3001
- Platform: http://localhost:3001/platform
- Darklock API: http://localhost:3002
- Darklock Guard Desktop: Launch via Tauri app

---

## 🎯 Unified Admin Dashboard

**NEW**: All admin functionality consolidated at **http://localhost:3001/admin**

**Features**:
- 📊 **Real-time Overview**: Bot, Platform, and Guard stats in one view
- 🤖 **Bot Management**: Discord bot dashboard embedded
- 🌐 **Platform Admin**: User and device management
- 🛡️ **Guard Monitoring**: Darklock Guard device tracking
- 👥 **User Management**: Centralized user administration
- 📈 **Analytics**: Combined reports and insights
- ⚙️ **Settings**: System-wide configuration
- 📝 **Activity Logs**: Unified audit trail

**Quick Actions**:
- Broadcast messages across all servers
- Database backups
- Clear caches
- Restart services

All previous admin URLs redirect to the unified dashboard:
- `http://localhost:3002/admin` → `http://localhost:3001/admin`
- `http://localhost:3002/admin/v3` → `http://localhost:3001/admin`
- `http://localhost:3001/platform/admin` → Embedded in unified dashboard

---

## 🌐 Complete URLs & Endpoints Reference

### Local Development URLs
- **🎯 Unified Admin Dashboard**: http://localhost:3001/admin **(NEW - All admin in one place)**
- **Main Dashboard**: http://localhost:3001
- **Bot API**: http://localhost:3001/api
- **Discord OAuth Callback**: http://localhost:3001/auth/discord/callback
- **Platform Home**: http://localhost:3001/platform
- **Platform Dashboard**: http://localhost:3001/platform/dashboard
- **Platform Login**: http://localhost:3001/platform/auth/login
- **Platform Signup**: http://localhost:3001/platform/auth/signup
- **Platform Profile**: http://localhost:3001/platform/profile
- **Platform Admin** (legacy): http://localhost:3001/platform/admin → Redirects to unified admin
- **Darklock Guard Download**: http://localhost:3001/platform/download/darklock-guard
- **Darklock Guard Launch**: http://localhost:3001/platform/launch/darklock-guard
- **Darklock Guard Monitor**: http://localhost:3001/platform/monitor/darklock-guard
- **Darklock API Server**: http://localhost:3002
- **Darklock Admin v4**: http://localhost:3002/admin (Enterprise RBAC Dashboard - requires signin)
- **Darklock Admin Signin**: http://localhost:3002/signin
- **Health Check Endpoint**: http://localhost:3001/health
- **API Status**: http://localhost:3001/api/status
- **User Info**: http://localhost:3001/api/me

### Network Access (replace YOUR_IP with your machine's IP)
- **Dashboard (LAN)**: http://YOUR_IP:3001
- **Platform (LAN)**: http://YOUR_IP:3001/platform
- **Darklock API (LAN)**: http://YOUR_IP:3002

### Discord URLs
- **Discord Developer Portal**: https://discord.com/developers/applications
- **Bot Invite URL Template**: https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
- **OAuth2 Authorization**: https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3001/auth/discord/callback&response_type=code&scope=identify%20guilds

### Production/Deployment URLs (if applicable)
- **Render Deployment**: https://your-app-name.onrender.com
- **Cloudflare Tunnel**: Your configured tunnel URL
- **Pi Deployment**: Your Raspberry Pi's public IP or domain

### External Services
- **VirusTotal API**: https://www.virustotal.com/gui/home/upload
- **URLVoid API**: https://www.urlvoid.com/
- **Google Safe Browsing**: https://safebrowsing.google.com/
- **Discord API**: https://discord.com/api/v10
- **Discord Gateway**: wss://gateway.discord.gg

### Documentation & Resources
- **Node.js Documentation**: https://nodejs.org/en/docs/
- **npm Registry**: https://www.npmjs.com/
- **Discord.js Guide**: https://discordjs.guide/
- **Discord Developer Docs**: https://discord.com/developers/docs/intro
- **MicroPython Download**: https://micropython.org/download/rp2-pico/
- **Tauri Documentation**: https://tauri.app/
- **Rust Documentation**: https://www.rust-lang.org/

### WebSocket Endpoints
- **Discord Gateway**: wss://gateway.discord.gg/?v=10&encoding=json
- **Platform WebSocket** (if enabled): ws://localhost:3002/ws

### API Endpoints (Bot)
```
GET  /api/status              - Bot status
GET  /api/health              - Health check
GET  /api/me                  - Current user info
GET  /api/guilds              - User's guilds
GET  /api/guild/:id           - Guild details
GET  /api/guild/:id/config    - Guild configuration
GET  /api/admin/dashboard     - Unified admin dashboard data (NEW)
POST /api/admin/action/:type  - Quick admin actions (NEW)
POST /api/guild/:id/config    - Update guild config
GET  /api/dashboard           - Dashboard data
```

### API Endpoints (Darklock Platform)
```
POST /api/auth/login          - User login
POST /api/auth/register       - User registration
POST /api/auth/logout         - User logout
GET  /api/devices             - List devices
GET  /api/device/:id          - Device details
POST /api/device/:id/action   - Device action
GET  /api/downloads           - Available downloads
GET  /api/admin/*             - Admin endpoints
```

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Installation](#installation--environment-setup)
- [Environment Variables](#environment-variables-env)
- [Starting Services](#starting-services)
- [Complete Commands Reference](#complete-commands-reference)
- [Dashboard & Platform](#dashboard--platform)
- [Process Management](#process-management)
- [Monitoring & Logs](#monitoring--logs)
- [Troubleshooting](#troubleshooting)
- [Development Workflow](#development-workflow)
- [Deployment Options](#deployment-options)
- [Raspberry Pi Setup](#raspberry-pi-setup)
- [Hardware Watchdog](#raspberry-pi-pico-hardware-watchdog-micropython)

---

## Quick Start

```bash
# 1. Navigate to project
cd /home/cayden/discord\ bot

# 2. Install dependencies
npm install

# 3. Setup environment
cp .env.example .env
nano .env  # Edit with your Discord tokens and settings

# 4. Generate anti-tampering baseline
npm run tamper:generate

# 5. ⭐ START EVERYTHING
./start-all.sh

# OR run individual services:
npm start       # Bot only (production)
npm run dev     # Bot only (development mode)
```
## Prerequisites

- **Node.js** v18+ and npm v8+
- **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)
- **Discord Client ID & Secret** for OAuth2
- **Git** (optional, for version control)

---

## Installation & Environment Setup

```bash
# Navigate to project
cd /home/cayden/discord\ bot

# Install dependenciesv
npm install

# Clone/navigate to project
cd /home/cayden/discord\ bot

# Install all dependencies
npm install

# If you encounter peer dependency issues:
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env
nano .env  # Edit with your Discord tokens and API
```env
# Discord Bot Configuration
BOT_TOKEN=your_discord_bot_token
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret

# Web Dashboard & Platform
ENABLE_WEB_DASHBOARD=true
WEB_PORT=3001
WEB_HOST=0.0.0.0
DASHBOARD_ORIGIN=http://localhost:3001
DISCORD_REDIRECT_URI=http://localhost:3001/auth/discord/callback
DARKLOCK_PORT=3002
BASE_URL=http://localhost:3001

# Security
JWT_SECRET=your_jwt_secret_here
ADMIN_PASSWORD=your_admin_password
INTERNAL_API_KEY=your_api_key_here

# Backend
BACKEND_URL=http://localhost:3001

# Database
DB_NAME=security_bot.db
DB_PATH=./data/

# Optional APIs
VIRUSTOTAL_API_KEY=your_key
URLVOID_API_KEY=your_key
SAFE_BROWSING_API_KEY=your_key

# Anti-Raid
MAX_MESSAGES_PER_MINUTE=10
MAX_JOINS_PER_MINUTE=5
RAID_THRESHOLD=10
DEFAULT_ACCOUNT_AGE_HOURS=24

# Features
ENABLE_AUTO_MOD=true
ENABLE_VPN_DETECTION=true
LOG_RETENTION_DAYS=30
NODE_ENV=development  # or production
```
Starting Services
---

## Complete Commands Reference - Run & Test Everything

### 🚀 Starting Services

```bash
cd /home/cayden/discord\ bot

# ⭐ START EVERYTHING AT ONCE (Recommended)
./start-all.sh                         # Start bot + platform + both Tauri apps
./stop-all.sh                          # Stop all services

# OR start services individually:

# Start Discord Bot
npm start                              # Production mode
npm run dev                            # Development mode (auto-restart)
node start-bot.js                      # Alternative start method
./startup.sh                           # Start with baseline generation

# Start Darklock Guard App (Tauri)
cd "/home/cayden/discord bot/discord bot/guard-v2" && ./start.sh
# Or check if already running:
pgrep -f "guard-service" > /dev/null && echo "Already running" || (cd "/home/cayden/discord bot/discord bot/guard-v2" && ./start.sh)

# Start Darklock Secure Channel (Tauri E2E encrypted messenger)
cd "/home/cayden/discord bot/discord bot/secure-channel/apps/dl-secure-channel"
npm run tauri dev                      # Development mode (hot-reload)
npm run tauri build                    # Build production binary
# Requirements: Rust toolchain + Cargo (https://rustup.rs)
# First-time setup:
#   npm install
#   rustup target add x86_64-unknown-linux-gnu  # Linux
#   rustup target add x86_64-pc-windows-msvc    # Windows cross-compile

# Darklock Guard Security Modes:
# - Normal Mode: Balanced protection for everyday use
# - Strict Mode: Maximum security with password protection
#   * Requires password on every app launch
#   * Password required to disable strict mode
#   * To enable: Settings → Security Mode → Strict → Create password
#   * To disable: Settings → Security Mode → Normal → Enter password

# Start Darklock Platform Server
node darklock/start.js                 # Darklock platform server (use this!)
node darklock/test-server.js           # Test Darklock server
```

### 🧪 Testing - Complete Suite

```bash
cd /home/cayden/discord\ bot

# General Tests
npm test                               # Run all tests
node tests/smoke-tests.js              # Smoke tests - basic functionality check
node healthcheck.js                    # Health check - verify bot is running properly

# Anti-Tampering & File Integrity Tests
node test-tamper-attack.js             # Test tamper attack detection
node test-manual-tamper.js             # Manual tamper test
node test-live-tamper-demo.js          # Live tamper demo (real-time)
node test-destructive-real.js          # Destructive real test (dangerous)
node file-protection/test.js           # Standard file integrity test
node file-protection/test-live.js      # Live file integrity monitoring
npm run tamper:test                    # Test file integrity against baseline

# Platform & API Tests
node test-platform.js                  # Test Darklock platform
node test-platform-route.js            # Test platform routes
node fix-api-me.js                     # Test and fix /api/me endpoint
node test-logger.js                    # Test logging system

# Security Tests
node test-password.js                  # Test password hashing/verification
node test-phishing-detection.js        # Test phishing domain detection
node check-2fa-status.js               # Check 2FA status on accounts

# Premium & Membership Tests
node activate-premium-test.js          # Test premium activation
node add-test-member.js                # Add test member to database
```

### 👤 User Management

```bash
cd /home/cayden/discord\ bot

# Create Users
node create-admin-user.js              # Create admin user (interactive)
node create-darklock-user.js           # Create Darklock platform user
node create-user.js                    # Create general user
node create-test-user.js               # Create test user (interactive)
node create-test-user-json.js          # Create test user (JSON format)
node create-owner-account.js           # Create owner account
node setup-cayden-account.js           # Setup Cayden's account
node create-render-admin.js            # Create Render deployment admin

# Fix Users
node fix-test-user.js                  # Fix test user issues

# Modify Roles & Permissions
node set-owner-role.js                 # Set owner role on user
node upgrade-admin-role.js             # Upgrade user to admin role

# Reset & Update
node reset-admin.js                    # Reset admin password
node update-admin-password.js          # Update admin password
node hash-password.js                  # Generate password hash
```

### 🔐 Security & Authentication

```bash
cd /home/cayden/discord\ bot

# RBAC (Role-Based Access Control)
node init-rbac.js                      # Initialize RBAC schema
node drop-and-init-rbac.js             # Drop and reinitialize RBAC (destructive)

# 2FA Management
node migrate-2fa.js                    # Migrate 2FA system
node check-2fa-status.js               # Check 2FA status

# Authentication Updates
node update-auth.js                    # Update authentication system

# Anti-Tampering
npm run tamper:generate                # Generate integrity baseline
npm run tamper:test                    # Test file integrity
node file-protection/agent/baseline-generator.js  # Generate baseline manually

# Security Audits
npm run security:audit                 # Run security audit
npm run security:fix                   # Auto-fix vulnerabilities
npm run security:check                 # Check security status

# Permissions
chmod +x fix-permissions.sh
./fix-permissions.sh                   # Fix file permissions
```

### 🗄️ Database Management

```bash
cd /home/cayden/discord\ bot

# Operations
npm run db:backup                      # Backup
npm run db:restore                     # Restore
npm run db:init                        # Initialize
npm run db:migrate                     # Migrations

# Checks & Maintenance
node check-admin-db.js                 # Check admin DB
node check-db-maintenance.js           # Maintenance status
node check-maintenance-settings.js     # Maintenance settings
node check-maintenance.js              # Maintenance mode
node query-maintenance.js              # Query maintenance
node check-spam-setting.js             # Spam settings

# Fixes & Migrations
node fix-database-schema.js            # Fix schema
node migrate-xp-db.js                  # Migrate XP
node deploy-xp-commands.js             # Deploy XP commands
node setup-team-db.js                  # Setup teams
npm run fix-encoding                   # Fix encoding
node fix-all-mojibake.cjs              # Fix mojibake
```

### 💬 Darklock Secure Channel

```bash
cd "/home/cayden/discord bot/discord bot/secure-channel/apps/dl-secure-channel"

# Install dependencies (first time or after pulling changes)
npm install

# Development — launches Vite dev server + Tauri window with hot-reload
npm run tauri dev

# Production build — outputs installer to src-tauri/target/release/bundle/
npm run tauri build

# Frontend only (browser, no Tauri features)
npm run dev                            # http://localhost:5173

# Type-check only
npx tsc --noEmit
```

**Backend services** (required for full functionality):
```bash
cd "/home/cayden/discord bot/discord bot/secure-channel"

# IDS — Identity & Key Distribution Service (port 4100)
cd services/dl_ids && npm install && node src/server.js

# RLY — Message Relay Service (port 4101)
cd services/dl_rly && npm install && node src/server.js

# Or start both with Docker Compose
docker-compose up -d
```

**Prerequisites:**
- Node.js v18+
- Rust + Cargo: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Linux build deps: `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`

---

### 🛡️ Darklock Platform

```bash
cd /home/cayden/discord\ bot

# Darklock Server
node darklock/start.js                 # Start Darklock platform server (use this!)
node darklock/test-server.js           # Test Darklock server
node darklock/create-admin.js          # Create Darklock admin user
node darklock/migrate-maintenance.js   # Migrate maintenance mode
node darklock/check-downloads.js       # Check download availability

# Phishing & Security
node import-phishing-domains.js        # Import phishing DB
node test-phishing-detection.js        # Test detection
node generate-license.js               # Generate license

# View Logs
tail -f logs/combined.log              # View all logs (real-time)
tail -f logs/error.log                 # View errors only (real-time)
tail -50 logs/combined.log             # Last 50 lines
grep "ERROR" logs/combined.log         # Search for errors
node check-logs.js                     # Check logs programmatically

# Check Status
chmod +x check-enabled.sh
./check-enabled.sh                     # Check if bot is enabled
node healthcheck.js                    # Comprehensive health check

# Clear Logs
> logs/combined.log                    # Clear combined log
> logs/error.log                       # Clear error log
```

### 🔧 Setup & Installation

```bash
cd /home/cayden/discord\ bot

# Initial Setup
npm run setup                          # Run setup wizard
node setup.js                          # Alternative setup method
�️ Utility & Maintenance

```bash
cd /home/cayden/discord\ bot

# Setup
npm run setup                          # Setup wizard
node setup.js                          # Alt setup

# Dependencies
npm install                            # Install deps
npm install --legacy-peer-deps         # Legacy mode
npm audit fix                          # Fix vulnerabilities
np Raspberry Pi Setup

```bash
cd /home/cayden/discord\ bot

# Installation
chmod +x install-pi5.sh quickstart-pi5.sh
./install-pi5.sh                       # Full Pi 5 install
./quickstart-pi5.sh                    # Quick start Pi 5
./install-bot.sh                       # Install bot
./install-nodejs.sh                    # Install Node.js
./install_hardware_on_pi.sh            # Hardware support

# Hardware
python3 hardware_controller.py         # Watchdog controller
python3 test_lcd.py                    # Test LCD
python3 rgb_led_status.py              # RGB LED status

# Cloudflare Tunnel
chmod +x setup_cloudflare_tunnel.sh install_tunnel_on_pi.sh
./setup_cloudflare_tunnel.sh           # Setup tunnel
./install_tunnel_on_pi.sh              # Install tunnel
./run_tunnel_direct.sh                 # Run directly
./test_tunnel.sh                       # Test connection
./create_tunnel_service.sh             # Create service

# Network & Fixes
./fix_pi_network.sh                    # Fix network
./quick_dns_fix.sh                     # DNS fix
./fix_cloudflared_service.sh           # Fix service

# Bot Management
./restart-bot.sh                       # Restart bot
./diagnose_bot.sh                      # Diagnose
./check_bot_on_pi.sh                   # Check status

# Darklock Network
./setup_darklock_net.sh                # Setup network
./setup-darklock.sh                    # Setup environment

# 9. Test logger
node test-logger.js

# 10. Check logs for errors
grep -i "error" logs/combined.log | tail -20
```

---

## Testing

```bash
cd /home/cayden/discord\ bot

# Run all tests
npm test

# Specific tests
node tests/smoke-tests.js              # Smoke tests
node test-tamper-attack.js             # Tamper attack detection
node test-manual-tamper.js             # Manual tamper test
node test-live-tamper-demo.js          # Live tamper demo
node test-destructive-real.js          # Destructive real test
node test-logger.js                    # Logger test
node test-platform-route.js            # Platform route test
node test-platform.js                  # Platform test
```

---

## Git Operations

```bash
cd /home/cayden/discord\ bot
chmod +x git-push.sh
./git-push.sh
```

---

## Dashboard & Platform

### Access Dashboard
🎯 Unified Admin** (NEW): http://localhost:3001/admin
- **Local**: http://localhost:3001
- **Network**: http://YOUR_IP:3001
- **Discord OAuth**: http://localhost:3001/auth/discord/callback

### Unified Admin Dashboard

The new unified admin dashboard combines all admin functionality:
- **Overview Tab**: Real-time stats from bot, platform, and guard
- **Bot Tab**: Discord bot dashboard (embedded)
- **Platform Tab**: Darklock platform admin (embedded)
- **Guard Tab**: Darklock Guard device management
- **Users Tab**: User management across all services
- **Analytics Tab**: Combined analytics and reports
- **Settings Tab**: System-wide configuration
- **Logs Tab**: Unified activity and audit logs

**Quick Actions Available**:
- 📢 Broadcast messages
- 💾 Database backup
- 🗑️ Clear cache
- 🔄 Restart services
- **Network**: http://YOUR_IP:3001
- **Discord OAuth**: http://localhost:3001/auth/discord/callback

### Access Darklock Platform

- **Integrated**: http://localhost:3001/platform
- **Standalone Server**: http://localhost:3002
- **Admin Panel**: http://localhost:3001/platform/admin

### Platform Routes

```
/platform/                          Platform home
/platform/dashboard                 Main dashboard
/platform/auth/login                Login page  
/platform/auth/signup               Registration
/platform/auth/logout               Logout
/platform/profile                   User profile
/platform/download/darklock-guard   Download Darklock Guard app
/platform/launch/darklock-guard     Launch Darklock Guard (installed)
/platform/monitor/darklock-guard    Web-based monitor
/platform/admin                     Admin panel (admin users only)
/api/status                         API status check
/api/me                             Current user info
/health                             Health check endpoint
```

### Darklock Guard URLs

```
Desktop App: Launch via Tauri (npx tauri dev)
Guard Service: Unix socket at ~/.local/share/guard/
Status Socket: ~/.local/share/guard/status.sock
IPC Socket: ~/.local/share/guard/ipc.sock
Vault Location: ~/.local/share/guard/vault.dat
```

---

## Running in Background

### Using systemd

Create `/etc/systemd/system/discord-bot.service`:

```ini
[Unit]
Description=DarkLock Discord Bot
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/home/cayden/discord\ bot
ExecStart=/usr/bin/node src/bot.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Commands:
```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-bot
sudo systemctl start discord-bot
sudo systemctl status discord-bot
sudo systemctl restart discord-bot
sudo systemctl stop discord-bot
sudo journalctl -u discord-bot -f  # View logs
```

### Using PM2

```bash
npm install -g pm2
cd /home/cayden/discord\ bot
pm2 start src/bot.js --name discord-bot
pm2 startup
pm2 save
pm2 logs discord-bot
pm2 restart discord-bot
pm2 stop discord-bot
pm2 delete discord-bot
```

### Using screen

```bash
cd /home/cayden/discord\ bot
screen -S discord-bot
npm start

# Detach: Ctrl+A, then D
# Reattach: screen -r discord-bot
# List sessions: screen -ls
```

---

## Process Management

```bash
# Find Node process
ps aux | grep node

# Kill process
pkill -f "node src/bot.js"

# Kill by PID
kill <PID>
kill -9 <PID>    # Force kill

# Check port usage
lsof -i :3001    # Dashboard
lsof -i :3002    # Darklock Platform
netstat -tuln | grep -E '3001|3002'
```

---

## Logs

```bash
cd /home/cayden/discord\ bot

# View logs (real-time)
tail -f logs/combined.log

# View errors only
tail -f logs/error.log

# Last 50 lines
tail -50 logs/combined.log

# Search logs
grep "ERROR" logs/combined.log
grep "keyword" logs/combined.log | tail -20

# Clear logs
> logs/combined.log
> logs/error.log
```

---

## Troubleshooting

### Bot Won't Start

```bash
cd /home/cayden/discord\ bot

# Check Node version (should be 18+)
node --version
npm --version

# Verify dependencies
npm install
npm audit

# Check environment variables
cat .env

# Test database connection
node -e "const db = require('./src/database/database'); console.log('DB OK');"

# Check for syntax errors
node -c src/bot.js
```

### Port Already in Use

```bash
# Kill process using port 3001
lsof -ti:3001 | xargs kill -9

# Kill process using port 3002
lsof -ti:3002 | xargs kill -9
```

### Permission Errors

```bash
cd /home/cayden/discord\ bot
chmod +x startup.sh
chmod +x git-push.sh
chmod +x check-enabled.sh
chmod +x fix-permissions.sh
```

### Missing Modules

```bash
cd /home/cayden/discord\ bot
npm install
npm install --legacy-peer-deps
npm audit fix
npm audit fix --force
```

### Database Issues

```bash
cd /home/cayden/discord\ bot

# Check database integrity
node -e "const db = require('./src/database/database'); db.all('SELECT COUNT(*) FROM sqlite_master WHERE type=\"table\"', (e, r) => console.log(e || r));"

# Backup before recovering
node scripts/db-backup.js

# Reset database (careful!)
rm data/security_bot.db
npm run db:init
```

### Dashboard Not Loading

```bash
cd /home/cayden/discord\ bot

# Check if port 3001 is listening
lsof -i :3001

# Clear browser cache and try incognito mode
# Check browser console for errors (F12)
# Check server logs
tail -f logs/combined.log
```

---

## File Structure

```
discord bot/
├── src/
│   ├── bot.js                  # Main bot entry point
│   ├── commands/               # Slash commands
│   ├── events/                 # Discord event handlers
│   ├── dashboard/              # Web dashboard backend
│   ├── database/               # Database management
│   ├── systems/                # Core bot systems
│   └── utils/                  # Utility functions
├── darklock/
│   ├── server.js               # Platform server
│   ├── routes/                 # API routes
│   ├── views/                  # Dashboard templates
│   ├── public/                 # Static assets & JS
│   ├── downloads/              # Installer files
│   └── utils/                  # Platform utilities
├── secure-channel/             # Darklock Secure Channel (E2E messenger)
│   ├── apps/
│   │   └── dl-secure-channel/  # Tauri + React frontend
│   │       ├── src/            # React app (components, stores, pages)
│   │       └── src-tauri/      # Rust backend (crypto, vault, IPC)
│   ├── crates/                 # Shared Rust crates (dl_crypto, dl_store, dl_proto)
│   └── services/
│       ├── ids/                # Identity & Key Distribution Service (port 4100)
│       └── rly/                # Message Relay Service (port 4101)
├── guard-v2/                   # Darklock Guard app (Tauri)
├── file-protection/            # Anti-tampering system
│   ├── agent/                  # Monitoring agent
│   ├── backups/                # File backups
│   └── logs/                   # Integrity logs
├── data/                       # Database & baseline
├── logs/                       # Application logs
├── scripts/                    # Utility scripts
├── tests/                      # Test suite
├── locale/                     # i18n translations
├── .env                        # Environment config (don't commit)
├── config.json                 # Bot configuration
├── package.json                # Dependencies & scripts
└── README.md                   # This file
```

---

## Development Workflow

```bash
cd /home/cayden/discord\ bot

# Install dependencies
npm install

# Start in dev mode (auto-restart)
npm run dev

# Watch file protection
npm run tamper:test

# Run tests
npm test
```

### Making Changes

1. Edit your code
2. Save file → bot auto-restarts (if using npm run dev)
3. Test in Discord or dashboard
4. Run tests: `npm test`
5. Push: `./git-push.sh`

---

## Performance Tips

1. Use `npm run dev` for development - Auto-restart on changes
2. Use `npm start` for production - Stable, no overhead
3. Monitor logs - `tail -f logs/combined.log`
4. Regular backups - `npm run db:backup`
5. Check integrity - `npm run tamper:test`

---

## Security Best Practices

1. Never commit `.env` - Use `.env.example`
2. Rotate secrets regularly - Update JWT_SECRET, API keys
3. Use strong passwords - Admin passwords should be 16+ chars
4. Enable 2FA - Protect admin accounts
5. Monitor logs - Watch for suspicious activity
6. Keep dependencies updated - `npm audit` and `npm update`
7. Backup regularly - Database and file backups

---

## Support & Documentation

### Official Documentation
- **Discord Developer Portal**: https://discord.com/developers/applications
- **Discord API Documentation**: https://discord.com/developers/docs/intro
- **Discord.js Guide**: https://discordjs.guide/
- **Discord.js Documentation**: https://discord.js.org/#/docs/main/stable/general/welcome
- **Node.js Documentation**: https://nodejs.org/en/docs/
- **npm Registry**: https://www.npmjs.com/
- **Tauri Documentation**: https://tauri.app/v1/guides/
- **Rust Documentation**: https://www.rust-lang.org/learn
- **MicroPython**: https://micropython.org/download/rp2-pico/

### API References
- **Discord API**: https://discord.com/developers/docs/reference
- **Discord Gateway**: https://discord.com/developers/docs/topics/gateway
- **Discord OAuth2**: https://discord.com/developers/docs/topics/oauth2
- **VirusTotal API**: https://developers.virustotal.com/reference
- **URLVoid API**: https://www.urlvoid.com/api/

### Community & Support
- **Discord.js Support Server**: https://discord.gg/djs
- **Node.js Help**: https://nodejs.org/en/docs/guides/
- **Stack Overflow**: https://stackoverflow.com/questions/tagged/discord.js

For issues, check logs: `tail -f logs/combined.log`

### Quick Links
- Create Discord Bot: https://discord.com/developers/applications
- Invite Bot Template: `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands`
- Dashboard: http://localhost:3001
- Platform: http://localhost:3001/platform
- API Docs: http://localhost:3001/api

---

# Raspberry Pi Pico Hardware Watchdog (MicroPython)

## Architecture
This watchdog runs on a Raspberry Pi Pico (RP2040) and continuously checks a server health endpoint. It maintains a simple state machine (**OK → DEGRADED → FAIL**) based on retry outcomes. When a failure is confirmed, it asserts a GPIO output (LED/relay), sends a webhook alert, and can optionally call a recovery endpoint. It survives OS or bot failures because it runs on a separate microcontroller.

**Network options**:
- **Pico W**: Uses built‑in Wi‑Fi.
- **Pico (non‑W)**: Uses an external **ESP8266 in AT mode** over UART. (Required because Pico has no Wi‑Fi.)

## Files (must upload to Pico)
Upload these files to the Pico filesystem:
- [main.py](main.py)
- [config.py](config.py)
- [network.py](network.py)
- [state.py](state.py)

## Flash MicroPython
1. Download the official MicroPython UF2 for Raspberry Pi Pico from https://micropython.org/download/rp2-pico/
2. Hold **BOOTSEL** and connect the Pico to USB.
3. Drag-and-drop the UF2 onto the Pico’s mass-storage drive.

## Wiring (Pico + ESP8266 AT)
### 1) Watchdog GPIO (LED or Relay)
- **GPIO_FAIL_PIN (default GP15)** → series resistor (220Ω) → LED → GND
- **GPIO_OK_PIN (default GP14)** → series resistor (220Ω) → LED → GND

If driving a relay, use a transistor and flyback diode. Do **not** drive a relay coil directly from the Pico pin.

### 2) ESP8266 UART
- Pico **GP0 (TX)** → ESP8266 **RX**
- Pico **GP1 (RX)** → ESP8266 **TX**
- Pico **3V3** → ESP8266 **VCC**
- Pico **GND** → ESP8266 **GND**

Use 3.3V only. Ensure ESP8266 is flashed with AT firmware and supports `AT+CIPSTART`/`AT+CIPSEND`.

## Configuration (no reflashing needed)
Edit [config.py](config.py) directly on the Pico:
- `WIFI_SSID` / `WIFI_PASSWORD` must be set for Pico W or ESP8266.
- `HEALTH_URL` → your health endpoint
- `WEBHOOK_URL` → Discord webhook for alerts
- `SHUTDOWN_URL` → optional recovery endpoint
- `INTERVAL_S`, `TIMEOUT_MS`, `RETRIES`
- `GPIO_FAIL_PIN`, `GPIO_OK_PIN`

## Health Endpoint Contract
The endpoint must return JSON like:
```
{
	"status": "ok",
	"integrity": "pass"
}
```
Any mismatch, invalid JSON, or HTTP errors trigger a failure path.

## Testing Failure Detection
1. Set `HEALTH_URL` to a valid endpoint and verify **OK** (OK LED on).
2. Stop the server or block the endpoint.
3. The watchdog will transition **OK → DEGRADED → FAIL** after retries and thresholds.
4. Best Practices

### Performance
- Dev: `npm run dev` (auto-restart on changes)
- Prod: `npm start` (stable, no overhead)
- Monitor: `tail -f logs/combined.log`
- Backup: `npm run db:backup` (regularly)  
- Integrity: `npm run tamper:test` (check frequently)

### Security
- Never commit `.env` to git
- Rotate secrets regularly (JWT_SECRET, API keys)
- Use strong passwords (16+ characters)
- Enable 2FA on admin accounts
- Monitor logs for suspicious activity
- Keep dependencies updated: `npm audit && npm update`
- Regular database backups---
