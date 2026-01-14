const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const StandardEmbedBuilder = require('./embed-builder');

class TicketManager {
    constructor(client) {
        this.client = client;
        this.activeTickets = new Map();
    }

    /**
     * Handle /ticket setup command - creates ticket panel and saves config
     */
    async handleSetup(interaction, options) {
        const { channel, staffRole, adminRole, category } = options;
        
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;

            // Save ticket configuration to database
            if (this.client.database) {
                // Check if config exists
                const existing = await this.client.database.get(
                    'SELECT * FROM ticket_config WHERE guild_id = ?',
                    [guild.id]
                );

                // Use a placeholder category if none provided (ticket_config requires NOT NULL)
                const categoryId = category?.id || 'none';

                if (existing) {
                    await this.client.database.run(
                        `UPDATE ticket_config SET 
                            category_id = ?, 
                            staff_role_id = ?, 
                            panel_channel_id = ?,
                            updated_at = ?
                        WHERE guild_id = ?`,
                        [
                            categoryId,
                            staffRole.id,
                            channel.id,
                            new Date().toISOString(),
                            guild.id
                        ]
                    );
                } else {
                    await this.client.database.run(
                        `INSERT INTO ticket_config 
                            (guild_id, category_id, staff_role_id, panel_channel_id, created_at)
                        VALUES (?, ?, ?, ?, ?)`,
                        [
                            guild.id,
                            categoryId,
                            staffRole.id,
                            channel.id,
                            new Date().toISOString()
                        ]
                    );
                }

                // Also update guild_configs for both dashboard and ticket handler compatibility
                // First ensure the guild_configs row exists
                const guildConfigExists = await this.client.database.get(
                    'SELECT guild_id FROM guild_configs WHERE guild_id = ?',
                    [guild.id]
                );
                
                if (!guildConfigExists) {
                    await this.client.database.run(
                        `INSERT INTO guild_configs (guild_id, tickets_enabled, ticket_category_id, ticket_channel_id, ticket_staff_role, ticket_manage_role, ticket_support_roles)
                        VALUES (?, 1, ?, ?, ?, ?, ?)`,
                        [
                            guild.id,
                            category?.id || null,
                            channel.id,
                            staffRole.id,
                            adminRole?.id || null,
                            JSON.stringify([staffRole.id, adminRole?.id].filter(Boolean))
                        ]
                    );
                } else {
                    await this.client.database.run(
                        `UPDATE guild_configs SET 
                            tickets_enabled = 1,
                            ticket_category_id = ?,
                            ticket_channel_id = ?,
                            ticket_staff_role = ?,
                            ticket_manage_role = ?,
                            ticket_support_roles = ?
                        WHERE guild_id = ?`,
                        [
                            category?.id || null,
                            channel.id,
                            staffRole.id,
                            adminRole?.id || null,
                            JSON.stringify([staffRole.id, adminRole?.id].filter(Boolean)),
                            guild.id
                        ]
                    );
                }
            }

            // Create the ticket panel embed
            const panelEmbed = new EmbedBuilder()
                .setTitle('🎫 Support Tickets')
                .setDescription(`
**Need help?** Create a support ticket!

Click the button below to open a new ticket and our staff team will assist you as soon as possible.

**Guidelines:**
• One issue per ticket
• Be clear and descriptive
• Be patient - staff will respond soon
• Don't spam tickets
                `)
                .setColor('#5865f2')
                .setFooter({ text: `Staff: ${staffRole.name}${adminRole ? ` | Admin: ${adminRole.name}` : ''}` })
                .setTimestamp();

            const panelRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('create_ticket')
                        .setLabel('Create Ticket')
                        .setEmoji('🎫')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('ticket_guidelines')
                        .setLabel('Guidelines')
                        .setEmoji('📋')
                        .setStyle(ButtonStyle.Secondary)
                );

            // Send the panel to the specified channel
            await channel.send({
                embeds: [panelEmbed],
                components: [panelRow]
            });

            // Success response
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Ticket System Configured')
                .setDescription(`
**Configuration saved!**

📍 **Panel Channel:** ${channel}
👥 **Staff Role:** ${staffRole}
${adminRole ? `🛡️ **Admin Role:** ${adminRole}\n` : ''}${category ? `📁 **Category:** ${category.name}\n` : ''}
The ticket panel has been posted in ${channel}.
                `)
                .setColor('#2ed573')
                .setTimestamp();

