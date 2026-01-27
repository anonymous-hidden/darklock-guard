# DarkLock - Personal Setup Guide

Discord security and moderation bot with dashboard, analytics, ticket system, and leveling.

---
## pie 
npm start           # Start protection (fast mode, no backups)
npm test            # Test the system
npm run list-ports  # Show all USB devices
npm run create-backups  # Manually create backups
npm run cleanup

## Prerequisites

- **Node.js** v18+ and npm v8+
- **Discord Bot Token** from [Discord Developer Portal](https://discord.com/developers/applications)
- **Discord Client ID & Secret** for OAuth2

---

## Quick Start Commands

### Linux

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env

# Generate anti-tampering baseline
node file-protection/agent/baseline-generator.js

# Run the bot
npm start                           # Production
npm run dev                         # Development (auto-restart)
./startup.sh                        # Production with baseline generation
```

### PowerShell

```powershell
# Install dependencies
npm install

# Configure environment
Copy-Item .env.example .env
notepad .env

# Generate anti-tampering baseline
node file-protection/agent/baseline-generator.js

# Run the bot
npm start                           # Production
npm run dev                         # Development (auto-restart)
node src/bot.js                     # Direct run
```

---

## Anti-Tampering Baseline Commands

### Generate Baseline (Both Platforms)

```bash
# Linux
node file-protection/agent/baseline-generator.js

# PowerShell
node file-protection/agent/baseline-generator.js
```

This command:
- Scans all protected files (critical & high tier)
- Generates HMAC-signed hashes
- Creates backups in `file-protection/backups/`
- Saves baseline to `data/file-integrity.json`

### Test Baseline (Both Platforms)

```bash
# Linux
node file-protection/test.js

# PowerShell
node file-protection/test.js
```

### Live Test (Both Platforms)

```bash
# Linux
node file-protection/test-live.js

# PowerShell
node file-protection/test-live.js
```

---

## NPM Scripts Reference

```bash
# Start bot (production)
npm start

# Development mode with auto-restart
npm run dev

# Run setup wizard
npm setup

# Generate anti-tampering baseline
npm run tamper:generate

# Test anti-tampering
npm run tamper:test

# Fix encoding issues
npm run fix-encoding

# Security audit
npm run security:audit
npm run security:fix
npm run security:check

# Test seed preservation
npm run test:seed-preserve
```

---

## Database Management

### Backup Database

#### Linux
```bash
# Manual backup
node scripts/db-backup.js

# Daily automated backup (set up cron)
node scripts/daily-backup.js
```

#### PowerShell
```powershell
# Manual backup
node scripts/db-backup.js

# Daily automated backup (set up task scheduler)
node scripts/daily-backup.js
```

### Restore Database

#### Linux
```bash
# Restore from backup
node scripts/db-restore.js
```

#### PowerShell
```powershell
# Restore from backup
node scripts/db-restore.js
```

---

## Utility Scripts

### Create Admin User

#### Linux
```bash
node create-admin-user.js
```

#### PowerShell
```powershell
node create-admin-user.js
```

### Hash Password

#### Linux
```bash
node hash-password.js
```

#### PowerShell
```powershell
node hash-password.js
```

### Set Owner Role

#### Linux
```bash
node set-owner-role.js
```

#### PowerShell
```powershell
node set-owner-role.js
```

### Upgrade Admin Role

#### Linux
```bash
node upgrade-admin-role.js
```

#### PowerShell
```powershell
node upgrade-admin-role.js
```

### Check Logs

#### Linux
```bash
node check-logs.js
```

#### PowerShell
```powershell
node check-logs.js
```

### Check 2FA Status

#### Linux
```bash
node check-2fa-status.js
```

#### PowerShell
```powershell
node check-2fa-status.js
```

### Migrate 2FA

#### Linux
```bash
node migrate-2fa.js
```

#### PowerShell
```powershell
node migrate-2fa.js
```

### Update Auth System

#### Linux
```bash
node update-auth.js
```

#### PowerShell
```powershell
.\update-auth-to-cookies.ps1
```

---

## Git Operations

### Push to Repository

#### Linux
```bash
chmod +x git-push.sh
./git-push.sh
```

#### PowerShell
```powershell
.\git-push.ps1
```

---

## Environment Variables (.env)

```env
# Discord Bot Configuration
BOT_TOKEN=your_discord_bot_token
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret

# Web Dashboard
ENABLE_WEB_DASHBOARD=true
WEB_PORT=3001
WEB_HOST=0.0.0.0
DASHBOARD_ORIGIN=http://localhost:3001
DISCORD_REDIRECT_URI=http://localhost:3001/auth/discord/callback

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
```

---

## Running in Background

### Linux (systemd)

Create service file: `/etc/systemd/system/discord-bot.service`

```ini
[Unit]
Description=DarkLock
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/discord bot
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
sudo systemctl stop discord-bot
sudo systemctl restart discord-bot
```

### Linux (PM2)

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start src/bot.js --name discord-bot

# Auto-restart on reboot
pm2 startup
pm2 save

# View logs
pm2 logs discord-bot

# Restart
pm2 restart discord-bot

# Stop
pm2 stop discord-bot
```

### Linux (screen)

```bash
# Start in screen session
screen -S discord-bot
npm start

# Detach: Ctrl+A, then D

# Reattach
screen -r discord-bot

# List sessions
screen -ls
```

### PowerShell (NSSM)

```powershell
# Install NSSM (Non-Sucking Service Manager)
# Download from https://nssm.cc/

# Install service
nssm install DiscordBot "C:\Program Files\nodejs\node.exe"
nssm set DiscordBot AppDirectory "C:\path\to\discord bot"
nssm set DiscordBot AppParameters "src/bot.js"
nssm set DiscordBot DisplayName "DarkLock"
nssm set DiscordBot Description "Discord security and moderation bot"

# Start service
nssm start DiscordBot

# Stop service
nssm stop DiscordBot

# Remove service
nssm remove DiscordBot confirm
```

---

## Process Management

### Linux

```bash
# Find process
ps aux | grep node

# Kill process
pkill -f "node src/bot.js"

# Kill by PID
kill <PID>
kill -9 <PID>  # Force kill

# Check port usage
lsof -i :3001
netstat -tuln | grep 3001
```

### PowerShell

```powershell
# Find process
Get-Process node

# Kill process
Stop-Process -Name node -Force

# Kill by PID
Stop-Process -Id <PID> -Force

# Check port usage
netstat -ano | findstr :3001
Get-NetTCPConnection -LocalPort 3001
```

---

## Logs

```bash
# View logs
tail -f logs/combined.log     # All logs
tail -f logs/error.log        # Errors only

# Clear logs (Linux)
> logs/combined.log
> logs/error.log

# Clear logs (PowerShell)
Clear-Content logs/combined.log
Clear-Content logs/error.log
```

---

## Dashboard Access

After starting the bot, access the dashboard at:
- Local: http://localhost:3001
- Network: http://YOUR_IP:3001

Login with Discord OAuth2 to configure settings.

---

## Troubleshooting

### Bot won't start
```bash
# Check Node version
node --version  # Should be 18+

# Verify dependencies
npm install

# Check environment variables
cat .env  # Linux
type .env  # PowerShell

# Test database
node -e "const db = require('./src/database/database'); console.log('DB OK');"
```

### Port already in use
```bash
# Linux
lsof -ti:3001 | xargs kill -9

# PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess | Stop-Process -Force
```

### Permission errors (Linux)
```bash
chmod +x startup.sh
chmod +x git-push.sh
```

### Missing modules
```bash
npm install
npm audit fix
```

---

## File Structure

```
discord bot/
├── src/
│   ├── bot.js                  # Main entry point
│   ├── commands/               # Slash commands
│   ├── events/                 # Event handlers
│   ├── dashboard/              # Web dashboard
│   ├── database/               # Database manager
│   ├── systems/                # Core systems
│   └── utils/                  # Utilities
├── data/                       # Database & backups
├── logs/                       # Log files
├── file-protection/            # Anti-tampering
├── scripts/                    # Utility scripts
├── locale/                     # Translations
├── .env                        # Environment config
├── config.json                 # Bot config
├── package.json                # Dependencies
└── startup.sh                  # Linux startup script
```

I'll check the project's setup and run instructions for Linux.

Based on the project files, here's how to run this Discord bot on Linux:

Quick Start
Install Node.js (if not already installed):
Install dependencies:
Set up configuration:
Add at minimum:

Run the bot:
The bot will start and the dashboard will be available at http://localhost:3001.

Note: The startup.sh script automatically generates the anti-tampering baseline before starting the bot. For development, npm run dev uses nodemon for auto-restart on file changes.