/**
 * Ticket Interaction Handlers
 * Extracted from bot.js - handles all ticket-related interactions
 */

const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField, 
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// Rate limiting for ticket creation via buttons
const buttonTicketCooldowns = new Map(); // guildId_userId -> timestamp
const BUTTON_TICKET_COOLDOWN_MS = 60000; // 1 minute
const MAX_OPEN_TICKETS = 3;

/**
 * Handle ticket creation from button click
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleTicketCreate(interaction, bot) {
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;
    const cooldownKey = `${guildId}_${userId}`;
    const now = Date.now();
    
    // Check rate limit BEFORE deferring to fail fast
    const lastCreation = buttonTicketCooldowns.get(cooldownKey);
    if (lastCreation && (now - lastCreation) < BUTTON_TICKET_COOLDOWN_MS) {
        const remaining = Math.ceil((BUTTON_TICKET_COOLDOWN_MS - (now - lastCreation)) / 1000);
        return interaction.reply({ 
            content: `⏳ Please wait ${remaining} seconds before creating another ticket.`, 
            ephemeral: true 
        });
    }
    
    // Set cooldown immediately to prevent race conditions
    buttonTicketCooldowns.set(cooldownKey, now);
    
    await interaction.deferReply({ ephemeral: true });

    try {
        const guild = interaction.guild;
        const user = interaction.user;

        // Get guild ticket config
        const config = await bot.database.get(
            'SELECT ticket_staff_role, ticket_category_id, max_tickets_per_user FROM guild_configs WHERE guild_id = ?',
            [guild.id]
        );

        if (!config || !config.ticket_staff_role) {
            return await interaction.editReply({
                content: '❌ Ticket system is not configured. Ask an admin to run `/ticket setup`.',
                ephemeral: true
            });
        }

        // Check if user already has open tickets (enforce max)
        const openTicketCount = await bot.database.get(
            'SELECT COUNT(*) as count FROM active_tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
            [guild.id, user.id, 'open']
        );
        
        const maxTickets = config.max_tickets_per_user || MAX_OPEN_TICKETS;
        if (openTicketCount && openTicketCount.count >= maxTickets) {
            // Find their existing ticket to link to
            const existingTicket = await bot.database.get(
                'SELECT channel_id FROM active_tickets WHERE guild_id = ? AND user_id = ? AND status = ? LIMIT 1',
                [guild.id, user.id, 'open']
            );
            const channel = existingTicket ? guild.channels.cache.get(existingTicket.channel_id) : null;
            return await interaction.editReply({
                content: channel 
                    ? `❌ You already have ${openTicketCount.count} open ticket(s). Maximum is ${maxTickets}. Your ticket: ${channel}`
                    : `❌ You have reached the maximum number of open tickets (${maxTickets}).`,
                ephemeral: true
            });
        }

        // Create ticket channel
        const ticketNumber = Date.now().toString().slice(-6);
        const channelName = `ticket-${user.username}-${ticketNumber}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

        const channelOptions = {
            name: channelName,
            type: ChannelType.GuildText,
            parent: config.ticket_category_id || null,
            topic: `Support ticket for ${user.tag} | User ID: ${user.id}`,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                },
                {
                    id: config.ticket_staff_role,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageMessages
                    ]
                },
                {
                    id: bot.client.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                }
            ]
        };

        const ticketChannel = await guild.channels.create(channelOptions);

        // Save to database
        await bot.database.run(`
            INSERT INTO active_tickets (guild_id, channel_id, user_id, status, created_at)
            VALUES (?, ?, ?, 'open', CURRENT_TIMESTAMP)
        `, [guild.id, ticketChannel.id, user.id]);

        // Send welcome message
        const welcomeEmbed = new EmbedBuilder()
            .setTitle('🎫 Support Ticket Created')
            .setDescription(`
Hello ${user}, welcome to your support ticket!

Please describe your issue in detail. A staff member will assist you shortly.

**What happens next:**
• Staff will be notified of your ticket
• Please be patient and wait for a response
• Click the button below when your issue is resolved
            `)
            .setColor('#0096ff')
            .setTimestamp();

        const closeRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

        await ticketChannel.send({
            content: `${user} | <@&${config.ticket_staff_role}>`,
            embeds: [welcomeEmbed],
            components: [closeRow]
        });

        await interaction.editReply({
            content: `✅ Ticket created! ${ticketChannel}`,
            ephemeral: true
        });

    } catch (error) {
        bot.logger.error('Error creating ticket:', error);
        await interaction.editReply({
            content: '❌ Failed to create ticket. Please contact an administrator.',
            ephemeral: true
        });
    }
}

/**
 * Handle ticket close
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleTicketClose(interaction, bot) {
    await interaction.deferReply();

    try {
        const channel = interaction.channel;

        // Check if this is a ticket channel
        const ticket = await bot.database.get(
            'SELECT * FROM active_tickets WHERE channel_id = ? AND status = ?',
            [channel.id, 'open']
        );

        if (!ticket) {
            return await interaction.editReply({
                content: '❌ This is not an active ticket channel.',
                ephemeral: true
            });
        }

        // Check permissions (ticket owner or staff)
        const config = await bot.database.get(
            'SELECT ticket_staff_role FROM guild_configs WHERE guild_id = ?',
            [interaction.guild.id]
        );

        const isOwner = interaction.user.id === ticket.user_id;
        const isStaff = config && interaction.member.roles.cache.has(config.ticket_staff_role);
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

        if (!isOwner && !isStaff && !isAdmin) {
            return await interaction.editReply({
                content: '❌ You don\'t have permission to close this ticket.',
                ephemeral: true
            });
        }

        // Update database
        await bot.database.run(
            'UPDATE active_tickets SET status = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE channel_id = ?',
            ['closed', interaction.user.id, channel.id]
        );

        // Send closing message
        const closeEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket Closed')
            .setDescription(`
This ticket has been closed by ${interaction.user}.

The channel will be deleted in 10 seconds...
            `)
            .setColor('#ff4757')
            .setTimestamp();

        await interaction.editReply({ embeds: [closeEmbed] });

        // Delete channel after delay
        setTimeout(async () => {
            try {
                await channel.delete('Ticket closed');
            } catch (error) {
                bot.logger.error('Error deleting ticket channel:', error);
            }
        }, 10000);

    } catch (error) {
        bot.logger.error('Error closing ticket:', error);
        await interaction.editReply({
            content: '❌ Failed to close ticket. Please contact an administrator.',
            ephemeral: true
        });
    }
}

/**
 * Show ticket creation modal
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleTicketCreateModal(interaction, bot) {
    try {
        // Create modal with Problem and Detailed Description fields
        const modal = new ModalBuilder()
            .setCustomId('ticket_modal')
            .setTitle('📨 Create Support Ticket');

        const problemInput = new TextInputBuilder()
            .setCustomId('ticket_problem')
            .setLabel('Problem')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Brief summary of your issue...')
            .setRequired(true)
            .setMaxLength(100);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticket_description')
            .setLabel('Detailed Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Provide all relevant details about your issue...')
            .setRequired(true)
            .setMaxLength(1000);

        const problemRow = new ActionRowBuilder().addComponents(problemInput);
        const descriptionRow = new ActionRowBuilder().addComponents(descriptionInput);

        modal.addComponents(problemRow, descriptionRow);

        await interaction.showModal(modal);
    } catch (error) {
        bot.logger.error('Error showing ticket modal:', error);
        await interaction.reply({
            content: '❌ Failed to open ticket creation form.',
            ephemeral: true
        });
    }
}

/**
 * Handle ticket modal submission
 * @param {ModalSubmitInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleTicketSubmit(interaction, bot) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get ticket config
        const config = await bot.database.get(
            'SELECT ticket_channel_id, ticket_staff_role, ticket_manage_role, ticket_category_id FROM guild_configs WHERE guild_id = ?',
            [interaction.guild.id]
        );

        if (!config || !config.ticket_channel_id) {
            return await interaction.editReply({
                content: '❌ Ticket system is not set up. Ask an admin to run `/ticket setup`.',
                ephemeral: true
            });
        }

        // Check if user already has an open ticket
        const existingTicket = await bot.database.get(
            'SELECT * FROM active_tickets WHERE guild_id = ? AND user_id = ? AND status = ?',
            [interaction.guild.id, interaction.user.id, 'open']
        );

        if (existingTicket) {
            return await interaction.editReply({
                content: `❌ You already have an open ticket: <#${existingTicket.channel_id}>`,
                ephemeral: true
            });
        }

        // Get form data
        const problem = interaction.fields.getTextInputValue('ticket_problem');
        const description = interaction.fields.getTextInputValue('ticket_description');

        // Generate ticket ID
        const ticketCount = await bot.database.get(
            'SELECT COUNT(*) as count FROM active_tickets WHERE guild_id = ?',
            [interaction.guild.id]
        );
        const ticketId = (ticketCount.count + 1).toString().padStart(4, '0');

        // Create ticket channel
        const channelName = `ticket-${interaction.user.username}-${ticketId}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
        
        const ticketChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: config.ticket_category_id || null,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                },
                {
                    id: config.ticket_staff_role,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                }
            ]
        });

        // Add manage role if specified
        if (config.ticket_manage_role) {
            await ticketChannel.permissionOverwrites.create(config.ticket_manage_role, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                ManageChannels: true,
                ManageMessages: true
            });
        }

        // Save to database
        await bot.database.run(
            `INSERT INTO active_tickets (guild_id, channel_id, user_id, ticket_id, problem, description, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [interaction.guild.id, ticketChannel.id, interaction.user.id, ticketId, problem, description, 'open']
        );

        // Send welcome message in ticket channel
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket #${ticketId}`)
            .setDescription(`
**Problem:** ${problem}

**Description:**
${description}

**Created by:** ${interaction.user}
**Status:** 🟢 Open

Our support team will be with you shortly!
            `)
            .setColor('#00d4ff')
            .setTimestamp();

        const closeButton = new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('🔒 Close Ticket')
            .setStyle(ButtonStyle.Danger);

        const buttonRow = new ActionRowBuilder().addComponents(closeButton);

        await ticketChannel.send({
            content: `${interaction.user} | <@&${config.ticket_staff_role}>`,
            embeds: [welcomeEmbed],
            components: [buttonRow]
        });

        // Send DM confirmation to user
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('✅ Ticket Created')
                .setDescription(`
Your support ticket has been created successfully!

**Ticket ID:** #${ticketId}
**Channel:** ${ticketChannel}

Our support team will reach out shortly. Please check the ticket channel for updates.
                `)
                .setColor('#2ed573')
                .setTimestamp();

            await interaction.user.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            bot.logger.warn(`Could not send DM to ${interaction.user.tag}:`, dmError.message);
        }

        // Reply to interaction
        await interaction.editReply({
            content: `✅ Your ticket has been created: ${ticketChannel}`,
            ephemeral: true
        });

        // Emit event for dashboard
        if (bot.backend && bot.backend.eventEmitter) {
            bot.backend.eventEmitter.emit('ticketCreated', {
                guildId: interaction.guild.id,
                ticketId,
                channelId: ticketChannel.id,
                userId: interaction.user.id,
                problem,
                description
            });
        }

    } catch (error) {
        bot.logger.error('Error creating ticket:', error);
        await interaction.editReply({
            content: '❌ Failed to create ticket. Please contact an administrator.',
            ephemeral: true
        });
    }
}

/**
 * Handle ticket claim by staff
 * @param {ButtonInteraction} interaction 
 * @param {SecurityBot} bot 
 */