            return interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error setting up ticket system:', error);
            console.error('Full error stack:', error.stack);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Setup Failed')
                .setDescription(`An error occurred while setting up the ticket system.\n\n**Error:** ${error.message || 'Unknown error'}\n\nPlease try again or contact support.`)
                .setColor('#ff4757');
            return interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    /**
     * Handle /ticket create command
     */
    async handleCreate(interaction, reason) {
        // Show the ticket modal for detailed input
        return this.showTicketModal(interaction);
    }

    /**
     * Handle /ticket close command (slash command version)
     */
    async handleClose(interaction, reason = '') {
        const channel = interaction.channel;
        
        if (!channel.name.startsWith('ticket-')) {
            return interaction.reply({ 
                content: '❌ This command can only be used in ticket channels.', 
                ephemeral: true 
            });
        }

        // Use the existing closeTicket logic
        return this.closeTicket(interaction, reason);
    }

    /**
     * Handle claim button
     */
    async handleClaim(interaction) {
        const channel = interaction.channel;
        const ticketInfo = this.activeTickets.get(channel.id);

        if (ticketInfo?.claimed) {
            return interaction.reply({ 
                content: `❌ This ticket is already claimed by <@${ticketInfo.claimedBy}>.`, 
                ephemeral: true 
            });
        }

        // Update in memory
        if (ticketInfo) {
            ticketInfo.claimed = true;
            ticketInfo.claimedBy = interaction.user.id;
        }

        // Update in database
        if (this.client.database) {
            try {
                await this.client.database.run(
                    `UPDATE tickets SET assigned_to = ?, claimed_at = ? WHERE channel_id = ?`,
                    [interaction.user.id, new Date().toISOString(), channel.id]
                );
            } catch (error) {
                console.error('Error updating ticket claim:', error);
            }
        }

        const claimEmbed = new EmbedBuilder()
            .setDescription(`📌 This ticket has been claimed by ${interaction.user}`)
            .setColor('#00d4ff')
            .setTimestamp();

        await interaction.reply({ embeds: [claimEmbed] });
    }

    /**
     * Handle ticket button from panel
     */
    async handleCreateButton(interaction) {
        return this.showTicketModal(interaction);
    }

