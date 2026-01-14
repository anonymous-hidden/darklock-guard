/**
 * Appeal System
 * Allows banned users to submit appeals for review
 * Integrates with scheduled actions for temporary bans
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

class AppealSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
    }

    async initialize() {
        await this.ensureTables();
        this.bot.logger.info('AppealSystem initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Appeal system config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS appeal_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        review_channel_id TEXT,
                        cooldown_hours INTEGER DEFAULT 168,
                        auto_dm_banned INTEGER DEFAULT 1,
                        appeal_url TEXT,
                        required_questions TEXT DEFAULT '[]',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Appeals
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS appeals (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        ban_reason TEXT,
                        appeal_reason TEXT NOT NULL,
                        additional_info TEXT,
                        answers TEXT,
                        status TEXT DEFAULT 'pending',
                        reviewer_id TEXT,
                        reviewer_notes TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        reviewed_at DATETIME
                    )
                `);

                // Appeal messages (for tracking DMs sent)
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS appeal_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        appeal_id INTEGER NOT NULL,
                        message_id TEXT NOT NULL,
                        channel_id TEXT,
                        type TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (appeal_id) REFERENCES appeals(id)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_appeals_guild ON appeals(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status)`);
            });
        });
    }

    // Get config for a guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM appeal_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup appeal system
    async setup(guildId, settings) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO appeal_config (guild_id, enabled, review_channel_id, cooldown_hours, auto_dm_banned, appeal_url)
                 VALUES (?, 1, ?, ?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    review_channel_id = ?,
                    cooldown_hours = ?,
                    auto_dm_banned = ?,
                    appeal_url = ?`,
                [guildId, settings.reviewChannelId, settings.cooldownHours || 168, 
                 settings.autoDmBanned ? 1 : 0, settings.appealUrl,
                 settings.reviewChannelId, settings.cooldownHours || 168,
                 settings.autoDmBanned ? 1 : 0, settings.appealUrl],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Toggle appeal system
    async setEnabled(guildId, enabled) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE appeal_config SET enabled = ? WHERE guild_id = ?`,
                [enabled ? 1 : 0, guildId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Handle ban event - send appeal info to banned user
    async handleBan(guildBan) {
        const config = await this.getConfig(guildBan.guild.id);
        if (!config?.enabled || !config.auto_dm_banned) return;

        try {
            const embed = new EmbedBuilder()
                .setTitle(`⚠️ You have been banned from ${guildBan.guild.name}`)
                .setColor(0xFF0000)
                .setThumbnail(guildBan.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: 'Reason', value: guildBan.reason || 'No reason provided', inline: false }
                )
                .setTimestamp();

            if (config.appeal_url) {
                embed.setDescription(`If you believe this ban was in error, you can appeal using the link below:\n\n**Appeal URL:** ${config.appeal_url}`);
            } else {
                embed.setDescription('You may be able to appeal this ban. Contact the server staff for more information.');
            }

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`appeal_submit_${guildBan.guild.id}`)
                    .setLabel('Submit Appeal')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝')
            );

            await guildBan.user.send({ embeds: [embed], components: [buttons] }).catch(() => {});
        } catch (error) {
            this.bot.logger.debug('Could not send appeal DM:', error.message);
        }
    }

    // Check if user can submit appeal (cooldown check)
    async canSubmitAppeal(guildId, odod) {
        const config = await this.getConfig(guildId);
        if (!config) return { allowed: false, reason: 'Appeals not configured' };

        // Check for existing pending appeal
        const pending = await this.getPendingAppeal(guildId, odod);
        if (pending) {
            return { allowed: false, reason: 'You already have a pending appeal.' };
        }

        // Check cooldown
        const lastAppeal = await this.getLastAppeal(guildId, odod);
        if (lastAppeal) {
            const cooldownMs = config.cooldown_hours * 60 * 60 * 1000;
            const lastAppealTime = new Date(lastAppeal.created_at).getTime();
            const timeSince = Date.now() - lastAppealTime;

            if (timeSince < cooldownMs) {
                const remaining = Math.ceil((cooldownMs - timeSince) / (60 * 60 * 1000));
                return { 
                    allowed: false, 
                    reason: `You must wait ${remaining} hours before submitting another appeal.`
                };
            }
        }

        return { allowed: true };
    }

    // Get pending appeal
    async getPendingAppeal(guildId, odod) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM appeals WHERE guild_id = ? AND user_id = ? AND status = 'pending'`,
                [guildId, odod],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Get last appeal
    async getLastAppeal(guildId, odod) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM appeals WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
                [guildId, odod],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Submit appeal
    async submitAppeal(guildId, odod, data) {
        const { allowed, reason } = await this.canSubmitAppeal(guildId, odod);
        if (!allowed) {
            return { success: false, error: reason };
        }

        try {
            const appealId = await new Promise((resolve, reject) => {
                this.db.run(
                    `INSERT INTO appeals (guild_id, user_id, ban_reason, appeal_reason, additional_info, answers)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [guildId, odod, data.banReason, data.appealReason, data.additionalInfo, JSON.stringify(data.answers || {})],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    }
                );
            });

            // Send to review channel
            await this.sendToReviewChannel(guildId, appealId, odod, data);

            return { success: true, appealId };
        } catch (error) {
            this.bot.logger.error('Failed to submit appeal:', error);
            return { success: false, error: 'Failed to submit appeal. Please try again later.' };
        }
    }

    // Send appeal to review channel
    async sendToReviewChannel(guildId, appealId, odod, data) {
        const config = await this.getConfig(guildId);
        if (!config?.review_channel_id) return;

        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return;

        const channel = await guild.channels.fetch(config.review_channel_id).catch(() => null);
        if (!channel) return;

        const user = await this.bot.client.users.fetch(odod).catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle('📝 New Ban Appeal')
            .setColor(0xFFA500)
            .setThumbnail(user?.displayAvatarURL({ dynamic: true }) || null)
            .addFields(
                { name: 'User', value: user ? `${user.tag}\n${user.id}` : odod, inline: true },
                { name: 'Appeal ID', value: `#${appealId}`, inline: true },
                { name: 'Account Age', value: user ? `${Math.floor((Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24))} days` : 'Unknown', inline: true },
                { name: 'Ban Reason', value: data.banReason || 'Not specified', inline: false },
                { name: 'Appeal Reason', value: data.appealReason.slice(0, 1000), inline: false }
            )
            .setTimestamp();

        if (data.additionalInfo) {
            embed.addFields({ name: 'Additional Information', value: data.additionalInfo.slice(0, 1000), inline: false });
        }

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`appeal_approve_${appealId}`)
                .setLabel('Approve (Unban)')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId(`appeal_deny_${appealId}`)
                .setLabel('Deny')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌'),
            new ButtonBuilder()
                .setCustomId(`appeal_info_${appealId}`)
                .setLabel('Request Info')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('❓')
        );

        const msg = await channel.send({ embeds: [embed], components: [buttons] });

        // Store message reference
        await new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO appeal_messages (appeal_id, message_id, channel_id, type)
                 VALUES (?, ?, ?, 'review')`,
                [appealId, msg.id, channel.id],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Approve appeal
    async approveAppeal(appealId, reviewerId, notes = null) {
        const appeal = await this.getAppeal(appealId);
        if (!appeal) return { success: false, error: 'Appeal not found' };
        if (appeal.status !== 'pending') return { success: false, error: 'Appeal already reviewed' };

        try {
            // Update appeal status
            await new Promise((resolve, reject) => {
                this.db.run(
                    `UPDATE appeals SET status = 'approved', reviewer_id = ?, reviewer_notes = ?, reviewed_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [reviewerId, notes, appealId],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes > 0);
                    }
                );
            });

            // Unban the user
            const guild = await this.bot.client.guilds.fetch(appeal.guild_id).catch(() => null);
            if (guild) {
                await guild.members.unban(appeal.user_id, `Appeal #${appealId} approved by ${reviewerId}`).catch(() => {});
            }

            // Notify user
            await this.notifyUser(appeal.user_id, appeal.guild_id, 'approved', notes);

            return { success: true };
        } catch (error) {
            this.bot.logger.error('Failed to approve appeal:', error);
            return { success: false, error: error.message };
        }
    }

    // Deny appeal
    async denyAppeal(appealId, reviewerId, notes = null) {
        const appeal = await this.getAppeal(appealId);
        if (!appeal) return { success: false, error: 'Appeal not found' };
        if (appeal.status !== 'pending') return { success: false, error: 'Appeal already reviewed' };

        try {
            await new Promise((resolve, reject) => {
                this.db.run(
                    `UPDATE appeals SET status = 'denied', reviewer_id = ?, reviewer_notes = ?, reviewed_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [reviewerId, notes, appealId],
                    function(err) {
                        if (err) reject(err);
                        else resolve(this.changes > 0);
                    }
                );
            });

            // Notify user
            await this.notifyUser(appeal.user_id, appeal.guild_id, 'denied', notes);

            return { success: true };
        } catch (error) {
            this.bot.logger.error('Failed to deny appeal:', error);
            return { success: false, error: error.message };
        }
    }

    // Get appeal
    async getAppeal(appealId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM appeals WHERE id = ?`,
                [appealId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Notify user of appeal result
    async notifyUser(odod, guildId, status, notes) {
        try {
            const user = await this.bot.client.users.fetch(odod).catch(() => null);
            if (!user) return;

            const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);

            const embed = new EmbedBuilder()
                .setTitle(status === 'approved' ? '✅ Appeal Approved' : '❌ Appeal Denied')
                .setColor(status === 'approved' ? 0x00FF00 : 0xFF0000)
                .setDescription(
                    status === 'approved'
                        ? `Your ban appeal for **${guild?.name || 'Unknown Server'}** has been approved! You have been unbanned.`
                        : `Your ban appeal for **${guild?.name || 'Unknown Server'}** has been denied.`
                )
                .setTimestamp();

            if (notes) {
                embed.addFields({ name: 'Staff Notes', value: notes.slice(0, 1000), inline: false });
            }

            await user.send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            this.bot.logger.debug('Could not notify user of appeal result:', error.message);
        }
    }

    // Get pending appeals for a guild
    async getPendingAppeals(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM appeals WHERE guild_id = ? AND status = 'pending' ORDER BY created_at ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Get all appeals for a guild
    async getGuildAppeals(guildId, status = null, limit = 20) {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM appeals WHERE guild_id = ?`;
            const params = [guildId];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }

            query += ` ORDER BY created_at DESC LIMIT ?`;
            params.push(limit);

            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Get user's appeals
    async getUserAppeals(guildId, odod) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM appeals WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC`,
                [guildId, odod],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }
}

module.exports = AppealSystem;
