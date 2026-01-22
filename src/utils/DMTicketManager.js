const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * DM-Based Ticket Manager
 * Handles tickets entirely through Direct Messages - no channels created
 */
class DMTicketManager {
    constructor(bot) {
        this.bot = bot;
        this.pendingTickets = new Map(); // userId -> { stage, data }
    }

    async initialize() {
        console.log('📬 DM Ticket Manager initialized');
        
        // Create tables if they don't exist
        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS dm_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                subject TEXT,
                description TEXT,
                status TEXT DEFAULT 'open',
                priority TEXT DEFAULT 'medium',
                assigned_to TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                closed_at TEXT,
                closed_by TEXT
            )
        `);

        await this.bot.database.run(`
            CREATE TABLE IF NOT EXISTS dm_ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                is_staff BOOLEAN DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ticket_id) REFERENCES dm_tickets(id)
            )
        `);

        console.log('✅ DM Ticket tables ready');
    }

    /**
     * Check if user has an open ticket
     */
    async getUserOpenTicket(userId, guildId = null) {
        const query = guildId 
            ? `SELECT * FROM dm_tickets WHERE user_id = ? AND guild_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`
            : `SELECT * FROM dm_tickets WHERE user_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`;
        
        const params = guildId ? [userId, guildId] : [userId];
        return await this.bot.database.get(query, params);
    }

    /**
     * Create a new ticket from DM
     */
    async createTicket(userId, guildId, category, subject, description) {
        try {
            // Check for existing open ticket
            const existing = await this.getUserOpenTicket(userId, guildId);
            if (existing) {
                return { 
                    success: false, 
                    message: `You already have an open ticket (#${existing.id}). Please wait for staff to respond or close it first.`,
                    ticketId: existing.id
                };
            }

            // Create ticket
            const result = await this.bot.database.run(`
                INSERT INTO dm_tickets 
                (guild_id, user_id, category, subject, description, status, priority, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'open', 'medium', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [guildId, userId, category, subject, description]);

            const ticketId = result.lastID;

            // Add initial message to ticket
            const user = await this.bot.users.fetch(userId).catch(() => null);
            const username = user ? user.tag : 'Unknown User';

            await this.bot.database.run(`
                INSERT INTO dm_ticket_messages 
                (ticket_id, user_id, username, message, is_staff, created_at)
                VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
            `, [ticketId, userId, username, description]);

            // Notify staff via dashboard event
            if (this.bot.eventEmitter) {
                this.bot.eventEmitter.emit('ticketCreated', {
                    ticketId,
                    userId,
                    username,
                    guildId,
                    category,
                    subject,
                    description,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Broadcast to console
            try {
                if (this.bot && typeof this.bot.broadcastConsole === 'function') {
                    this.bot.broadcastConsole(guildId, `[TICKET] New ticket #${ticketId} from ${username} - ${subject}`);
                }
            } catch (_) {}

            // Log to guild log channel if configured
            await this.notifyStaff(guildId, ticketId, userId, category, subject);

            return { 
                success: true, 
                ticketId,
                message: `Ticket #${ticketId} created successfully! Our staff will respond to you via DM.`
            };
        } catch (error) {
            this.bot.logger.error('Error creating DM ticket:', error);
            return { success: false, message: 'Failed to create ticket. Please try again later.' };
        }
    }

    /**
     * Add a message to an existing ticket
     */
    async addMessage(ticketId, userId, username, message, isStaff = false) {
        try {
            await this.bot.database.run(`
                INSERT INTO dm_ticket_messages 
                (ticket_id, user_id, username, message, is_staff, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [ticketId, userId, username, message, isStaff ? 1 : 0]);

            // Update ticket timestamp
            await this.bot.database.run(`
                UPDATE dm_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `, [ticketId]);

            // Emit event for dashboard
            if (this.bot.eventEmitter) {
                this.bot.eventEmitter.emit('ticketMessage', {
                    ticketId,
                    userId,
                    username,
                    message,
                    isStaff,
                    timestamp: new Date().toISOString()
                });
            }

            return { success: true };
        } catch (error) {
            this.bot.logger.error('Error adding ticket message:', error);
            return { success: false, message: 'Failed to add message.' };
        }
    }

    /**
     * Handle incoming DM message
     */
    async handleDM(message) {
        const userId = message.author.id;
        const content = message.content.trim();

        // Ignore bot messages
        if (message.author.bot) return;

        // Check if user is in ticket creation flow
        if (this.pendingTickets.has(userId)) {
            return await this.handleTicketCreationFlow(message);
        }

        // Check if user has an open ticket
        const openTicket = await this.getUserOpenTicket(userId);
        if (openTicket) {
            // Add message to existing ticket
            await this.addMessage(openTicket.id, userId, message.author.tag, content, false);
            
            const embed = new EmbedBuilder()
                .setTitle('💬 Message Added to Ticket')
                .setDescription(`Your message has been added to ticket #${openTicket.id}.\n\nStaff will respond soon!`)
                .setColor('#00ff00')
                .setFooter({ text: 'To close this ticket, type: close ticket' });

            return await message.reply({ embeds: [embed] });
        }

        // New ticket - start creation flow
        if (content.toLowerCase().includes('ticket') || content.toLowerCase().includes('help') || content.toLowerCase().includes('support')) {
            return await this.startTicketCreation(message);
        }

        // Unknown DM
        const helpEmbed = new EmbedBuilder()
            .setTitle('👋 Hello!')
            .setDescription(`
I'm DarkLock! To create a support ticket, please:

**Option 1:** Reply with "create ticket" or "help"
**Option 2:** Use the \`/ticket\` command in your server

You can also:
• Close a ticket: Type "close ticket"
• Check ticket status: Type "ticket status"
            `)
            .setColor('#0099ff')
            .setFooter({ text: 'DarkLock Support' });

        return await message.reply({ embeds: [helpEmbed] });
    }

    /**
     * Start ticket creation flow
     */
    async startTicketCreation(message) {
        const userId = message.author.id;

        // Get user's mutual guilds
        const mutualGuilds = this.bot.guilds.cache.filter(guild => 
            guild.members.cache.has(userId)
        );

        if (mutualGuilds.size === 0) {
            const embed = new EmbedBuilder()
                .setTitle('❌ No Mutual Servers')
                .setDescription('You must be in a server with DarkLock to create a ticket.')
                .setColor('#ff0000');
            return await message.reply({ embeds: [embed] });
        }

        // If user is in multiple guilds, ask which one
        let guildId;
        if (mutualGuilds.size > 1) {
            const guildList = mutualGuilds.map((g, idx) => `${idx + 1}. ${g.name}`).slice(0, 10).join('\n');
            const embed = new EmbedBuilder()
                .setTitle('🎫 Create Support Ticket')
                .setDescription(`Please reply with the number of the server you need help with:\n\n${guildList}`)
                .setColor('#0099ff');

            await message.reply({ embeds: [embed] });
            
            this.pendingTickets.set(userId, { 
                stage: 'select_guild', 
                guilds: Array.from(mutualGuilds.values()) 
            });
        } else {
            guildId = mutualGuilds.first().id;
            this.pendingTickets.set(userId, { 
                stage: 'category', 
                guildId 
            });
            return await this.askCategory(message);
        }
    }

    /**
     * Handle ticket creation flow steps
     */
    async handleTicketCreationFlow(message) {
        const userId = message.author.id;
        const pending = this.pendingTickets.get(userId);
        const content = message.content.trim();

        switch (pending.stage) {
            case 'select_guild': {
                const index = parseInt(content) - 1;
                if (isNaN(index) || index < 0 || index >= pending.guilds.length) {
                    return await message.reply('❌ Invalid number. Please try again.');
                }

                pending.guildId = pending.guilds[index].id;
                pending.stage = 'category';
                this.pendingTickets.set(userId, pending);
                return await this.askCategory(message);
            }

            case 'category': {
                const validCategories = ['general', 'technical', 'account', 'report', 'appeal'];
                const category = content.toLowerCase();
                
                if (!validCategories.includes(category)) {
                    return await message.reply('❌ Invalid category. Please choose: general, technical, account, report, or appeal');
                }

                pending.category = category;
                pending.stage = 'subject';
                this.pendingTickets.set(userId, pending);

                const embed = new EmbedBuilder()
                    .setTitle('📝 Ticket Subject')
                    .setDescription('Please provide a brief subject/title for your ticket (max 100 characters):')
                    .setColor('#0099ff');
                return await message.reply({ embeds: [embed] });
            }

            case 'subject': {
                if (content.length > 100) {
                    return await message.reply('❌ Subject too long. Please keep it under 100 characters.');
                }

                pending.subject = content;
                pending.stage = 'description';
                this.pendingTickets.set(userId, pending);

                const embed = new EmbedBuilder()
                    .setTitle('📋 Ticket Description')
                    .setDescription('Please describe your issue in detail (max 1000 characters):')
                    .setColor('#0099ff');
                return await message.reply({ embeds: [embed] });
            }

            case 'description': {
                if (content.length > 1000) {
                    return await message.reply('❌ Description too long. Please keep it under 1000 characters.');
                }

                pending.description = content;

                // Create the ticket
                const result = await this.createTicket(
                    userId,
                    pending.guildId,
                    pending.category,
                    pending.subject,
                    pending.description
                );

                // Clear pending ticket
                this.pendingTickets.delete(userId);

                if (result.success) {
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Ticket Created!')
                        .setDescription(`
**Ticket ID:** #${result.ticketId}
**Category:** ${pending.category}
**Subject:** ${pending.subject}

Our staff team has been notified and will respond to you via DM shortly.

To add more details, simply send another message here.
To close this ticket, type: **close ticket**
                        `)
                        .setColor('#00ff00')
                        .setTimestamp();
                    return await message.reply({ embeds: [successEmbed] });
                } else {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ Failed to Create Ticket')
                        .setDescription(result.message)
                        .setColor('#ff0000');
                    return await message.reply({ embeds: [errorEmbed] });
                }
            }
        }
    }

    /**
     * Ask for ticket category
     */
    async askCategory(message) {
        const embed = new EmbedBuilder()
            .setTitle('🎫 Select Ticket Category')
            .setDescription('Please reply with one of the following categories:\n\n**general** - General help and support\n**technical** - Technical issues or bugs\n**account** - Account-related problems\n**report** - Report a user or issue\n**appeal** - Appeal a moderation action')
            .setColor('#0099ff');
        return await message.reply({ embeds: [embed] });
    }

    /**
     * Close a ticket
     */
    async closeTicket(ticketId, closedBy, reason = 'Closed by user') {
        try {
            await this.bot.database.run(`
                UPDATE dm_tickets 
                SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?
                WHERE id = ?
            `, [closedBy, ticketId]);

            // Emit event
            if (this.bot.eventEmitter) {
                this.bot.eventEmitter.emit('ticketClosed', {
                    ticketId,
                    closedBy,
                    reason,
                    timestamp: new Date().toISOString()
                });
            }

            return { success: true };
        } catch (error) {
            this.bot.logger.error('Error closing ticket:', error);
            return { success: false, message: 'Failed to close ticket.' };
        }
    }

    /**
     * Send staff reply to user via DM
     */
    async sendStaffReply(ticketId, staffId, staffName, message) {
        try {
            // Get ticket
            const ticket = await this.bot.database.get(
                'SELECT * FROM dm_tickets WHERE id = ?',
                [ticketId]
            );

            if (!ticket) {
                return { success: false, message: 'Ticket not found.' };
            }

            if (ticket.status === 'closed') {
                return { success: false, message: 'Ticket is already closed.' };
            }

            // Add message to ticket
            await this.addMessage(ticketId, staffId, staffName, message, true);

            // Send DM to user
            const user = await this.bot.users.fetch(ticket.user_id).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setTitle(`💬 Staff Response - Ticket #${ticketId}`)
                    .setDescription(message)
                    .setColor('#0099ff')
                    .setFooter({ text: `From: ${staffName}` })
                    .setTimestamp();

                await user.send({ embeds: [embed] }).catch(err => {
                    this.bot.logger.error('Failed to send DM to user:', err);
                });
            }

            return { success: true };
        } catch (error) {
            this.bot.logger.error('Error sending staff reply:', error);
            return { success: false, message: 'Failed to send reply.' };
        }
    }

    /**
     * Get all open tickets for a guild
     */
    async getGuildTickets(guildId, status = 'open') {
        try {
            return await this.bot.database.all(
                `SELECT * FROM dm_tickets WHERE guild_id = ? AND status = ? ORDER BY created_at DESC`,
                [guildId, status]
            );
        } catch (error) {
            this.bot.logger.error('Error getting guild tickets:', error);
            return [];
        }
    }

    /**
     * Get ticket messages
     */
    async getTicketMessages(ticketId) {
        try {
            return await this.bot.database.all(
                `SELECT * FROM dm_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
                [ticketId]
            );
        } catch (error) {
            this.bot.logger.error('Error getting ticket messages:', error);
            return [];
        }
    }

    /**
     * Notify staff of new ticket
     */
    async notifyStaff(guildId, ticketId, userId, category, subject) {
        try {
            const guild = this.bot.guilds.cache.get(guildId);
            if (!guild) return;

            // Get log channel from guild config
            const config = await this.bot.database.get(
                'SELECT log_channel_id FROM guild_configs WHERE guild_id = ?',
                [guildId]
            );

            if (!config || !config.log_channel_id) return;

            const logChannel = guild.channels.cache.get(config.log_channel_id);
            if (!logChannel) return;

            const user = await this.bot.users.fetch(userId).catch(() => null);
            const username = user ? user.tag : 'Unknown User';

            const embed = new EmbedBuilder()
                .setTitle('🎫 New Support Ticket')
                .setDescription(`
**Ticket ID:** #${ticketId}
**User:** ${username} (${userId})
**Category:** ${category}
**Subject:** ${subject}

View and respond to this ticket in the dashboard.
                `)
                .setColor('#00ff00')
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            this.bot.logger.error('Error notifying staff:', error);
        }
    }
}

module.exports = DMTicketManager;
