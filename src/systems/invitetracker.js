/**
 * Invite Tracking System
 * Tracks who invited whom, invite sources, and provides analytics
 * Useful for raid detection, rewards, and analytics
 */

const { EmbedBuilder, AuditLogEvent } = require('discord.js');

class InviteTracker {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        // Cache: guildId -> Map of invite code -> { uses, inviterId }
        this.inviteCache = new Map();
        this.vanityCache = new Map(); // Guild vanity invites
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('InviteTracker system initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Invite tracking config per guild
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS invite_tracker_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        log_channel_id TEXT,
                        track_leaves INTEGER DEFAULT 1,
                        track_fake_leaves INTEGER DEFAULT 1,
                        reward_roles TEXT DEFAULT '[]',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Individual invites tracking
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS invite_data (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        invite_code TEXT NOT NULL,
                        inviter_id TEXT NOT NULL,
                        uses INTEGER DEFAULT 0,
                        max_uses INTEGER,
                        expires_at DATETIME,
                        channel_id TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, invite_code)
                    )
                `);

                // Track who was invited by whom
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS invite_joins (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        inviter_id TEXT,
                        invite_code TEXT,
                        join_type TEXT DEFAULT 'invite',
                        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        left_at DATETIME,
                        is_fake INTEGER DEFAULT 0,
                        account_age_days INTEGER
                    )
                `);

                // Inviter stats
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS inviter_stats (
                        guild_id TEXT NOT NULL,
                        inviter_id TEXT NOT NULL,
                        total_invites INTEGER DEFAULT 0,
                        regular_invites INTEGER DEFAULT 0,
                        bonus_invites INTEGER DEFAULT 0,
                        fake_invites INTEGER DEFAULT 0,
                        left_invites INTEGER DEFAULT 0,
                        PRIMARY KEY (guild_id, inviter_id)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_invite_joins_guild ON invite_joins(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_invite_joins_user ON invite_joins(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_invite_joins_inviter ON invite_joins(inviter_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_inviter_stats_guild ON inviter_stats(guild_id)`);
            });
        });
    }

    // Cache invites for a guild
    async cacheGuildInvites(guild) {
        try {
            const invites = await guild.invites.fetch();
            const inviteMap = new Map();

            invites.forEach(invite => {
                inviteMap.set(invite.code, {
                    uses: invite.uses,
                    inviterId: invite.inviter?.id || null,
                    maxUses: invite.maxUses,
                    expiresAt: invite.expiresAt,
                    channelId: invite.channel?.id
                });
            });

            this.inviteCache.set(guild.id, inviteMap);

            // Cache vanity if available
            if (guild.vanityURLCode) {
                try {
                    const vanity = await guild.fetchVanityData();
                    this.vanityCache.set(guild.id, vanity.uses);
                } catch (e) {
                    // Guild might not have vanity
                }
            }

            return inviteMap;
        } catch (error) {
            this.bot.logger.error(`Failed to cache invites for guild ${guild.id}:`, error);
            return new Map();
        }
    }

    // Cache invites for all guilds
    async cacheAllGuildInvites() {
        for (const guild of this.bot.guilds.cache.values()) {
            await this.cacheGuildInvites(guild);
        }
        this.bot.logger.info(`Cached invites for ${this.inviteCache.size} guilds`);
    }

    // Get config for a guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM invite_tracker_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Enable/disable tracking
    async setEnabled(guildId, enabled) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO invite_tracker_config (guild_id, enabled)
                 VALUES (?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET enabled = ?`,
                [guildId, enabled ? 1 : 0, enabled ? 1 : 0],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Set log channel
    async setLogChannel(guildId, channelId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO invite_tracker_config (guild_id, log_channel_id)
                 VALUES (?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = ?`,
                [guildId, channelId, channelId],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Handle member join - find which invite was used
    async handleMemberJoin(member) {
        const config = await this.getConfig(member.guild.id);
        if (!config?.enabled) return null;

        const guild = member.guild;
        const oldInvites = this.inviteCache.get(guild.id) || new Map();
        
        // Fetch current invites
        let newInvites;
        try {
            newInvites = await guild.invites.fetch();
        } catch (error) {
            this.bot.logger.error(`Failed to fetch invites for ${guild.id}:`, error);
            return null;
        }

        // Find the used invite
        let usedInvite = null;
        let inviter = null;

        for (const [code, invite] of newInvites) {
            const oldInvite = oldInvites.get(code);
            if (oldInvite && invite.uses > oldInvite.uses) {
                usedInvite = invite;
                inviter = invite.inviter;
                break;
            }
        }

        // Check for new invites not in cache
        if (!usedInvite) {
            for (const [code, invite] of newInvites) {
                if (!oldInvites.has(code) && invite.uses > 0) {
                    usedInvite = invite;
                    inviter = invite.inviter;
                    break;
                }
            }
        }

        // Check vanity URL
        let joinType = 'invite';
        if (!usedInvite && guild.vanityURLCode) {
            try {
                const vanity = await guild.fetchVanityData();
                const oldVanity = this.vanityCache.get(guild.id) || 0;
                if (vanity.uses > oldVanity) {
                    joinType = 'vanity';
                    this.vanityCache.set(guild.id, vanity.uses);
                }
            } catch (e) {}
        }

        // Couldn't find invite - might be OAuth, Discovery, or Server Widget
        if (!usedInvite && joinType !== 'vanity') {
            // Check audit logs for more info
            try {
                const auditLogs = await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberUpdate,
                    limit: 5
                });
                
                // Could be from Discovery, Widget, or OAuth
                joinType = 'unknown';
            } catch (e) {}
        }

        // Calculate account age
        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
        const isFake = accountAge < 7; // Less than 7 days old = possibly fake

        // Record the join
        await this.recordJoin(
            guild.id,
            member.id,
            inviter?.id || null,
            usedInvite?.code || null,
            joinType,
            accountAge,
            isFake
        );

        // Update inviter stats
        if (inviter) {
            await this.updateInviterStats(guild.id, inviter.id, 1, isFake ? 1 : 0, 0);
        }

        // Update cache
        await this.cacheGuildInvites(guild);

        // Log the join
        await this.logJoin(member, inviter, usedInvite, joinType, accountAge, isFake, config);

        return { inviter, usedInvite, joinType, accountAge, isFake };
    }

    // Handle member leave
    async handleMemberLeave(member) {
        const config = await this.getConfig(member.guild.id);
        if (!config?.enabled || !config.track_leaves) return;

        // Find who invited this user
        const joinRecord = await this.getJoinRecord(member.guild.id, member.id);
        
        if (joinRecord) {
            // Update leave time
            await this.updateLeaveTime(member.guild.id, member.id);

            // Update inviter stats
            if (joinRecord.inviter_id) {
                await this.updateInviterStats(member.guild.id, joinRecord.inviter_id, 0, 0, 1);
            }

            // Log the leave
            await this.logLeave(member, joinRecord, config);
        }
    }

    // Record a join in database
    async recordJoin(guildId, userId, inviterId, inviteCode, joinType, accountAge, isFake) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO invite_joins (guild_id, user_id, inviter_id, invite_code, join_type, account_age_days, is_fake)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [guildId, userId, inviterId, inviteCode, joinType, accountAge, isFake ? 1 : 0],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get join record for a user
    async getJoinRecord(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM invite_joins WHERE guild_id = ? AND user_id = ? ORDER BY joined_at DESC LIMIT 1`,
                [guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Update leave time
    async updateLeaveTime(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE invite_joins SET left_at = CURRENT_TIMESTAMP
                 WHERE guild_id = ? AND user_id = ? AND left_at IS NULL`,
                [guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });
    }

    // Update inviter stats
    async updateInviterStats(guildId, inviterId, newInvites, fakeInvites, leftInvites) {
        return new Promise((resolve, reject) => {
            const regular = newInvites - fakeInvites;
            this.db.run(
                `INSERT INTO inviter_stats (guild_id, inviter_id, total_invites, regular_invites, fake_invites, left_invites)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(guild_id, inviter_id) DO UPDATE SET
                    total_invites = total_invites + ?,
                    regular_invites = regular_invites + ?,
                    fake_invites = fake_invites + ?,
                    left_invites = left_invites + ?`,
                [guildId, inviterId, newInvites, regular, fakeInvites, leftInvites,
                 newInvites, regular, fakeInvites, leftInvites],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Get inviter stats
    async getInviterStats(guildId, inviterId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM inviter_stats WHERE guild_id = ? AND inviter_id = ?`,
                [guildId, inviterId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || {
                        total_invites: 0,
                        regular_invites: 0,
                        bonus_invites: 0,
                        fake_invites: 0,
                        left_invites: 0
                    });
                }
            );
        });
    }

    // Get top inviters
    async getLeaderboard(guildId, limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT *,
                    (regular_invites + bonus_invites - fake_invites - left_invites) as effective_invites
                 FROM inviter_stats
                 WHERE guild_id = ?
                 ORDER BY effective_invites DESC
                 LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Add bonus invites
    async addBonusInvites(guildId, inviterId, amount) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO inviter_stats (guild_id, inviter_id, bonus_invites)
                 VALUES (?, ?, ?)
                 ON CONFLICT(guild_id, inviter_id) DO UPDATE SET
                    bonus_invites = bonus_invites + ?`,
                [guildId, inviterId, amount, amount],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Reset inviter stats
    async resetInviterStats(guildId, inviterId = null) {
        return new Promise((resolve, reject) => {
            if (inviterId) {
                this.db.run(
                    `DELETE FROM inviter_stats WHERE guild_id = ? AND inviter_id = ?`,
                    [guildId, inviterId],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    }
                );
            } else {
                this.db.run(
                    `DELETE FROM inviter_stats WHERE guild_id = ?`,
                    [guildId],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes);
                    }
                );
            }
        });
    }

    // Get who invited a user
    async getInviter(guildId, userId) {
        const record = await this.getJoinRecord(guildId, userId);
        return record?.inviter_id || null;
    }

    // Get users invited by someone
    async getInvitedUsers(guildId, inviterId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM invite_joins WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC`,
                [guildId, inviterId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Log join to channel
    async logJoin(member, inviter, usedInvite, joinType, accountAge, isFake, config) {
        if (!config?.log_channel_id) return;

        const channel = await member.guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle('📥 Member Joined')
            .setColor(isFake ? 0xFFA500 : 0x00FF00)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Member', value: `${member.user.tag}\n${member.user.id}`, inline: true },
                { name: 'Account Age', value: `${accountAge} days`, inline: true },
                { name: 'Join Type', value: joinType, inline: true }
            )
            .setTimestamp();

        if (inviter) {
            const stats = await this.getInviterStats(member.guild.id, inviter.id);
            const effective = stats.regular_invites + stats.bonus_invites - stats.fake_invites - stats.left_invites;
            embed.addFields(
                { name: 'Invited By', value: `${inviter.tag}\n${inviter.id}`, inline: true },
                { name: 'Invite Code', value: usedInvite?.code || 'Unknown', inline: true },
                { name: 'Inviter Stats', value: `Total: ${effective} (${stats.regular_invites} regular, ${stats.bonus_invites} bonus, ${stats.fake_invites} fake, ${stats.left_invites} left)`, inline: false }
            );
        } else {
            embed.addFields(
                { name: 'Invited By', value: 'Could not determine', inline: true }
            );
        }

        if (isFake) {
            embed.setDescription('⚠️ **Suspicious Account** - Account is less than 7 days old');
        }

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Log leave to channel
    async logLeave(member, joinRecord, config) {
        if (!config?.log_channel_id) return;

        const channel = await member.guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const stayDuration = joinRecord.joined_at ? 
            Math.floor((Date.now() - new Date(joinRecord.joined_at).getTime()) / (1000 * 60 * 60 * 24)) : 0;

        const embed = new EmbedBuilder()
            .setTitle('📤 Member Left')
            .setColor(0xFF0000)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Member', value: `${member.user.tag}\n${member.user.id}`, inline: true },
                { name: 'Stay Duration', value: `${stayDuration} days`, inline: true }
            )
            .setTimestamp();

        if (joinRecord.inviter_id) {
            const inviter = await this.bot.users.fetch(joinRecord.inviter_id).catch(() => null);
            if (inviter) {
                const stats = await this.getInviterStats(member.guild.id, inviter.id);
                const effective = stats.regular_invites + stats.bonus_invites - stats.fake_invites - stats.left_invites;
                embed.addFields(
                    { name: 'Originally Invited By', value: `${inviter.tag}`, inline: true },
                    { name: 'Inviter Stats Now', value: `Total: ${effective}`, inline: true }
                );
            }
        }

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Get recent joins for raid detection
    async getRecentJoins(guildId, minutes = 10) {
        return new Promise((resolve, reject) => {
            const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
            this.db.all(
                `SELECT * FROM invite_joins WHERE guild_id = ? AND joined_at > ? ORDER BY joined_at DESC`,
                [guildId, cutoff],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Check for potential raid (many joins from same invite)
    async checkRaidPattern(guildId) {
        const recentJoins = await this.getRecentJoins(guildId, 5);
        
        // Group by invite code
        const inviteCounts = {};
        for (const join of recentJoins) {
            if (join.invite_code) {
                inviteCounts[join.invite_code] = (inviteCounts[join.invite_code] || 0) + 1;
            }
        }

        // Check for suspicious patterns
        const suspicious = [];
        for (const [code, count] of Object.entries(inviteCounts)) {
            if (count >= 5) { // 5+ joins from same invite in 5 minutes
                suspicious.push({ code, count });
            }
        }

        // Check for many new accounts
        const newAccounts = recentJoins.filter(j => j.account_age_days < 7);
        if (newAccounts.length >= 5) {
            suspicious.push({ type: 'new_accounts', count: newAccounts.length });
        }

        return suspicious;
    }
}

module.exports = InviteTracker;
