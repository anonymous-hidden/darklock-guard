const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType,
    PermissionFlagsBits,
    StringSelectMenuBuilder 
} = require('discord.js');

class TicketManager {
    constructor(bot) {
        this.bot = bot;
        this.activeTickets = new Map();
    }

    async initialize() {
        // Load active tickets from database
        try {
            const tickets = await this.bot.database.all(`
                SELECT * FROM active_tickets WHERE status != 'closed'
            `);
            
            for (const ticket of tickets) {
                this.activeTickets.set(ticket.channel_id, ticket);
            }
            
            console.log(`📋 Loaded ${tickets.length} active tickets`);
        } catch (error) {
            this.bot.logger.error('Error loading active tickets:', error);
        }
    }

    // Setup ticket system for a guild
    async setupTicketSystem(guild, options = {}) {
        const {
            categoryId,
            staffRoleId,
            logChannelId,
            transcriptChannelId,
            supportMessage = 'Thank you for creating a ticket! Our staff will assist you shortly.',
            ticketLimit = 1,
            autoCloseHours = 48
        } = options;

        try {
            // Save configuration to database
            await this.bot.database.run(`
                INSERT OR REPLACE INTO ticket_config (
                    guild_id, category_id, staff_role_id, log_channel_id,
                    transcript_channel_id, support_message, ticket_limit,
                    auto_close_hours, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                guild.id, categoryId, staffRoleId, logChannelId,
                transcriptChannelId, supportMessage, ticketLimit, autoCloseHours
            ]);

            // Create default categories if none exist
            if (!await this.hasCategories(guild.id)) {
                await this.createDefaultCategories(guild.id);
            }

            return { success: true, message: 'Ticket system configured successfully!' };
        } catch (error) {
            this.bot.logger.error('Error setting up ticket system:', error);
            return { success: false, message: 'Failed to configure ticket system.' };
        }
    }

    // Create default ticket categories
    async createDefaultCategories(guildId) {
        const defaultCategories = [
            { name: 'General Support', description: 'General help and support', emoji: '❓', priority: 'medium' },
            { name: 'Technical Issue', description: 'Report technical problems', emoji: '🛠️', priority: 'high' },
            { name: 'Account Issue', description: 'Account-related problems', emoji: '👤', priority: 'medium' },
            { name: 'Report User', description: 'Report rule violations', emoji: '⚠️', priority: 'high' },
            { name: 'Appeal', description: 'Appeal moderation actions', emoji: '📋', priority: 'medium' }
        ];

        for (const category of defaultCategories) {
            await this.bot.database.run(`
                INSERT OR IGNORE INTO ticket_categories (
                    guild_id, name, description, emoji, priority
                ) VALUES (?, ?, ?, ?, ?)
            `, [guildId, category.name, category.description, category.emoji, category.priority]);
        }
    }

    // Check if guild has ticket categories
    async hasCategories(guildId) {
        try {
            const count = await this.bot.database.get(`
                SELECT COUNT(*) as count FROM ticket_categories WHERE guild_id = ?
            `, [guildId]);
            return count.count > 0;
        } catch (error) {
            return false;
        }
    }

    // Get ticket configuration for a guild
    async getConfig(guildId) {
        try {
            const config = await this.bot.database.get(`
                SELECT * FROM ticket_config WHERE guild_id = ?
            `, [guildId]);
            return config;
        } catch (error) {
            this.bot.logger.error('Error getting ticket config:', error);
            return null;
        }
    }

    // Get ticket categories for a guild
    async getCategories(guildId) {
        try {
            const categories = await this.bot.database.all(`
                SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY name
            `, [guildId]);
            return categories;
        } catch (error) {
            this.bot.logger.error('Error getting ticket categories:', error);
            return [];
        }
    }

    // Create a ticket panel with categories
    async createTicketPanel(channel, customMessage = null) {
        const guild = channel.guild;
        const categories = await this.getCategories(guild.id);
        
        if (categories.length === 0) {
            return { success: false, message: 'No ticket categories found. Please set up categories first.' };
        }

        try {
            const embed = new EmbedBuilder()
                .setTitle('🎫 Support Ticket System')
                .setDescription(customMessage || 'Select a category below to create a support ticket. Our team will assist you as soon as possible!')
                .setColor(0x00ff00)
                .addFields([
                    { name: 'Available Categories', value: categories.map(cat => `${cat.emoji} **${cat.name}** - ${cat.description}`).join('\n') }
                ])
                .setFooter({ text: 'Please only create tickets for legitimate support needs.' })
                .setTimestamp();

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_category_select')
                .setPlaceholder('Choose a support category...')
                .addOptions(
                    categories.map(cat => ({
                        label: cat.name,
                        description: cat.description.length > 50 ? cat.description.substring(0, 47) + '...' : cat.description,
                        value: cat.name.toLowerCase().replace(/\s+/g, '_'),
                        emoji: cat.emoji
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const message = await channel.send({ embeds: [embed], components: [row] });
            
            return { success: true, messageId: message.id };
        } catch (error) {
            this.bot.logger.error('Error creating ticket panel:', error);
            return { success: false, message: 'Failed to create ticket panel.' };
        }
    }

    // Handle ticket creation from interaction
    async handleTicketButton(interaction) {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

        const guild = interaction.guild;
        const user = interaction.user;
        
        try {
            let category = 'general';
            
            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
                category = interaction.values[0];
            } else if (interaction.isButton() && interaction.customId.startsWith('create_ticket_')) {
                category = interaction.customId.replace('create_ticket_', '');
            } else {
                return;
            }

            // Check if user already has open tickets
            const config = await this.getConfig(guild.id);
            if (!config) {
                await interaction.reply({ 
                    content: 'Ticket system is not configured for this server.', 
                    ephemeral: true 
                });
                return;
            }

            const existingTickets = await this.getUserActiveTickets(guild.id, user.id);
            if (existingTickets.length >= config.ticket_limit) {
                await interaction.reply({
                    content: `You already have ${existingTickets.length} open ticket(s). Please close existing tickets before creating new ones.`,
                    ephemeral: true
                });
                return;
            }

            // Create the ticket
            const result = await this.createTicket(guild, user, category, config);
            
            if (result.success) {
                await interaction.reply({
                    content: `✅ Ticket created! Please check ${result.channel}`,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: `❌ Failed to create ticket: ${result.message}`,
                    ephemeral: true
                });
            }
        } catch (error) {
            this.bot.logger.error('Error handling ticket button:', error);
            await interaction.reply({
                content: '❌ An error occurred while creating your ticket.',
                ephemeral: true
            });
        }
    }

    // Create a new ticket
    async createTicket(guild, user, category, config) {
        try {
            // Get category info
            const categoryInfo = await this.bot.database.get(`
                SELECT * FROM ticket_categories WHERE guild_id = ? AND name = ?
            `, [guild.id, category.replace('_', ' ')]) || { name: category, priority: 'medium', emoji: '🎫' };

            // Create ticket channel
            const ticketNumber = await this.getNextTicketNumber(guild.id);
            const channelName = `ticket-${ticketNumber}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
            
            const channelOptions = {
                name: channelName,
                type: ChannelType.GuildText,
                topic: `Ticket #${ticketNumber} | ${categoryInfo.name} | Created by ${user.tag}`,
                permissionOverwrites: [
                    {
                        id: guild.id, // @everyone
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles
                        ]
                    },
                    {
                        id: this.bot.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles
                        ]
                    }
                ]
            };

            // Add staff role permissions if configured
            if (config.staff_role_id) {
                channelOptions.permissionOverwrites.push({
                    id: config.staff_role_id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ManageMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles
                    ]
                });
            }

