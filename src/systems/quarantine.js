/**
 * Quarantine Role System
 * Isolates suspicious users with restrictive permissions
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

class QuarantineSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('QuarantineSystem initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Quarantine config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS quarantine_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        quarantine_role_id TEXT,
                        log_channel_id TEXT,
                        review_channel_id TEXT,
                        auto_quarantine_alts INTEGER DEFAULT 1,
                        auto_quarantine_new_accounts INTEGER DEFAULT 0,
                        new_account_days INTEGER DEFAULT 7,
                        dm_on_quarantine INTEGER DEFAULT 1,
                        release_requires_review INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Quarantined users
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS quarantined_users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        quarantined_by TEXT,
                        reason TEXT,
                        auto_reason TEXT,
                        previous_roles TEXT,
                        status TEXT DEFAULT 'quarantined',
                        reviewed_by TEXT,
                        reviewed_at DATETIME,
                        review_notes TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        released_at DATETIME,
                        UNIQUE(guild_id, user_id, status)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_quarantined_guild ON quarantined_users(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_quarantined_user ON quarantined_users(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_quarantined_status ON quarantined_users(status)`);
            });
        });
    }

    // Get config for guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM quarantine_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup quarantine system
    async setup(guildId, options = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO quarantine_config (guild_id, enabled, quarantine_role_id, log_channel_id, review_channel_id)
                 VALUES (?, 1, ?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    quarantine_role_id = ?,
                    log_channel_id = ?,
                    review_channel_id = ?`,
                [guildId, options.roleId, options.logChannelId, options.reviewChannelId,
                 options.roleId, options.logChannelId, options.reviewChannelId],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Update config settings
    async updateConfig(guildId, settings) {
        const updates = [];
        const values = [];

        const allowedFields = ['auto_quarantine_alts', 'auto_quarantine_new_accounts', 'new_account_days', 
                              'dm_on_quarantine', 'release_requires_review', 'enabled'];

        for (const [key, value] of Object.entries(settings)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = ?`);
                values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
            }
        }

        if (updates.length === 0) return false;
        values.push(guildId);

        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE quarantine_config SET ${updates.join(', ')} WHERE guild_id = ?`,
                values,
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Create quarantine role if it doesn't exist
    async createOrGetQuarantineRole(guild) {
        const config = await this.getConfig(guild.id);
        
        if (config?.quarantine_role_id) {
            const existingRole = await guild.roles.fetch(config.quarantine_role_id).catch(() => null);
            if (existingRole) return existingRole;
        }

        // Create the quarantine role
        const role = await guild.roles.create({
            name: '🔒 Quarantine',
            color: 0x808080,
            permissions: [],
            reason: 'Quarantine system role'
        });

        // Set channel overwrites to restrict the role
        await this.applyQuarantineOverwrites(guild, role);

        // Save role ID to config
        await this.setup(guild.id, { roleId: role.id });

        return role;
    }

    // Apply quarantine overwrites to all channels
    async applyQuarantineOverwrites(guild, role) {
        const channels = await guild.channels.fetch();

        for (const [, channel] of channels) {
            if (!channel.permissionOverwrites) continue;

            try {
                await channel.permissionOverwrites.edit(role, {
                    ViewChannel: false,
                    SendMessages: false,
                    AddReactions: false,
                    Connect: false,
                    Speak: false
                }, { reason: 'Quarantine role setup' });
            } catch (error) {
                // Skip channels we can't edit
            }
        }
    }

    // Quarantine a user
    async quarantineUser(guildId, userId, options = {}) {
        const config = await this.getConfig(guildId);
        if (!config?.enabled || !config?.quarantine_role_id) {
            return { success: false, error: 'Quarantine system not configured' };
        }

        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return { success: false, error: 'Guild not found' };

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { success: false, error: 'Member not found' };

        const quarantineRole = await guild.roles.fetch(config.quarantine_role_id).catch(() => null);
        if (!quarantineRole) return { success: false, error: 'Quarantine role not found' };

        // Check if already quarantined
        const existing = await this.getQuarantineStatus(guildId, userId);
        if (existing?.status === 'quarantined') {
            return { success: false, error: 'User is already quarantined' };
        }

        // Store previous roles
        const previousRoles = member.roles.cache
            .filter(r => r.id !== guild.id && r.id !== config.quarantine_role_id)
            .map(r => r.id);

        // Remove all roles and add quarantine role
        try {
            await member.roles.set([quarantineRole.id], 'User quarantined');
        } catch (error) {
            return { success: false, error: 'Failed to modify roles: ' + error.message };
        }

        // Save to database
        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO quarantined_users (guild_id, user_id, quarantined_by, reason, auto_reason, previous_roles)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [guildId, userId, options.moderatorId, options.reason, options.autoReason, JSON.stringify(previousRoles)],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // DM user if enabled
        if (config.dm_on_quarantine) {
            await this.dmUser(guild, member, options.reason || options.autoReason);
        }

        // Log to channel
        await this.logAction(guild, config, 'quarantine', member, options);

        // Post to review channel
        if (config.review_channel_id) {
            await this.postForReview(guild, config, member, options);
        }

        return { success: true, previousRoles };
    }

    // Release a user from quarantine
    async releaseUser(guildId, userId, options = {}) {
        const config = await this.getConfig(guildId);
        if (!config) return { success: false, error: 'Quarantine system not configured' };

        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return { success: false, error: 'Guild not found' };

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { success: false, error: 'Member not found' };

        const quarantineData = await this.getQuarantineStatus(guildId, userId);
        if (!quarantineData || quarantineData.status !== 'quarantined') {
            return { success: false, error: 'User is not quarantined' };
        }

        // Restore previous roles
        const previousRoles = JSON.parse(quarantineData.previous_roles || '[]');
        
        try {
            const rolesToAdd = [];
            for (const roleId of previousRoles) {
                const role = await guild.roles.fetch(roleId).catch(() => null);
                if (role) rolesToAdd.push(role);
            }

            // Remove quarantine role and restore previous roles
            if (config.quarantine_role_id) {
                await member.roles.remove(config.quarantine_role_id, 'Released from quarantine');
            }
            if (rolesToAdd.length > 0) {
                await member.roles.add(rolesToAdd, 'Released from quarantine');
            }
        } catch (error) {
            return { success: false, error: 'Failed to restore roles: ' + error.message };
        }

        // Update database
        await new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE quarantined_users SET 
                    status = 'released',
                    reviewed_by = ?,
                    reviewed_at = CURRENT_TIMESTAMP,
                    review_notes = ?,
                    released_at = CURRENT_TIMESTAMP
                 WHERE guild_id = ? AND user_id = ? AND status = 'quarantined'`,
                [options.moderatorId, options.notes, guildId, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });

        // Log release
        await this.logAction(guild, config, 'release', member, options);

        // DM user about release
        try {
            const user = await this.bot.client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setTitle('🔓 Released from Quarantine')
                .setColor(0x00FF00)
                .setDescription(`You have been released from quarantine in **${guild.name}**.`)
                .setTimestamp();

            if (options.notes) {
                embed.addFields({ name: 'Notes', value: options.notes, inline: false });
            }

            await user.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            // Ignore DM failures
        }

        return { success: true };
    }

    // Get user's quarantine status
    async getQuarantineStatus(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM quarantined_users 
                 WHERE guild_id = ? AND user_id = ? 
                 ORDER BY created_at DESC LIMIT 1`,
                [guildId, userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Get all quarantined users
    async getQuarantinedUsers(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM quarantined_users 
                 WHERE guild_id = ? AND status = 'quarantined'
                 ORDER BY created_at DESC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get quarantine history for a user
    async getUserHistory(guildId, userId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM quarantined_users 
                 WHERE guild_id = ? AND user_id = ?
                 ORDER BY created_at DESC`,
                [guildId, userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Auto-quarantine check for new members
    async checkNewMember(member) {
        const config = await this.getConfig(member.guild.id);
        if (!config?.enabled) return false;

        let autoReason = null;

        // Check account age
        if (config.auto_quarantine_new_accounts) {
            const accountAge = Date.now() - member.user.createdTimestamp;
            const minAge = (config.new_account_days || 7) * 24 * 60 * 60 * 1000;

            if (accountAge < minAge) {
                autoReason = `Account too new (${Math.floor(accountAge / 86400000)} days old, minimum is ${config.new_account_days} days)`;
            }
        }

        // If auto-quarantine triggered
        if (autoReason) {
            await this.quarantineUser(member.guild.id, member.id, {
                autoReason,
                reason: 'Auto-quarantine: ' + autoReason
            });
            return true;
        }

        return false;
    }

    // DM user about quarantine
    async dmUser(guild, member, reason) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('🔒 You Have Been Quarantined')
                .setColor(0xFF6600)
                .setDescription(`You have been placed in quarantine in **${guild.name}**.`)
                .addFields(
                    { name: 'Reason', value: reason || 'No reason provided', inline: false },
                    { name: 'What does this mean?', value: 'Your access to server channels has been restricted pending review by moderators.', inline: false }
                )
                .setTimestamp();

            await member.send({ embeds: [embed] });
        } catch (error) {
            // User may have DMs disabled
        }
    }

    // Log action to log channel
    async logAction(guild, config, action, member, options = {}) {
        if (!config.log_channel_id) return;

        const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTimestamp();

        if (action === 'quarantine') {
            embed
                .setTitle('🔒 User Quarantined')
                .setColor(0xFF6600)
                .addFields(
                    { name: 'User', value: `${member.user.tag}\n${member.id}`, inline: true },
                    { name: 'Moderator', value: options.moderatorId ? `<@${options.moderatorId}>` : 'Auto', inline: true },
                    { name: 'Reason', value: options.reason || options.autoReason || 'No reason', inline: false }
                );
        } else if (action === 'release') {
            embed
                .setTitle('🔓 User Released')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'User', value: `${member.user.tag}\n${member.id}`, inline: true },
                    { name: 'Released By', value: options.moderatorId ? `<@${options.moderatorId}>` : 'Unknown', inline: true }
                );

            if (options.notes) {
                embed.addFields({ name: 'Notes', value: options.notes, inline: false });
            }
        }

        await channel.send({ embeds: [embed] }).catch(() => {});
    }

    // Post to review channel for moderator action
    async postForReview(guild, config, member, options = {}) {
        const channel = await guild.channels.fetch(config.review_channel_id).catch(() => null);
        if (!channel) return;

        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);

        const embed = new EmbedBuilder()
            .setTitle('🔍 Quarantine Review Required')
            .setColor(0xFFCC00)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${member.user.tag}\n<@${member.id}>`, inline: true },
                { name: 'Account Age', value: `${accountAge} days`, inline: true },
                { name: 'Joined Server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Reason', value: options.reason || options.autoReason || 'No reason provided', inline: false }
            )
            .setTimestamp();

        // Add action buttons
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`quarantine_release_${member.id}`)
                .setLabel('Release')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔓'),
            new ButtonBuilder()
                .setCustomId(`quarantine_kick_${member.id}`)
                .setLabel('Kick')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('👢'),
            new ButtonBuilder()
                .setCustomId(`quarantine_ban_${member.id}`)
                .setLabel('Ban')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔨')
        );

        await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }
}

module.exports = QuarantineSystem;
