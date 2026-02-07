# Arcane-Style XP Leaderboard System

A production-ready Discord XP tracking and leaderboard system with web dashboard, inspired by the Arcane visual style.

## Features

✨ **XP Tracking System**
- Automatic XP rewards on messages (15-25 XP per message)
- 60-second anti-spam cooldown per user
- Exponential leveling formula: `level = floor(0.1 * sqrt(xp))`
- Level-up notifications with customizable messages
- Support for level-based role rewards

🎨 **Discord Embed UI**
- Dark-themed Arcane-style embeds
- Unicode progress bars (▰▱) showing level progress
- Top 10 leaderboard with rank, username, and level
- "View leaderboard" button linking to web dashboard
- Real-time XP tracking and updates

🌐 **Web Dashboard**
- Full leaderboard view (all users, not just top 10)
- Responsive design with Tailwind CSS
- Dark theme matching Discord embed
- User avatars from Discord CDN
- Real-time progress bars
- Server statistics overview

## Architecture

```
src/
├── db/
│   ├── schema.sql          # Database schema with indexes
│   └── xpDatabase.js       # Database manager with all operations
├── bot/
│   ├── xpTracker.js        # Message listener and XP rewards
│   └── commands/
│       └── leaderboard.js  # /leaderboard Discord command
└── web/
    └── server.js           # Express web dashboard
```

## Installation

### 1. Install Dependencies

```bash
npm install discord.js sqlite3 express cors dotenv
```

### 2. Environment Setup

Copy `.env.xp-example` to `.env` and configure:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
DASHBOARD_PORT=3005
DASHBOARD_URL=http://localhost:3005
```

### 3. Database Initialization

The database will be automatically created on first run at `./data/xp.db`.

Tables:
- `user_xp` - Stores user XP, level, and activity
- `guild_xp_settings` - Per-guild XP system configuration

### 4. Register Commands

Create a script to register the `/leaderboard` command:

```bash
node deploy-commands.js
```

**deploy-commands.js:**
```javascript
const { REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./src/bot/commands').filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./src/bot/commands/${file}`);
    commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Commands registered successfully!');
    } catch (error) {
        console.error(error);
    }
})();
```

### 5. Integration with Existing Bot

Add to your main bot file:

```javascript
const XPDatabase = require('./src/db/xpDatabase');
const XPTracker = require('./src/bot/xpTracker');
const WebDashboard = require('./src/web/server');

// In your bot initialization:
const xpDatabase = new XPDatabase('./data/xp.db');
await xpDatabase.initialize();

const xpTracker = new XPTracker(client, xpDatabase);
client.xpTracker = xpTracker;

const webDashboard = new WebDashboard(xpDatabase, client, 3005);
await webDashboard.start();
```

## Usage

### Discord Commands

**View Leaderboard:**
```
/leaderboard
```
Shows top 10 users with XP, levels, and progress bars. Includes a button to view the full web leaderboard.

### Web Dashboard

Access the web dashboard at:
```
http://localhost:3005/leaderboard/{GUILD_ID}
```

Replace `{GUILD_ID}` with your Discord server ID.

### API Endpoint

Get leaderboard data as JSON:
```
GET http://localhost:3005/api/leaderboard/{GUILD_ID}
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "user_id": "123456789",
      "username": "User#1234",
      "xp": 57600,
      "level": 24,
      "total_messages": 384,
      "progress_percent": 76,
      "avatar": "https://cdn.discordapp.com/avatars/..."
    }
  ]
}
```

## Customization

### XP Rewards

Modify XP amounts per message in database:

```javascript
await xpDatabase.updateGuildSettings(guildId, {
    xp_per_message_min: 10,
    xp_per_message_max: 30,
    cooldown_seconds: 60
});
```

### Level-Up Messages

Customize level-up notifications:

```javascript
await xpDatabase.updateGuildSettings(guildId, {
    level_up_message: 'Congrats {user}! You reached **Level {level}**! 🎉',
    level_up_channel_id: '1234567890'
});
```

### Level Roles

Edit `xpTracker.js` to assign roles at specific levels:

```javascript
const levelRoles = {
    5: 'role_id_level_5',
    10: 'role_id_level_10',
    25: 'role_id_level_25',
    50: 'role_id_level_50'
};
```

### Progress Bar Style

Change progress bar characters in `src/bot/commands/leaderboard.js`:

```javascript
function createProgressBar(percent, length = 20) {
    const filledChar = '▰';  // Change these
    const emptyChar = '▱';   // to any Unicode characters
    // ...
}
```

## XP Formula

**Level Calculation:**
```
level = floor(0.1 * sqrt(xp))
```

**XP Required for Level:**
```
xp = (level / 0.1)²
```

**Examples:**
- Level 1: 100 XP
- Level 10: 10,000 XP
- Level 24: 57,600 XP
- Level 50: 250,000 XP
- Level 100: 1,000,000 XP

## Database Schema

### user_xp Table
```sql
CREATE TABLE user_xp (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    last_message_timestamp INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(user_id, guild_id)
);
```

### guild_xp_settings Table
```sql
CREATE TABLE guild_xp_settings (
    guild_id TEXT PRIMARY KEY,
    xp_enabled INTEGER DEFAULT 1,
    xp_per_message_min INTEGER DEFAULT 15,
    xp_per_message_max INTEGER DEFAULT 25,
    cooldown_seconds INTEGER DEFAULT 60,
    level_up_channel_id TEXT,
    level_up_message TEXT
);
```

## Performance

- **Indexes**: Optimized queries with composite indexes on `(guild_id, xp)` and `(user_id, guild_id)`
- **WAL Mode**: SQLite Write-Ahead Logging for concurrent reads
- **Connection Pooling**: Single persistent database connection
- **Cooldown Check**: Prevents spam with timestamp-based filtering

## Security

- **SQL Injection**: All queries use parameterized statements
- **XSS Prevention**: HTML escaping on all user-generated content
- **Rate Limiting**: Built-in cooldown system prevents abuse
- **CORS**: Configurable cross-origin resource sharing

## Troubleshooting

**Database locked error:**
- Ensure only one bot instance is running
- Check file permissions on `data/xp.db`

**Commands not showing:**
- Run `deploy-commands.js` to register slash commands
- Wait up to 1 hour for global commands to propagate

**Web dashboard not loading:**
- Check DASHBOARD_PORT is not in use
- Verify DASHBOARD_URL in .env matches your setup
- Ensure bot has fetched the guild

**XP not tracking:**
- Verify bot has `GuildMessages` and `MessageContent` intents
- Check `xp_enabled` is `1` in guild_xp_settings table

## Production Deployment

### Environment Variables
Set in your hosting platform:
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DASHBOARD_URL` (your public URL)
- `NODE_ENV=production`

### Process Manager (PM2)
```bash
pm2 start xp-bot-example.js --name xp-bot
pm2 save
pm2 startup
```

### Reverse Proxy (Nginx)
```nginx
server {
    listen 80;
    server_name leaderboard.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## License

MIT License - Feel free to use and modify for your Discord bot!

## Support

For issues or questions, please refer to the Discord.js documentation:
https://discord.js.org/
