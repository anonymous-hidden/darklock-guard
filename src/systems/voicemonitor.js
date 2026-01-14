/**
 * Voice Channel Monitoring System
 * Tracks voice activity, detects suspicious patterns, and logs voice events
 */

const { EmbedBuilder, ChannelType } = require('discord.js');

class VoiceMonitor {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        this.voiceActivity = new Map(); // Track voice sessions
        this.channelHopping = new Map(); // Track channel hopping
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('VoiceMonitor initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Voice monitoring config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS voice_monitor_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        log_channel_id TEXT,
                        track_joins INTEGER DEFAULT 1,
                        track_leaves INTEGER DEFAULT 1,
                        track_moves INTEGER DEFAULT 1,
                        track_mute_deaf INTEGER DEFAULT 0,
                        detect_hopping INTEGER DEFAULT 1,
                        hopping_threshold INTEGER DEFAULT 5,
                        hopping_timeframe INTEGER DEFAULT 60,
                        detect_mass_move INTEGER DEFAULT 1,
                        mass_move_threshold INTEGER DEFAULT 5,
                        alert_channel_id TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Voice activity log
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS voice_activity_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        channel_id TEXT,
                        old_channel_id TEXT,
                        new_channel_id TEXT,
                        session_duration INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Voice sessions
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS voice_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        channel_id TEXT NOT NULL,
                        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        ended_at DATETIME,
                        duration INTEGER
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_voice_log_guild ON voice_activity_log(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_voice_log_user ON voice_activity_log(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id)`);
            });
        });
    }

    // Get config
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM voice_monitor_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup voice monitoring
    async setup(guildId, settings = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO voice_monitor_config (guild_id, enabled, log_channel_id, alert_channel_id)
                 VALUES (?, 1, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    log_channel_id = ?,
                    alert_channel_id = ?`,
                [guildId, settings.logChannelId, settings.alertChannelId,
                 settings.logChannelId, settings.alertChannelId],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Update config
    async updateConfig(guildId, settings) {
        const updates = [];
        const values = [];

        for (const [key, value] of Object.entries(settings)) {
            updates.push(`${key} = ?`);
            values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
        }

        if (updates.length === 0) return false;
        values.push(guildId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE voice_monitor_config SET ${updates.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Handle voice state update
    async handleVoiceUpdate(oldState, newState) {
        const guildId = newState.guild.id;
        const config = await this.getConfig(guildId);
        if (!config?.enabled) return;

        const userId = newState.member?.id || oldState.member?.id;
        if (!userId) return;

        // Determine event type
        let eventType = null;
        let logData = {};

        if (!oldState.channel && newState.channel) {
            // User joined voice
            eventType = 'join';
            logData = {
                channelId: newState.channel.id,
                channelName: newState.channel.name
            };
            await this.startSession(guildId, userId, newState.channel.id);
        } else if (oldState.channel && !newState.channel) {
            // User left voice
            eventType = 'leave';
            logData = {
                channelId: oldState.channel.id,
                channelName: oldState.channel.name
            };
            const duration = await this.endSession(guildId, userId);
            logData.duration = duration;
        } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            // User moved channels
            eventType = 'move';
            logData = {
                oldChannelId: oldState.channel.id,
                oldChannelName: oldState.channel.name,
                newChannelId: newState.channel.id,
                newChannelName: newState.channel.name
            };
            
            // Check for channel hopping
            if (config.detect_hopping) {
                await this.checkChannelHopping(newState.guild, config, userId);
            }
        } else if (oldState.serverMute !== newState.serverMute) {
            eventType = newState.serverMute ? 'server_mute' : 'server_unmute';
        } else if (oldState.serverDeaf !== newState.serverDeaf) {
            eventType = newState.serverDeaf ? 'server_deaf' : 'server_undeaf';
        }

        if (!eventType) return;

        // Check config for which events to track
        if (eventType === 'join' && !config.track_joins) return;
        if (eventType === 'leave' && !config.track_leaves) return;
        if (eventType === 'move' && !config.track_moves) return;
        if ((eventType.includes('mute') || eventType.includes('deaf')) && !config.track_mute_deaf) return;

        // Log the event
        await this.logEvent(guildId, userId, eventType, logData);

        // Send log notification
        await this.sendLogNotification(newState.guild, config, userId, eventType, logData);
    }

    // Start voice session
    async startSession(guildId, userId, channelId) {
        // Store in memory
        const key = `${guildId}-${userId}`;
        this.voiceActivity.set(key, {
            channelId,
            startedAt: Date.now()
        });

        // Store in DB
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO voice_sessions (guild_id, user_id, channel_id) VALUES (?, ?, ?)`,
                [guildId, userId, channelId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // End voice session
    async endSession(guildId, userId) {
        const key = `${guildId}-${userId}`;
        const session = this.voiceActivity.get(key);
        
        let duration = 0;
        if (session) {
            duration = Math.floor((Date.now() - session.startedAt) / 1000);
            this.voiceActivity.delete(key);
        }

        // Update DB
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE voice_sessions SET ended_at = CURRENT_TIMESTAMP, duration = ?
                 WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL`,
                [duration, guildId, userId],
                (err) => {
                    if (err) reject(err);
                    else resolve(duration);
                }
            );
        });
    }

    // Check for channel hopping
    async checkChannelHopping(guild, config, userId) {
        const key = `${guild.id}-${userId}`;
        const now = Date.now();
        const timeframe = (config.hopping_timeframe || 60) * 1000;
        
        if (!this.channelHopping.has(key)) {
            this.channelHopping.set(key, []);
        }

        const hops = this.channelHopping.get(key);
        hops.push(now);

        // Clean old hops
        const recentHops = hops.filter(t => now - t < timeframe);
        this.channelHopping.set(key, recentHops);

        // Check threshold
        if (recentHops.length >= (config.hopping_threshold || 5)) {
            await this.alertChannelHopping(guild, config, userId, recentHops.length);
            this.channelHopping.set(key, []); // Reset
        }
    }

    // Alert channel hopping
    async alertChannelHopping(guild, config, userId, hopCount) {
        const channelId = config.alert_channel_id || config.log_channel_id;
        if (!channelId) return;

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Channel Hopping Detected')
            .setColor(0xFFAA00)
            .addFields(
                { name: 'User', value: `<@${userId}>`, inline: true },
                { name: 'Hops', value: `${hopCount}`, inline: true },
                { name: 'Timeframe', value: `${config.hopping_timeframe}s`, inline: true }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    }

    // Log event to database
    async logEvent(guildId, userId, eventType, data) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO voice_activity_log (guild_id, user_id, event_type, channel_id, old_channel_id, new_channel_id, session_duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [guildId, userId, eventType, data.channelId, data.oldChannelId, data.newChannelId, data.duration],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Send log notification
    async sendLogNotification(guild, config, userId, eventType, data) {
        if (!config.log_channel_id) return;

        const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const icons = {
            join: '🟢',
            leave: '🔴',
            move: '🔄',
            server_mute: '🔇',
            server_unmute: '🔊',
            server_deaf: '🔕',
            server_undeaf: '🔔'
        };

        const embed = new EmbedBuilder()
            .setColor(eventType === 'join' ? 0x00FF00 : eventType === 'leave' ? 0xFF0000 : 0x00BFFF)
            .setTimestamp();

        switch (eventType) {
            case 'join':
                embed.setDescription(`${icons.join} <@${userId}> joined **${data.channelName}**`);
                break;
            case 'leave':
                embed.setDescription(`${icons.leave} <@${userId}> left **${data.channelName}**`);
                if (data.duration) {
                    embed.addFields({ name: 'Session Duration', value: this.formatDuration(data.duration), inline: true });
                }
                break;
            case 'move':
                embed.setDescription(`${icons.move} <@${userId}> moved from **${data.oldChannelName}** to **${data.newChannelName}**`);
                break;
            default:
                embed.setDescription(`${icons[eventType] || '🎤'} <@${userId}> - ${eventType.replace('_', ' ')}`);
        }

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Format duration
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }

    // Get user voice stats
    async getUserStats(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COUNT(*) as total_sessions,
                    SUM(duration) as total_duration,
                    AVG(duration) as avg_duration,
                    MAX(duration) as longest_session
                 FROM voice_sessions 
                 WHERE guild_id = ? AND user_id = ? AND duration IS NOT NULL`,
                [guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_sessions: 0, total_duration: 0, avg_duration: 0, longest_session: 0 });
                }
            );
        });
    }

    // Get recent activity
    async getRecentActivity(guildId, limit = 20) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM voice_activity_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get guild stats
    async getGuildStats(guildId, days = 7) {
        const cutoff = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COUNT(DISTINCT user_id) as unique_users,
                    COUNT(*) as total_events,
                    SUM(CASE WHEN event_type = 'join' THEN 1 ELSE 0 END) as joins,
                    SUM(CASE WHEN event_type = 'leave' THEN 1 ELSE 0 END) as leaves,
                    SUM(CASE WHEN event_type = 'move' THEN 1 ELSE 0 END) as moves
                 FROM voice_activity_log 
                 WHERE guild_id = ? AND created_at >= ?`,
                [guildId, cutoff],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { unique_users: 0, total_events: 0, joins: 0, leaves: 0, moves: 0 });
                }
            );
        });
    }

    // Get top voice users
    async getTopVoiceUsers(guildId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT user_id, SUM(duration) as total_time, COUNT(*) as session_count
                 FROM voice_sessions 
                 WHERE guild_id = ? AND duration IS NOT NULL
                 GROUP BY user_id
                 ORDER BY total_time DESC
                 LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Handle mass move detection
    async handleMemberMove(guild, mover, members, channel) {
        const config = await this.getConfig(guild.id);
        if (!config?.enabled || !config.detect_mass_move) return;

        if (members.length >= (config.mass_move_threshold || 5)) {
            await this.alertMassMove(guild, config, mover, members.length, channel);
        }
    }

    // Alert mass move
    async alertMassMove(guild, config, mover, memberCount, channel) {
        const channelId = config.alert_channel_id || config.log_channel_id;
        if (!channelId) return;

        const alertChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (!alertChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Mass Voice Move Detected')
            .setColor(0xFF6600)
            .addFields(
                { name: 'Moved By', value: `<@${mover.id}>`, inline: true },
                { name: 'Members Moved', value: `${memberCount}`, inline: true },
                { name: 'To Channel', value: channel?.name || 'Unknown', inline: true }
            )
            .setTimestamp();

        await alertChannel.send({ embeds: [embed] });
    }
}

module.exports = VoiceMonitor;
