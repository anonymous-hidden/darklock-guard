-- XP Leaderboard System Schema
-- Tracks user XP, levels, and activity per guild with time-based tracking

CREATE TABLE IF NOT EXISTS user_xp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    
    -- Time-based XP tracking
    daily_xp INTEGER DEFAULT 0,
    weekly_xp INTEGER DEFAULT 0,
    monthly_xp INTEGER DEFAULT 0,
    
    -- Reset timestamps
    daily_reset INTEGER DEFAULT (strftime('%s', 'now')),
    weekly_reset INTEGER DEFAULT (strftime('%s', 'now')),
    monthly_reset INTEGER DEFAULT (strftime('%s', 'now')),
    
    total_messages INTEGER DEFAULT 0,
    last_message_timestamp INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    
    -- Ensure one record per user per guild
    UNIQUE(user_id, guild_id)
);

-- Index for fast leaderboard queries (overall)
CREATE INDEX IF NOT EXISTS idx_guild_xp ON user_xp(guild_id, xp DESC);

-- Index for daily leaderboard
CREATE INDEX IF NOT EXISTS idx_guild_daily_xp ON user_xp(guild_id, daily_xp DESC);

-- Index for weekly leaderboard
CREATE INDEX IF NOT EXISTS idx_guild_weekly_xp ON user_xp(guild_id, weekly_xp DESC);

-- Index for monthly leaderboard
CREATE INDEX IF NOT EXISTS idx_guild_monthly_xp ON user_xp(guild_id, monthly_xp DESC);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_guild ON user_xp(user_id, guild_id);

-- Index for timestamp-based queries (anti-spam)
CREATE INDEX IF NOT EXISTS idx_last_message ON user_xp(user_id, guild_id, last_message_timestamp);

-- Guild leaderboard settings (optional customization)
CREATE TABLE IF NOT EXISTS guild_xp_settings (
    guild_id TEXT PRIMARY KEY,
    xp_enabled INTEGER DEFAULT 1,
    xp_per_message_min INTEGER DEFAULT 15,
    xp_per_message_max INTEGER DEFAULT 25,
    cooldown_seconds INTEGER DEFAULT 60,
    level_up_channel_id TEXT,
    level_up_message TEXT DEFAULT 'GG {user}, you just advanced to **Level {level}**!',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
