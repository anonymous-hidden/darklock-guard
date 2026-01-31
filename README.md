# DarkLock - Personal Setup Guide

Discord security and moderation bot with dashboard, analytics, ticket system, leveling, and Darklock Guard platform.

---

## Quick Start (Copy & Paste)

```bash
# Navigate to project directory
cd /home/cayden/discord\ bot

# Install dependencies
npm install

# Setup environment
cp .env.example .env
nano .env  # Edit with your settings

# Generate anti-tampering baseline
node file-protection/agent/baseline-generator.js

# Run the bot (choose one)
npm start       # Production mode
npm run dev     # Development mode (auto-restart on file changes)
./startup.sh    # With baseline generation
```

---

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

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
nano .env  # Edit with your settings
```

---

## Environment Variables (.env)

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

---

## Running the Bot

```bash
# Navigate to project
cd /home/cayden/discord\ bot

# Production mode (standard)
npm start

# Development mode (auto-restart on changes)
npm run dev

# With anti-tampering baseline
chmod +x startup.sh
./startup.sh
```

---

## Generate Anti-Tampering Baseline

```bash
cd /home/cayden/discord\ bot
node file-protection/agent/baseline-generator.js
```

This generates HMAC-signed hashes and backups for all protected files.

---

## NPM Scripts - All Commands

### Core Bot Commands
```bash
cd /home/cayden/discord\ bot
npm start              # Production mode
npm run dev            # Development mode (auto-restart)
npm test               # Run tests
npm run setup          # Run setup wizard
```

### Anti-Tampering & File Protection
```bash
cd /home/cayden/discord\ bot
npm run tamper:generate    # Generate baseline for file integrity
npm run tamper:test        # Test file integrity against baseline
npm run fix-encoding       # Fix mojibake encoding issues
```

### Security
```bash
cd /home/cayden/discord\ bot
npm run security:audit      # Run security audit
npm run security:fix        # Auto-fix security vulnerabilities
npm run security:check      # Check security status
```

### Database
```bash
cd /home/cayden/discord\ bot
npm run db:backup          # Backup database
npm run db:restore         # Restore from backup
npm run db:init            # Initialize database
npm run db:migrate         # Run migrations
```

### Testing & Development
```bash
cd /home/cayden/discord\ bot
npm run test:seed-preserve  # Test seed preservation
npm test                    # Run all tests
```

### Utility
```bash
cd /home/cayden/discord\ bot
npm run list-ports         # Show all USB/serial devices
npm run create-backups     # Manually create file backups
npm run cleanup            # Clean up temporary files
```

---

## Admin & Setup Scripts

### User Management
```bash
cd /home/cayden/discord\ bot
node create-admin-user.js              # Create admin user
node create-test-user-json.js          # Create test user (JSON format)
node create-test-user.js               # Create test user (interactive)
node fix-test-user.js                  # Fix test user
node create-darklock-user.js           # Create Darklock user
node set-owner-role.js                 # Set owner role
node upgrade-admin-role.js             # Upgrade admin role
node reset-admin.js                    # Reset admin password
node update-admin-password.js          # Update admin password
```

### RBAC & Security
```bash
cd /home/cayden/discord\ bot
node init-rbac.js                      # Initialize RBAC schema
node drop-and-init-rbac.js             # Drop and reinitialize RBAC
chmod +x fix-permissions.sh
./fix-permissions.sh                   # Fix permissions
```

### Authentication
```bash
cd /home/cayden/discord\ bot
node update-auth.js                    # Update auth system
node migrate-2fa.js                    # Migrate 2FA
node check-2fa-status.js               # Check 2FA status
```

### Password & Hashing
```bash
cd /home/cayden/discord\ bot
node hash-password.js                  # Hash password
```

### Logs & Monitoring
```bash
cd /home/cayden/discord\ bot
node check-logs.js                     # Check logs
chmod +x check-enabled.sh
./check-enabled.sh                     # Check enabled status
```

### Database Maintenance
```bash
cd /home/cayden/discord\ bot
node check-db-maintenance.js           # Check database maintenance status
node check-maintenance-settings.js     # Check maintenance settings
node check-maintenance.js              # Check maintenance status
node query-maintenance.js              # Query maintenance
node check-spam-setting.js             # Check spam setting
```

### Darklock Platform
```bash
cd /home/cayden/discord\ bot
node darklock/create-admin.js          # Create Darklock admin
node darklock/server.js                # Initialize Darklock server
node darklock/test-server.js           # Test Darklock server
node darklock/migrate-maintenance.js   # Migrate Darklock maintenance
node darklock/check-downloads.js       # Check Darklock downloads
```

---

## File Protection & Anti-Tampering

### Generate Baseline
```bash
cd /home/cayden/discord\ bot
node file-protection/agent/baseline-generator.js
```

### Test Anti-Tampering
```bash
cd /home/cayden/discord\ bot
node file-protection/test.js           # Standard test
node file-protection/test-live.js      # Live test (real-time monitoring)
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

After starting the bot:
- **Local**: http://localhost:3001
- **Network**: http://YOUR_IP:3001

### Access Darklock Platform

- **Integrated**: Available on port 3001 at `/platform`

### Platform Routes

```
/platform/                      Dashboard home
/platform/dashboard             Main dashboard
/platform/auth/login            Login page
/platform/auth/signup           Registration
/platform/auth/logout           Logout
/platform/profile               User profile
/platform/download/darklock-guard   Download Darklock Guard app
/platform/launch/darklock-guard     Launch Darklock Guard (installed)
/platform/monitor/darklock-guard    Web-based monitor
/platform/admin                 Admin panel (admin users only)
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

- **Discord Developer Portal**: https://discord.com/developers/applications
- **Node.js Docs**: https://nodejs.org/en/docs/
- **npm Registry**: https://www.npmjs.com/

For issues, check logs: `tail -f logs/combined.log`

