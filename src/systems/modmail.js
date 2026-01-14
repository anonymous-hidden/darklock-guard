/**
 * ModMail System
 * Users DM the bot to create private threads with staff
 * Supports anonymous messaging, categories, and logging
 */

const { EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

class ModMail {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        // Active ticket sessions
        this.activeSessions = new Map(); // odod -> { guildId, threadId }
    }

    async initialize() {
        await this.ensureTables();
        await this.loadActiveSessions();
        this.bot.logger.info('ModMail system initialized');
    }

    async ensureTables() {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // ModMail config per guild
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS modmail_config (
                        guild_id TEXT PRIMARY KEY,
                        enabled INTEGER DEFAULT 0,
                        category_id TEXT,
                        log_channel_id TEXT,
                        staff_role_id TEXT,
                        greeting_message TEXT,
                        anonymous_staff INTEGER DEFAULT 0,
                        close_confirmation INTEGER DEFAULT 1,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // ModMail tickets
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS modmail_tickets (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        thread_id TEXT,
                        channel_id TEXT,
                        status TEXT DEFAULT 'open',
                        category TEXT,
                        priority TEXT DEFAULT 'normal',
                        assigned_to TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        closed_at DATETIME,
                        closed_by TEXT,
                        close_reason TEXT
                    )
                `);

                // ModMail messages
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS modmail_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticket_id INTEGER NOT NULL,
                        sender_id TEXT NOT NULL,
                        sender_type TEXT NOT NULL,
                        content TEXT,
                        attachments TEXT,
                        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (ticket_id) REFERENCES modmail_tickets(id)
                    )
                `);

                // Snippets/canned responses
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS modmail_snippets (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        content TEXT NOT NULL,
                        created_by TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(guild_id, name)
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_modmail_tickets_guild ON modmail_tickets(guild_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_modmail_tickets_user ON modmail_tickets(user_id)`);
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_modmail_tickets_status ON modmail_tickets(status)`);
            });
        });
    }

    // Load active sessions on startup
    async loadActiveSessions() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM modmail_tickets WHERE status = 'open'`,
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        for (const ticket of (rows || [])) {
                            this.activeSessions.set(ticket.user_id, {
                                guildId: ticket.guild_id,
                                threadId: ticket.thread_id || ticket.channel_id,
                                ticketId: ticket.id
                            });
                        }
                        this.bot.logger.info(`Loaded ${this.activeSessions.size} active modmail sessions`);
                        resolve();
                    }
                }
            );
        });
    }

    // Get config for a guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM modmail_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup modmail for a guild
    async setup(guildId, settings) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO modmail_config (guild_id, enabled, category_id, log_channel_id, staff_role_id, greeting_message)
                 VALUES (?, 1, ?, ?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = 1,
                    category_id = ?,
                    log_channel_id = ?,
                    staff_role_id = ?,
                    greeting_message = ?`,
                [guildId, settings.categoryId, settings.logChannelId, settings.staffRoleId, settings.greetingMessage,
                 settings.categoryId, settings.logChannelId, settings.staffRoleId, settings.greetingMessage],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Toggle modmail
    async setEnabled(guildId, enabled) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE modmail_config SET enabled = ? WHERE guild_id = ?`,
                [enabled ? 1 : 0, guildId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Handle incoming DM
    async handleDM(message) {
        // Check if user has active session
        const activeSession = this.activeSessions.get(message.author.id);

        if (activeSession) {
            // Forward to existing thread
            await this.forwardToThread(message, activeSession);
            return;
        }

        // Check all guilds for modmail setup where user is member
        const configs = await this.getEnabledGuilds();

        // Find guilds where user is a member
        const userGuilds = [];
        for (const config of configs) {
            try {
                const guild = await this.bot.client.guilds.fetch(config.guild_id).catch(() => null);
                if (!guild) continue;

                const member = await guild.members.fetch(message.author.id).catch(() => null);
                if (member) {
                    userGuilds.push({ guild, config });
                }
            } catch (e) {
                // Skip
            }
        }

        if (userGuilds.length === 0) {
            await message.reply('❌ You are not in any servers with ModMail enabled.');
            return;
        }

        if (userGuilds.length === 1) {
            // Auto-create ticket in the only guild
            await this.createTicket(message, userGuilds[0].guild, userGuilds[0].config);
        } else {
            // Ask user to select guild
            await this.promptGuildSelection(message, userGuilds);
        }
    }

    // Get all enabled guild configs
    async getEnabledGuilds() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM modmail_config WHERE enabled = 1`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Prompt user to select a guild
    async promptGuildSelection(message, userGuilds) {
        const embed = new EmbedBuilder()
            .setTitle('📬 ModMail - Select Server')
            .setDescription('You are a member of multiple servers with ModMail. Please select which server you want to contact:')
            .setColor(0x5865F2);

        const buttons = [];
        for (let i = 0; i < Math.min(userGuilds.length, 5); i++) {
            const { guild } = userGuilds[i];
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`modmail_select_${guild.id}`)
                    .setLabel(guild.name.slice(0, 80))
                    .setStyle(ButtonStyle.Primary)
            );
        }

        const row = new ActionRowBuilder().addComponents(buttons);

        await message.reply({ embeds: [embed], components: [row] });
    }

    // Handle guild selection
    async handleGuildSelection(interaction, guildId) {
        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            await interaction.reply({ content: '❌ Server not found.', ephemeral: true });
            return;
        }

        const config = await this.getConfig(guildId);
        if (!config?.enabled) {
            await interaction.reply({ content: '❌ ModMail is not enabled on this server.', ephemeral: true });
            return;
        }

        // Create a fake message object for createTicket
        const fakeMessage = {
            author: interaction.user,
            content: interaction.message.content || 'Started a new modmail conversation',
            attachments: new Map(),
            reply: (content) => interaction.reply(content)
        };

        await this.createTicket(fakeMessage, guild, config);
        await interaction.update({ content: '✅ Creating ticket...', components: [], embeds: [] });
    }

    // Create a new modmail ticket
    async createTicket(message, guild, config) {
        try {
            // Create thread/channel in the category
            const category = config.category_id ? 
                await guild.channels.fetch(config.category_id).catch(() => null) : null;

            const channelName = `modmail-${message.author.username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`;

            const channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category?.id,
                topic: `ModMail ticket for ${message.author.tag} (${message.author.id})`,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: this.bot.client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
                    },
                    ...(config.staff_role_id ? [{
                        id: config.staff_role_id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }] : [])
                ]
            });

            // Create ticket in database
            const ticketId = await this.createTicketRecord(guild.id, message.author.id, channel.id);

            // Store active session
            this.activeSessions.set(message.author.id, {
                guildId: guild.id,
                threadId: channel.id,
                ticketId
            });

            // Send initial embed to staff
            const staffEmbed = new EmbedBuilder()
                .setTitle('📬 New ModMail Ticket')
                .setColor(0x5865F2)
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'User', value: `${message.author.tag}\n${message.author.id}`, inline: true },
                    { name: 'Account Age', value: `${Math.floor((Date.now() - message.author.createdTimestamp) / (1000 * 60 * 60 * 24))} days`, inline: true },
                    { name: 'Ticket ID', value: `#${ticketId}`, inline: true }
                )
                .setTimestamp();

            const staffButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`modmail_close_${ticketId}`)
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId(`modmail_claim_${ticketId}`)
                    .setLabel('Claim')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✋')
            );

            await channel.send({ 
                content: config.staff_role_id ? `<@&${config.staff_role_id}>` : undefined,
                embeds: [staffEmbed], 
                components: [staffButtons] 
            });

            // Forward initial message
            if (message.content) {
                await this.forwardToThread(message, { guildId: guild.id, threadId: channel.id, ticketId });
            }

            // Send confirmation to user
            const greeting = config.greeting_message || 
                `Your message has been sent to **${guild.name}** staff. They will reply as soon as possible.`;

            const userEmbed = new EmbedBuilder()
                .setTitle('📬 ModMail Ticket Created')
                .setDescription(greeting)
                .setColor(0x00FF00)
                .setFooter({ text: `Ticket #${ticketId} | ${guild.name}` })
                .setTimestamp();

            await message.reply({ embeds: [userEmbed] });

            // Log ticket creation
            await this.logTicketAction(guild, config, 'created', message.author, ticketId);

        } catch (error) {
            this.bot.logger.error('Failed to create modmail ticket:', error);
            await message.reply('❌ Failed to create ticket. Please try again later.');
        }
    }

    // Create ticket record
    async createTicketRecord(guildId, odod, channelId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO modmail_tickets (guild_id, user_id, channel_id, status)
                 VALUES (?, ?, ?, 'open')`,
                [guildId, odod, channelId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Forward message to thread
    async forwardToThread(message, session) {
        try {
            const guild = await this.bot.client.guilds.fetch(session.guildId).catch(() => null);
            if (!guild) return;

            const channel = await guild.channels.fetch(session.threadId).catch(() => null);
            if (!channel) return;

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: message.author.tag, 
                    iconURL: message.author.displayAvatarURL({ dynamic: true }) 
                })
                .setDescription(message.content || '*No content*')
                .setColor(0x5865F2)
                .setFooter({ text: `User → Staff` })
                .setTimestamp();

            // Handle attachments
            const files = [];
            if (message.attachments.size > 0) {
                const attachmentList = [];
                for (const [, attachment] of message.attachments) {
                    attachmentList.push(attachment.url);
                    files.push(attachment.url);
                }
                embed.addFields({ name: 'Attachments', value: attachmentList.join('\n').slice(0, 1024) });
            }

            await channel.send({ embeds: [embed] });

            // Log message
            await this.logMessage(session.ticketId, message.author.id, 'user', message.content, files);

            // React to confirm
            await message.react('✅').catch(() => {});

        } catch (error) {
            this.bot.logger.error('Failed to forward modmail message:', error);
        }
    }

    // Forward staff reply to user
    async forwardToUser(message, ticketId) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket || ticket.status !== 'open') return false;

        try {
            const user = await this.bot.client.users.fetch(ticket.user_id).catch(() => null);
            if (!user) return false;

            const config = await this.getConfig(ticket.guild_id);
            const guild = await this.bot.client.guilds.fetch(ticket.guild_id).catch(() => null);

            const embed = new EmbedBuilder()
                .setAuthor({ 
                    name: config?.anonymous_staff ? 'Staff' : message.author.tag, 
                    iconURL: config?.anonymous_staff ? guild?.iconURL() : message.author.displayAvatarURL({ dynamic: true }) 
                })
                .setDescription(message.content || '*No content*')
                .setColor(0x00FF00)
                .setFooter({ text: `Staff Reply | ${guild?.name || 'Unknown Server'}` })
                .setTimestamp();

            // Handle attachments
            const files = [];
            if (message.attachments.size > 0) {
                const attachmentList = [];
                for (const [, attachment] of message.attachments) {
                    attachmentList.push(attachment.url);
                    files.push(attachment.url);
                }
                embed.addFields({ name: 'Attachments', value: attachmentList.join('\n').slice(0, 1024) });
            }

            await user.send({ embeds: [embed] });

            // Log message
            await this.logMessage(ticketId, message.author.id, 'staff', message.content, files);

            // React to confirm
            await message.react('✅').catch(() => {});

            return true;
        } catch (error) {
            this.bot.logger.error('Failed to forward to user:', error);
            await message.react('❌').catch(() => {});
            return false;
        }
    }

    // Log a message
    async logMessage(ticketId, senderId, senderType, content, attachments) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO modmail_messages (ticket_id, sender_id, sender_type, content, attachments)
                 VALUES (?, ?, ?, ?, ?)`,
                [ticketId, senderId, senderType, content, JSON.stringify(attachments || [])],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    // Get ticket
    async getTicket(ticketId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM modmail_tickets WHERE id = ?`,
                [ticketId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Get ticket by channel
    async getTicketByChannel(channelId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM modmail_tickets WHERE (channel_id = ? OR thread_id = ?) AND status = 'open'`,
                [channelId, channelId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Close ticket
    async closeTicket(ticketId, closedBy, reason = null) {
        const ticket = await this.getTicket(ticketId);
        if (!ticket) return false;

        // Update database
        await new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE modmail_tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?, close_reason = ?
                 WHERE id = ?`,
                [closedBy, reason, ticketId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });

        // Remove from active sessions
        this.activeSessions.delete(ticket.user_id);

        // Notify user
        try {
            const user = await this.bot.client.users.fetch(ticket.user_id).catch(() => null);
            const guild = await this.bot.client.guilds.fetch(ticket.guild_id).catch(() => null);

            if (user) {
                const embed = new EmbedBuilder()
                    .setTitle('📬 ModMail Ticket Closed')
                    .setDescription(reason || 'Your ticket has been closed by staff.')
                    .setColor(0xFF0000)
                    .setFooter({ text: guild?.name || 'Unknown Server' })
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(() => {});
            }

            // Delete or archive channel
            const channel = await guild?.channels.fetch(ticket.channel_id || ticket.thread_id).catch(() => null);
            if (channel) {
                // Generate transcript first
                const transcript = await this.generateTranscript(ticketId);
                
                // Log closure
                const config = await this.getConfig(ticket.guild_id);
                await this.logTicketAction(guild, config, 'closed', { id: closedBy }, ticketId, reason, transcript);

                // Delete channel after 5 seconds
                setTimeout(async () => {
                    await channel.delete('ModMail ticket closed').catch(() => {});
                }, 5000);
            }

        } catch (error) {
            this.bot.logger.error('Error closing modmail ticket:', error);
        }

        return true;
    }

    // Generate transcript
    async generateTranscript(ticketId) {
        const messages = await new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM modmail_messages WHERE ticket_id = ? ORDER BY sent_at ASC`,
                [ticketId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        let transcript = `ModMail Ticket #${ticketId} Transcript\n`;
        transcript += `${'='.repeat(50)}\n\n`;

        for (const msg of messages) {
            const timestamp = new Date(msg.sent_at).toISOString();
            transcript += `[${timestamp}] [${msg.sender_type.toUpperCase()}] ${msg.sender_id}:\n`;
            transcript += `${msg.content || '(no content)'}\n`;
            if (msg.attachments && msg.attachments !== '[]') {
                transcript += `Attachments: ${msg.attachments}\n`;
            }
            transcript += '\n';
        }

        return transcript;
    }

    // Log ticket action
    async logTicketAction(guild, config, action, user, ticketId, reason = null, transcript = null) {
        if (!config?.log_channel_id) return;

        const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
        if (!channel) return;

        const colors = {
            'created': 0x00FF00,
            'closed': 0xFF0000,
            'claimed': 0x5865F2
        };

        const embed = new EmbedBuilder()
            .setTitle(`📬 Ticket ${action.charAt(0).toUpperCase() + action.slice(1)}`)
            .setColor(colors[action] || 0x5865F2)
            .addFields(
                { name: 'Ticket ID', value: `#${ticketId}`, inline: true },
                { name: 'By', value: `<@${user.id}>`, inline: true }
            )
            .setTimestamp();

        if (reason) {
            embed.addFields({ name: 'Reason', value: reason, inline: false });
        }

        const files = [];
        if (transcript) {
            // Create transcript file
            const buffer = Buffer.from(transcript, 'utf-8');
            files.push({ attachment: buffer, name: `transcript-${ticketId}.txt` });
        }

        await channel.send({ embeds: [embed], files }).catch(() => {});
    }

    // Claim ticket
    async claimTicket(ticketId, staffId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE modmail_tickets SET assigned_to = ? WHERE id = ? AND status = 'open'`,
                [staffId, ticketId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Get user's tickets
    async getUserTickets(guildId, odod, status = null) {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM modmail_tickets WHERE guild_id = ? AND user_id = ?`;
            const params = [guildId, odod];

            if (status) {
                query += ` AND status = ?`;
                params.push(status);
            }

            query += ` ORDER BY created_at DESC`;

            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }

    // Add snippet
    async addSnippet(guildId, name, content, createdBy) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO modmail_snippets (guild_id, name, content, created_by)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(guild_id, name) DO UPDATE SET content = ?, created_by = ?`,
                [guildId, name, content, createdBy, content, createdBy],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID || true);
                }
            );
        });
    }

    // Get snippet
    async getSnippet(guildId, name) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM modmail_snippets WHERE guild_id = ? AND name = ?`,
                [guildId, name],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // List snippets
    async listSnippets(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM modmail_snippets WHERE guild_id = ? ORDER BY name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Delete snippet
    async deleteSnippet(guildId, name) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM modmail_snippets WHERE guild_id = ? AND name = ?`,
                [guildId, name],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }
}

module.exports = ModMail;