            // Set parent category if configured
            if (config.category_id) {
                channelOptions.parent = config.category_id;
            }

            const channel = await guild.channels.create(channelOptions);

            // Save ticket to database
            const result = await this.bot.database.run(`
                INSERT INTO active_tickets (
                    guild_id, channel_id, user_id, category, priority, status
                ) VALUES (?, ?, ?, ?, ?, 'open')
            `, [guild.id, channel.id, user.id, categoryInfo.name, categoryInfo.priority]);

            const ticketId = result.lastID;

            // Add to active tickets map
            this.activeTickets.set(channel.id, {
                id: ticketId,
                guild_id: guild.id,
                channel_id: channel.id,
                user_id: user.id,
                category: categoryInfo.name,
                priority: categoryInfo.priority,
                status: 'open',
                created_at: new Date().toISOString()
            });

            // Create welcome message
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Ticket #${ticketNumber} - ${categoryInfo.name}`)
                .setDescription(config.support_message || 'Thank you for creating a ticket! Our staff will assist you shortly.')
                .addFields([
                    { name: 'Created by', value: user.toString(), inline: true },
                    { name: 'Category', value: categoryInfo.name, inline: true },
                    { name: 'Priority', value: categoryInfo.priority, inline: true }
                ])
                .setColor(this.getPriorityColor(categoryInfo.priority))
                .setTimestamp();