async function handleTicketClaim(interaction, bot) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Get ticket config
        const config = await bot.database.get(
            'SELECT ticket_staff_role, ticket_manage_role FROM guild_configs WHERE guild_id = ?',
            [interaction.guild.id]
        );

        if (!config) {
            return await interaction.editReply({
                content: '❌ Ticket system is not configured.',
                ephemeral: true
            });
        }

        // Check if user has staff or manage role
        const hasStaffRole = interaction.member.roles.cache.has(config.ticket_staff_role);
        const hasManageRole = config.ticket_manage_role && interaction.member.roles.cache.has(config.ticket_manage_role);
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

        if (!hasStaffRole && !hasManageRole && !isAdmin) {
            return await interaction.editReply({
                content: '❌ You don\'t have permission to claim tickets.',
                ephemeral: true
            });
        }

        // Get ticket from database
        const ticket = await bot.database.get(
            'SELECT * FROM active_tickets WHERE channel_id = ? AND status = ?',
            [interaction.channel.id, 'open']
        );

        if (!ticket) {
            return await interaction.editReply({
                content: '❌ This is not an active ticket channel.',
                ephemeral: true
            });
        }

        // Check if already claimed
        if (ticket.claimed_by) {
            const claimer = await interaction.guild.members.fetch(ticket.claimed_by);
            return await interaction.editReply({
                content: `❌ This ticket has already been claimed by ${claimer}.`,
                ephemeral: true
            });
        }

        // Claim the ticket
        await bot.database.run(
            'UPDATE active_tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
            [interaction.user.id, interaction.channel.id]
        );

        // Send claim message
        const claimEmbed = new EmbedBuilder()
            .setTitle('✅ Ticket Claimed')
            .setDescription(`This ticket has been claimed by ${interaction.user}`)
            .setColor('#2ed573')
            .setTimestamp();

        await interaction.channel.send({ embeds: [claimEmbed] });

        // Update original panel message to disable claim button (if found)
        try {
            const messages = await interaction.channel.messages.fetch({ limit: 50 });
            const welcomeMessage = messages.find(msg => 
                msg.author.id === bot.client.user.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].title?.includes('Ticket #')
            );

            if (welcomeMessage && welcomeMessage.components.length > 0) {
                // Keep the close button, but disable claim if it exists
                const closeButton = new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('🔒 Close Ticket')
                    .setStyle(ButtonStyle.Danger);

                const buttonRow = new ActionRowBuilder().addComponents(closeButton);
                await welcomeMessage.edit({ components: [buttonRow] });
            }
        } catch (updateError) {
            bot.logger.warn('Could not update ticket message:', updateError.message);
        }

        await interaction.editReply({
            content: '✅ You have claimed this ticket.',
            ephemeral: true
        });

        // Emit event for dashboard
        if (bot.backend && bot.backend.eventEmitter) {
            bot.backend.eventEmitter.emit('ticketClaimed', {
                guildId: interaction.guild.id,
                ticketId: ticket.ticket_id,
                channelId: interaction.channel.id,
                claimedBy: interaction.user.id
            });
        }

    } catch (error) {
        bot.logger.error('Error claiming ticket:', error);
        await interaction.editReply({
            content: '❌ Failed to claim ticket. Please try again.',
            ephemeral: true
        });
    }
}

module.exports = {
    handleTicketCreate,
    handleTicketClose,
    handleTicketCreateModal,
    handleTicketSubmit,
    handleTicketClaim
};