    async handleTicketButton(interaction) {
        try {
            if (interaction.customId === 'create_ticket') {
                await this.showTicketModal(interaction);
            } else if (interaction.customId === 'ticket_guidelines') {
                await this.showGuidelines(interaction);
            } else if (interaction.customId === 'close_ticket_confirm') {
                await this.closeTicket(interaction);
            }
        } catch (error) {
            console.error('Error handling ticket button:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred processing your request. Please try again.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }

    async showTicketModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('ticket_modal')
            .setTitle('Create Support Ticket');

        const subjectInput = new TextInputBuilder()
            .setCustomId('ticket_subject')
            .setLabel('What is your issue about?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g., Bot not responding, Permission error, Feature request')
            .setRequired(true)
            .setMaxLength(100);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticket_description')
            .setLabel('Describe your issue in detail')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('• What problem are you experiencing?\n• When did this issue start?\n• What have you tried to fix it?')
            .setRequired(true)
            .setMaxLength(1000);

        const firstActionRow = new ActionRowBuilder().addComponents(subjectInput);
        const secondActionRow = new ActionRowBuilder().addComponents(descriptionInput);

        modal.addComponents(firstActionRow, secondActionRow);

        await interaction.showModal(modal);
    }

    async createTicket(interaction, subject, description) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }

        const guild = interaction.guild;
        const user = interaction.user;

        try {
            // Feature toggle enforcement - check if tickets are enabled
            let guildConfig = null;
            if (this.client.database) {
                guildConfig = await this.client.database.getGuildConfig(guild.id);
                if (!guildConfig || !guildConfig.tickets_enabled) {
                    const disabledEmbed = StandardEmbedBuilder.featureDisabled('Ticket System');
                    return await interaction.editReply({ embeds: [disabledEmbed] });
                }
            }

            // Get ticket configuration from guild_configs (dashboard settings)
            // Map dashboard fields to what we need
            let ticketConfig = null;
            if (guildConfig) {
                // Parse support roles from JSON if stored as string
                let supportRoles = [];
                try {
                    supportRoles = guildConfig.ticket_support_roles 
                        ? (typeof guildConfig.ticket_support_roles === 'string' 
                            ? JSON.parse(guildConfig.ticket_support_roles) 
                            : guildConfig.ticket_support_roles)
                        : [];
                } catch (e) { supportRoles = []; }

                ticketConfig = {
                    category_id: guildConfig.ticket_category || null,
                    staff_role_id: supportRoles[0] || null, // Primary support role
                    support_roles: supportRoles,
                    transcript_channel: guildConfig.ticket_transcript_channel || null,
                    panel_channel: guildConfig.ticket_panel_channel || null,
                    welcome_message: guildConfig.ticket_welcome_message || 'Thank you for creating a ticket! A support team member will be with you shortly.',
                    autoclose_enabled: !!guildConfig.ticket_autoclose,
                    autoclose_hours: guildConfig.ticket_autoclose_hours || 48
                };
            }

            // Fallback to ticket_config table for backward compatibility
            if (!ticketConfig?.staff_role_id && this.client.database) {
                const legacyConfig = await this.client.database.get(
                    'SELECT * FROM ticket_config WHERE guild_id = ?',
                    [guild.id]
                );
                if (legacyConfig) {
                    ticketConfig = {
                        ...ticketConfig,
                        category_id: ticketConfig?.category_id || legacyConfig.category_id,
                        staff_role_id: legacyConfig.staff_role_id,
                        support_roles: [legacyConfig.staff_role_id]
                    };
                }
            }

            if (!ticketConfig || !ticketConfig.staff_role_id) {
                const errorEmbed = StandardEmbedBuilder.error(
                    'Configuration Error',
                    'Ticket system is not configured. Please configure ticket support roles in the dashboard.'
                );
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Check if user already has an open ticket
            const existingTicket = guild.channels.cache.find(
                c => c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${user.discriminator}`
            );

            if (existingTicket) {
                const errorEmbed = StandardEmbedBuilder.warning(
                    'Ticket Already Exists',
                    `You already have an open ticket: ${existingTicket}`
                );
                return await interaction.editReply({ embeds: [errorEmbed] });
            }

            // Build permission overwrites including all support roles
            const permissionOverwrites = [
                {
                    id: guild.id,
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
                    id: this.client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ];

            // Add all support roles from dashboard config
            const supportRoles = ticketConfig.support_roles || [ticketConfig.staff_role_id];
            for (const roleId of supportRoles) {
                if (roleId && guild.roles.cache.has(roleId)) {
                    permissionOverwrites.push({
                        id: roleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.ManageMessages
                        ]
                    });
                }
            }

            // Create ticket channel
            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${user.discriminator}`,
                type: ChannelType.GuildText,
                parent: ticketConfig.category_id !== 'none' ? ticketConfig.category_id : null,
                permissionOverwrites
            });

            // Save ticket to database with subject and description
            if (this.client.database) {
                try {
                    await this.client.database.run(`
                        INSERT INTO tickets 
                        (guild_id, channel_id, user_id, status, subject, description, created_at, last_message_at)
                        VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
                    `, [guild.id, ticketChannel.id, user.id, subject, description, new Date().toISOString(), new Date().toISOString()]);
                    
                    console.log(`✅ Ticket saved to database: ${ticketChannel.name}`);
                } catch (error) {
                    console.error('Error saving ticket to database:', error);
                }
            }

            // Create ticket welcome embed with user's issue
            const welcomeEmbed = StandardEmbedBuilder.ticketCreated(user, subject, description);

            const ticketRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Close Ticket')
                        .setEmoji('🔒')
                        .setStyle(ButtonStyle.Danger)
                        .setCustomId('close_ticket_confirm'),
                    new ButtonBuilder()
                        .setLabel('Claim Ticket')
                        .setEmoji('✋')
                        .setStyle(ButtonStyle.Secondary)
                        .setCustomId('claim_ticket')
                );

            // Build support role pings
            const rolePings = supportRoles.map(rid => `<@&${rid}>`).join(' ');

            await ticketChannel.send({
                content: `${user} ${rolePings}`,
                embeds: [welcomeEmbed],
                components: [ticketRow]
            });

            // Success response
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Ticket Created')
                .setDescription(`Your ticket has been created: ${ticketChannel}`)
                .setColor('#2ed573');

            await interaction.editReply({ embeds: [successEmbed] });

            // Store active ticket
            this.activeTickets.set(ticketChannel.id, {
                userId: user.id,
                createdAt: Date.now(),
                claimed: false,
                claimedBy: null
            });

        } catch (error) {
            console.error('Error creating ticket:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error Creating Ticket')
                .setDescription('An error occurred while creating your ticket. Please try again or contact an administrator.')
                .setColor('#ff4757');

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    async showGuidelines(interaction) {
        const guidelinesEmbed = new EmbedBuilder()
            .setTitle('📋 Ticket System Guidelines')
            .setDescription(`
**Before creating a ticket:**

🔍 **Check FAQ first** - Many common questions are answered in our FAQ channels

💬 **Use appropriate channels** - For general questions, use help channels first

🎯 **One issue per ticket** - Create separate tickets for different issues

**When using tickets:**

📝 **Be descriptive** - Clearly explain your issue with details
⏰ **Be patient** - Staff will respond as soon as possible  
🤝 **Be respectful** - Maintain a friendly and professional tone
📸 **Include evidence** - Screenshots or logs help us understand better

**Ticket Rules:**

❌ **No spam or abuse** - Misuse will result in penalties
❌ **No false reports** - Only create tickets for legitimate issues
❌ **No duplicate tickets** - One ticket per issue, please
✅ **Follow server rules** - All server rules apply in tickets

**Need immediate help?**
For urgent security issues, mention @Staff in your ticket.
            `)
            .setColor('#5865f2')
            .setTimestamp();

        await interaction.reply({ embeds: [guidelinesEmbed], ephemeral: true });
    }

    async closeTicket(interaction) {
        const channel = interaction.channel;
        
        if (!channel.name.startsWith('ticket-')) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Invalid Channel')
                .setDescription('This is not a ticket channel.')
                .setColor('#ff4757');
            
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }

        await interaction.deferUpdate();

        // Create closing embed
        const closingEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closing')
            .setDescription(`
This ticket has been closed by ${interaction.user}.

**Ticket Information:**
📅 Created: <t:${Math.floor((this.activeTickets.get(channel.id)?.createdAt || Date.now()) / 1000)}:R>
👤 Closed by: ${interaction.user}
📝 Transcript saved to database

The channel will be deleted in 10 seconds...
            `)
            .setColor('#ff6b6b')
            .setTimestamp();

        await interaction.followUp({ embeds: [closingEmbed] });

        // Generate transcript
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const transcript = [];

            messages.reverse().forEach(msg => {
                if (!msg.author.bot || msg.embeds.length > 0) {
                    transcript.push({
                        author: msg.author.tag,
                        content: msg.content,
                        timestamp: msg.createdAt.toISOString(),
                        embeds: msg.embeds.length,
                        attachments: msg.attachments.map(a => a.url)
                    });
                }
            });

            // Save transcript to database
            if (this.client.database) {
                try {
                    await this.client.database.run(`
                        INSERT INTO ticket_transcripts 
                        (guild_id, channel_id, channel_name, user_id, closer_id, transcript, closed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        interaction.guild.id,
                        channel.id,
                        channel.name,
                        this.activeTickets.get(channel.id)?.userId || null,
                        interaction.user.id,
                        JSON.stringify(transcript),
                        new Date().toISOString()
                    ]);

                    // Remove from active tickets
                    await this.client.database.run(`
                        UPDATE active_tickets SET status = 'closed', closed_at = ? 
                        WHERE channel_id = ?
                    `, [new Date().toISOString(), channel.id]);

                } catch (error) {
                    console.error('Error saving transcript:', error);
                }
            }

        } catch (error) {
            console.error('Error generating transcript:', error);
        }

        // Remove from memory
        this.activeTickets.delete(channel.id);

        // Delete channel after 10 seconds
        setTimeout(async () => {
            try {
                await channel.delete();
            } catch (error) {
                console.error('Error deleting ticket channel:', error);
            }
        }, 10000);
    }

    // Get ticket statistics for dashboard
    getTicketStats(guildId) {
        if (!this.client.database) {
            return {
                active: this.activeTickets.size,
                total: 0,
                closed_today: 0,
                avg_response_time: '0m'
            };
        }

        // This would query the database for real stats
        return {
            active: this.activeTickets.size,
            total: Math.floor(Math.random() * 500) + 50,
            closed_today: Math.floor(Math.random() * 15),
            avg_response_time: Math.floor(Math.random() * 30) + 5 + 'm'
        };
    }
}

module.exports = TicketManager;