            const buttons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`close_ticket_${ticketId}`)
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🔒'),
                    new ButtonBuilder()
                        .setCustomId(`claim_ticket_${ticketId}`)
                        .setLabel('Claim Ticket')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('✋'),
                    new ButtonBuilder()
                        .setCustomId(`add_user_${ticketId}`)
                        .setLabel('Add User')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('➕')
                );

            await channel.send({ content: user.toString(), embeds: [embed], components: [buttons] });

            // Mention staff role if configured
            if (config.staff_role_id) {
                const staffRole = guild.roles.cache.get(config.staff_role_id);
                if (staffRole) {
                    await channel.send(`${staffRole} - New ticket created!`);
                }
            }

            // Log ticket creation
            if (config.log_channel_id) {
                await this.logTicketAction(guild, 'created', {
                    user,
                    channel,
                    category: categoryInfo.name,
                    priority: categoryInfo.priority
                });
            }

            return { success: true, channel, ticketId };
        } catch (error) {
            this.bot.logger.error('Error creating ticket:', error);
            return { success: false, message: error.message };
        }
    }

    // Get next ticket number for guild
    async getNextTicketNumber(guildId) {
        try {
            const result = await this.bot.database.get(`
                SELECT COUNT(*) as count FROM ticket_transcripts WHERE guild_id = ?
                UNION ALL
                SELECT COUNT(*) as count FROM active_tickets WHERE guild_id = ?
            `, [guildId, guildId]);
            
            return (result?.count || 0) + 1;
        } catch (error) {
            return 1;
        }
    }

    // Get user's active tickets
    async getUserActiveTickets(guildId, userId) {
        try {
            const tickets = await this.bot.database.all(`
                SELECT * FROM active_tickets 
                WHERE guild_id = ? AND user_id = ? AND status != 'closed'
            `, [guildId, userId]);
            return tickets;
        } catch (error) {
            return [];
        }
    }

    // Get ticket statistics
    async getTicketStats(guildId, timeframe = '7d') {
        const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 720;
        
        try {
            const stats = await this.bot.database.get(`
                SELECT 
                    COUNT(*) as total_tickets,
                    AVG(message_count) as avg_messages,
                    COUNT(CASE WHEN rating >= 4 THEN 1 END) as positive_ratings
                FROM ticket_transcripts 
                WHERE guild_id = ? AND closed_at > datetime('now', '-${hours} hours')
            `, [guildId]);

            const activeCount = await this.bot.database.get(`
                SELECT COUNT(*) as count FROM active_tickets WHERE guild_id = ?
            `, [guildId]);

            const categoryStats = await this.bot.database.all(`
                SELECT category, COUNT(*) as count
                FROM ticket_transcripts 
                WHERE guild_id = ? AND closed_at > datetime('now', '-${hours} hours')
                GROUP BY category
                ORDER BY count DESC
            `, [guildId]);

            return {
                totalTickets: stats.total_tickets || 0,
                activeTickets: activeCount.count || 0,
                avgMessages: Math.round(stats.avg_messages || 0),
                positiveRatings: stats.positive_ratings || 0,
                categoryBreakdown: categoryStats,
                timeframe
            };
        } catch (error) {
            this.bot.logger.error('Error getting ticket stats:', error);
            return {
                totalTickets: 0,
                activeTickets: 0,
                avgMessages: 0,
                positiveRatings: 0,
                categoryBreakdown: [],
                timeframe
            };
        }
    }

    // Utility methods
    getPriorityColor(priority) {
        switch (priority.toLowerCase()) {
            case 'low': return 0x00ff00;
            case 'medium': return 0xffaa00;
            case 'high': return 0xff0000;
            case 'urgent': return 0x8b0000;
            default: return 0x808080;
        }
    }
}

module.exports = TicketManager;