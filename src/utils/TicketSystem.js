const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

class TicketSystem {
    constructor(bot) {
        this.bot = bot;
        // Cache configs to prevent database lookup failures
        this.configCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    // ------- Setup -------
    async handleSetup(interaction, options) {
        const { channel, staffRole, adminRole, category } = options;
        await interaction.deferReply({ ephemeral: true });

        // Validate roles/channels exist in guild
        if (channel.type !== ChannelType.GuildText) {
            return interaction.editReply({ content: '❌ The panel channel must be a text channel.' });
        }
        if (category && category.type !== ChannelType.GuildCategory) {
            return interaction.editReply({ content: '❌ The ticket category must be a category channel.' });
        }

        try {
            // First, ensure the guild exists in guild_configs
            const existing = await this.bot.database.get(
                `SELECT guild_id FROM guild_configs WHERE guild_id = ?`,
                [interaction.guild.id]
            );

            if (!existing) {
                // Create initial guild config entry
                await this.bot.database.run(
                    `INSERT INTO guild_configs (guild_id, created_at, updated_at) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [interaction.guild.id]
                );
                this.bot.logger?.info(`Created new guild_configs entry for ${interaction.guild.id}`);
            }

            // Now update the ticket configuration
            await this.bot.database.run(
                `UPDATE guild_configs SET
                    ticket_channel_id = ?,
                    ticket_staff_role = ?,
                    ticket_manage_role = ?,
                    ticket_category_id = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE guild_id = ?`,
                [
                    channel.id,
                    staffRole.id,
                    adminRole?.id || null,
                    category?.id || null,
                    interaction.guild.id
                ]
            );

            this.bot.logger?.info(`Updated ticket config for guild ${interaction.guild.id}: channel=${channel.id}, staff=${staffRole.id}`);

            // Clear cache to force fresh config on next request
            this.configCache.delete(interaction.guild.id);
            
            // Verify the config was saved
            const savedConfig = await this.getConfig(interaction.guild.id, true);
            
            if (!savedConfig?.ticket_staff_role || !savedConfig?.ticket_channel_id) {
                this.bot.logger?.error(`Config verification failed after save:`, savedConfig);
                throw new Error('Configuration was not saved correctly');
            }
            
            this.bot.logger?.info(`Verified ticket config saved for guild ${interaction.guild.id}:`, savedConfig);

            await this.postPanel(channel);

            const confirm = new EmbedBuilder()
                .setTitle('✅ Ticket system ready')
                .setDescription([
                    `Panel posted in ${channel}`,
                    `Staff role: ${staffRole}`,
                    adminRole ? `Admin role: ${adminRole}` : null,
                    category ? `Category: ${category}` : null,
                    '',
                    'Users can now open tickets from the panel.'
                ].filter(Boolean).join('\n'))
                .setColor('#2ed573');

            await interaction.editReply({ embeds: [confirm] });
        } catch (error) {
            this.bot.logger.error('Failed to save ticket setup:', error);
            await interaction.editReply({ content: '❌ Failed to configure ticket system. Check bot permissions and try again.' });
        }
    }

    async postPanel(channel) {
        const panelEmbed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription([
                'Need help? Click the button below to open a ticket.',
                'Staff will respond as soon as possible.'
            ].join('\n'))
            .setColor('#0096ff');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_open')
                .setLabel('📝 Create Ticket')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [panelEmbed], components: [row] });
    }

    // ------- Creation -------
    async handleCreateButton(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('ticket_create_modal')
            .setTitle('Create a Support Ticket');

        const titleInput = new TextInputBuilder()
            .setCustomId('ticket_title')
            .setLabel('Problem Title')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticket_desc')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1200);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput)
        );

        return interaction.showModal(modal);
    }

    async handleModalSubmit(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // Check if server is in lockdown
        if (this.bot.lockdownManager) {
            const shouldBlock = await this.bot.lockdownManager.shouldBlockTickets(interaction.guild.id);
            if (shouldBlock) {
                return interaction.editReply({
                    content: '❌ Ticket creation is currently disabled due to server lockdown. Please try again later.',
                    ephemeral: true
                });
            }
        }

        const config = await this.getConfig(interaction.guild.id);
        
        // Better error reporting
        if (!config) {
            this.bot.logger?.error(`No config found in database for guild ${interaction.guild.id}`);
            return interaction.editReply({ 
                content: '❌ Ticket system is not configured. Ask an admin to run `/ticket setup`.\n**Debug:** No configuration found in database.' 
            });
        }
        
        if (!config.ticket_staff_role) {
            this.bot.logger?.error(`Missing ticket_staff_role in config for guild ${interaction.guild.id}:`, config);
            return interaction.editReply({ 
                content: '❌ Ticket system is not fully configured. Missing staff role.\n**Debug:** Please re-run `/ticket setup` to fix the configuration.' 
            });
        }
        
        if (!config.ticket_channel_id) {
            this.bot.logger?.error(`Missing ticket_channel_id in config for guild ${interaction.guild.id}:`, config);
            return interaction.editReply({ 
                content: '❌ Ticket system is not fully configured. Missing panel channel.\n**Debug:** Please re-run `/ticket setup` to fix the configuration.' 
            });
        }

        // Check existing open ticket
        const existing = await this.bot.database.get(
            `SELECT channel_id FROM active_tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`,
            [interaction.guild.id, interaction.user.id]
        );
        if (existing?.channel_id) {
            const channel = interaction.guild.channels.cache.get(existing.channel_id);
            return interaction.editReply({
                content: `❌ You already have an open ticket: ${channel ?? `<#${existing.channel_id}>`}`
            });
        }

        const title = interaction.fields.getTextInputValue('ticket_title').trim();
        const description = interaction.fields.getTextInputValue('ticket_desc').trim();
        const ticketId = await this.getNextTicketId(interaction.guild.id);

        const channel = await this.createTicketChannel({
            interaction,
            ticketId,
            subject: title,
            description,
            config
        });

        if (!channel) {
            return interaction.editReply({ content: '❌ Failed to create ticket channel. Please contact staff.' });
        }

        await interaction.editReply({ content: `✅ Ticket #${ticketId} created: ${channel}` });

        await this.notifyUser(interaction.user, ticketId, channel);
        await this.logAction(interaction.guild, config, this.buildLogEmbed('created', interaction.user, ticketId, channel));
        await this.emitWebsite('ticketCreated', {
            guildId: interaction.guild.id,
            ticketId,
            channelId: channel.id,
            userId: interaction.user.id,
            username: interaction.user.tag,
            staff: null,
            status: 'open',
            title,
            description,
            timestamp: new Date().toISOString()
        });
    }

    async createTicketChannel({ interaction, ticketId, subject, description, config }) {
        const guild = interaction.guild;
        const requester = interaction.user;
        const cleanUser = requester.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
        const channelName = `ticket-${ticketId}-${cleanUser}`;

        const overwrites = [
            { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
            { id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
            { id: config.ticket_staff_role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages] },
            { id: this.bot.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ];

        if (config.ticket_manage_role) {
            overwrites.push({
                id: config.ticket_manage_role,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.ManageChannels
                ]
            });
        }

        try {
            const channel = await guild.channels.create({
                name: channelName.slice(0, 90),
                type: ChannelType.GuildText,
                parent: config.ticket_category_id || null,
                topic: `Ticket #${ticketId} | ${requester.tag}`,
                permissionOverwrites: overwrites
            });

            await this.bot.database.run(
                `INSERT INTO active_tickets (guild_id, channel_id, user_id, ticket_id, subject, description, status, created_at, last_message_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [guild.id, channel.id, requester.id, ticketId, subject, description]
            );

            await this.bot.database.run(
                `INSERT INTO tickets (guild_id, channel_id, user_id, ticket_id, subject, description, status, created_at, last_message_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [guild.id, channel.id, requester.id, ticketId, subject, description]
            );

            const embed = new EmbedBuilder()
                .setTitle('🎫 New Ticket Created')
                .setDescription([
                    `User: ${requester}`,
                    `Ticket ID: ${ticketId}`,
                    '',
                    `Problem: ${subject}`,
                    `Description:`,
                    description
                ].join('\n'))
                .setColor('#00d4ff')
                .setTimestamp();

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('📌 Claim Ticket')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
            );

            await channel.send({
                content: `${requester} <@&${config.ticket_staff_role}>`,
                embeds: [embed],
                components: [buttons]
            });

            return channel;
        } catch (error) {
            this.bot.logger.error('Failed to create ticket channel:', error);
            return null;
        }
    }

    async notifyUser(user, ticketId, channel) {
        try {
            const dm = new EmbedBuilder()
                .setTitle('✅ Your Ticket Has Been Created')
                .setDescription([
                    `Ticket ID: ${ticketId}`,
                    'A staff member will respond shortly.',
                    `Channel: ${channel}`
                ].join('\n'))
                .setColor('#2ed573');

            await user.send({ embeds: [dm] });
        } catch {
            await channel.send('⚠ Could not DM you. Please enable DMs from server members.');
        }
    }

    // ------- Claim -------
    async handleClaim(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const config = await this.getConfig(interaction.guild.id);
        const ticket = await this.bot.database.get(
            `SELECT * FROM active_tickets WHERE channel_id = ? AND status = 'open'`,
            [interaction.channel.id]
        );

        if (!ticket) {
            return interaction.editReply({ content: '❌ This is not an active ticket channel.' });
        }
        const ticketId = ticket.ticket_id || ticket.id || 'N/A';

        const isStaff = config?.ticket_staff_role && interaction.member.roles.cache.has(config.ticket_staff_role);
        const isAdminRole = config?.ticket_manage_role && interaction.member.roles.cache.has(config.ticket_manage_role);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isStaff && !isAdminRole && !isAdmin) {
            return interaction.editReply({ content: '❌ You do not have permission to claim this ticket.' });
        }

        if (ticket.assigned_to) {
            const claimer = await interaction.guild.members.fetch(ticket.assigned_to).catch(() => null);
            return interaction.editReply({
                content: claimer ? `❌ Already claimed by ${claimer}.` : '❌ This ticket is already claimed.'
            });
        }

        await this.bot.database.run(
            `UPDATE active_tickets SET assigned_to = ?, claimed_at = CURRENT_TIMESTAMP WHERE channel_id = ?`,
            [interaction.user.id, interaction.channel.id]
        );

        await interaction.channel.setTopic(`Ticket #${ticketId} | Assigned to ${interaction.user.tag}`).catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('📌 Ticket Claimed')
            .setDescription(`Ticket claimed by ${interaction.user}. They will now handle this ticket.`)
            .setColor('#2ed573')
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });
        await interaction.editReply({ content: '✅ You have claimed this ticket.' });

        await this.logAction(interaction.guild, config, this.buildLogEmbed('claimed', interaction.user, ticketId, interaction.channel));
        await this.emitWebsite('ticketClaimed', {
            guildId: interaction.guild.id,
            ticketId,
            channelId: interaction.channel.id,
            claimedBy: interaction.user.id
        });
    }

    // ------- Closing -------
    async handleClose(interaction, reason) {
        await interaction.deferReply({ ephemeral: true });
        const config = await this.getConfig(interaction.guild.id);

        const ticket = await this.bot.database.get(
            `SELECT * FROM active_tickets WHERE channel_id = ? AND status = 'open'`,
            [interaction.channel.id]
        );

        if (!ticket) {
            return interaction.editReply({ content: '❌ This is not an active ticket channel.' });
        }
        const ticketId = ticket.ticket_id || ticket.id || 'N/A';

        const isOwner = ticket.user_id === interaction.user.id;
        const isStaff = config?.ticket_staff_role && interaction.member.roles.cache.has(config.ticket_staff_role);
        const isAdminRole = config?.ticket_manage_role && interaction.member.roles.cache.has(config.ticket_manage_role);
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        if (!isOwner && !isStaff && !isAdminRole && !isAdmin) {
            return interaction.editReply({ content: '❌ You do not have permission to close this ticket.' });
        }

        await this.bot.database.run(
            `UPDATE active_tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?`,
            [interaction.channel.id]
        );

        await this.bot.database.run(
            `UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?`,
            [interaction.channel.id]
        );

        const transcript = await this.buildTranscript(interaction.channel);
        await this.bot.database.run(
            `INSERT INTO ticket_transcripts (guild_id, channel_id, channel_name, user_id, closer_id, ticket_id, transcript, message_count, closed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
                interaction.guild.id,
                interaction.channel.id,
                interaction.channel.name,
                ticket.user_id,
                interaction.user.id,
                ticket.ticket_id,
                JSON.stringify(transcript.logs),
                transcript.count
            ]
        );

        const closeEmbed = new EmbedBuilder()
            .setTitle('❎ Ticket Closed')
            .setDescription([
                `Ticket ID: ${ticketId}`,
                reason ? `Reason: ${reason}` : 'No reason provided.',
                '',
                'This channel will be deleted in 10 seconds.'
            ].join('\n'))
            .setColor('#ff4757')
            .setTimestamp();

        await interaction.channel.send({ embeds: [closeEmbed] });
        await interaction.editReply({ content: '✅ Ticket closed. The channel will be removed shortly.' });

        await this.notifyClosure(interaction, ticket, reason);
        await this.logAction(interaction.guild, config, this.buildLogEmbed('closed', interaction.user, ticketId, interaction.channel, reason));
        await this.emitWebsite('ticketClosed', {
            guildId: interaction.guild.id,
            ticketId,
            channelId: interaction.channel.id,
            closedBy: interaction.user.id,
            reason: reason || null,
            transcript
        });

        setTimeout(() => interaction.channel.delete('Ticket closed').catch(() => {}), 10000);
    }

    async notifyClosure(interaction, ticket, reason) {
        const ticketId = ticket.ticket_id || ticket.id || 'N/A';
        try {
            const dm = new EmbedBuilder()
                .setTitle('❎ Your ticket has been closed')
                .setDescription([
                    `Ticket ID: ${ticketId}`,
                    `Reason: ${reason || 'No reason provided.'}`,
                    'Thank you for contacting support.'
                ].join('\n'))
                .setColor('#ff4757');

            const user = await interaction.client.users.fetch(ticket.user_id);
            await user.send({ embeds: [dm] });
        } catch {
            await interaction.channel.send('⚠ Could not DM you. Please enable DMs from server members.');
        }
    }

    // Track staff/user replies inside ticket channels
    async handleTicketMessage(message) {
        const ticket = await this.bot.database.get(
            `SELECT * FROM active_tickets WHERE channel_id = ? AND status = 'open'`,
            [message.channel.id]
        );
        if (!ticket) return;

        await this.bot.database.run(
            `UPDATE active_tickets SET last_message_at = CURRENT_TIMESTAMP WHERE channel_id = ?`,
            [message.channel.id]
        );

        const attachments = [...message.attachments.values()].map(att => att.url);
        const avatar = typeof message.author.displayAvatarURL === 'function' ? message.author.displayAvatarURL() : null;

        await this.bot.database.run(
            `INSERT INTO ticket_messages (ticket_id, message_id, user_id, username, avatar_url, content, attachments)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                ticket.id,
                message.id,
                message.author.id,
                message.author.tag,
                avatar,
                message.content || '[no content]',
                JSON.stringify(attachments)
            ]
        ).catch(() => {});

        await this.emitWebsite('ticketMessage', {
            guildId: message.guild.id,
            ticketId: ticket.ticket_id || ticket.id,
            channelId: message.channel.id,
            userId: message.author.id,
            username: message.author.tag,
            content: message.content,
            attachments
        });
    }

    // ------- Helpers -------
    async getConfig(guildId, forceRefresh = false) {
        // Check cache first unless force refresh
        if (!forceRefresh && this.configCache.has(guildId)) {
            const cached = this.configCache.get(guildId);
            const now = Date.now();
            
            // Return cached config if still valid (within 5 minutes)
            if (cached.timestamp && (now - cached.timestamp) < this.cacheTimeout) {
                this.bot.logger?.debug(`Using cached ticket config for guild ${guildId}`);
                return cached.config;
            }
        }

        try {
            // Query database
            const config = await this.bot.database.get(
                `SELECT ticket_channel_id, ticket_staff_role, ticket_manage_role, ticket_category_id, ticket_log_channel, log_channel_id
                 FROM guild_configs WHERE guild_id = ?`,
                [guildId]
            );

            // Log for debugging
            this.bot.logger?.debug(`Fetched ticket config for guild ${guildId}:`, config);

            // Cache the result
            this.configCache.set(guildId, {
                config: config || null,
                timestamp: Date.now()
            });

            return config || null;
        } catch (error) {
            this.bot.logger?.error(`Failed to fetch ticket config for guild ${guildId}:`, error);
            
            // Return cached config even if expired, better than nothing
            if (this.configCache.has(guildId)) {
                const cached = this.configCache.get(guildId);
                this.bot.logger?.warn(`Returning expired cached config for guild ${guildId} due to database error`);
                return cached.config;
            }
            
            return null;
        }
    }

    /**
     * Clear cached config for a guild (useful after setup/changes)
     */
    clearConfigCache(guildId) {
        if (guildId) {
            this.configCache.delete(guildId);
            this.bot.logger?.debug(`Cleared ticket config cache for guild ${guildId}`);
        } else {
            this.configCache.clear();
            this.bot.logger?.debug(`Cleared all ticket config cache`);
        }
    }

    async getNextTicketId(guildId) {
        const row = await this.bot.database.get(
            `SELECT MAX(CAST(ticket_id AS INTEGER)) as maxId FROM active_tickets WHERE guild_id = ?`,
            [guildId]
        );
        const next = (row?.maxId || 0) + 1;
        return next.toString().padStart(4, '0');
    }

    async buildTranscript(channel) {
        const messages = await channel.messages.fetch({ limit: 200 }).catch(() => null);
        if (!messages) return { logs: [], count: 0 };

        const sorted = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const logs = sorted.map(msg => ({
            author: msg.author?.tag || 'Unknown',
            authorId: msg.author?.id,
            timestamp: msg.createdAt?.toISOString(),
            content: msg.content,
            attachments: [...msg.attachments.values()].map(att => att.url)
        }));

        return { logs, count: logs.length };
    }

    async logAction(guild, config, embed) {
        const channelId = config?.ticket_log_channel || config?.log_channel_id;
        if (!channelId) return;

        const logChannel = guild.channels.cache.get(channelId);
        if (!logChannel) return;

        const perms = logChannel.permissionsFor(guild.members.me);
        if (!perms || !perms.has(PermissionFlagsBits.SendMessages)) return;
        return logChannel.send({ embeds: [embed] }).catch(() => {});
    }

    buildLogEmbed(action, actor, ticketId, channel, reason) {
        const embed = new EmbedBuilder()
            .setColor('#0096ff')
            .setTimestamp()
            .addFields(
                { name: 'Ticket', value: ticketId ? `#${ticketId}` : channel?.name || 'Unknown', inline: true },
                { name: 'Channel', value: channel ? channel.toString() : 'Unknown', inline: true },
                { name: 'Actor', value: actor?.toString() || 'Unknown', inline: true }
            );

        switch (action) {
            case 'created':
                embed.setTitle('🎫 Ticket Created');
                break;
            case 'claimed':
                embed.setTitle('📌 Ticket Claimed');
                break;
            case 'closed':
                embed.setTitle('❎ Ticket Closed');
                if (reason) embed.addFields({ name: 'Reason', value: reason });
                break;
            default:
                embed.setTitle('Ticket Update');
        }

        return embed;
    }

    async emitWebsite(event, payload) {
        if (this.bot.eventEmitter) {
            this.bot.eventEmitter.emit(event, payload);
        }
    }

    /**
     * Claim a ticket initiated from the dashboard
     */
    async claimFromDashboard(ticketIdOrId, staffId) {
        try {
            const ticket = await this.bot.database.get(`SELECT * FROM active_tickets WHERE ticket_id = ? OR id = ?`, [ticketIdOrId, ticketIdOrId]);
            if (!ticket) return { ok: false, error: 'Ticket not found' };

            const guild = this.bot.client.guilds.cache.get(ticket.guild_id);
            if (!guild) return { ok: false, error: 'Guild not found' };

            const config = await this.getConfig(guild.id);

            await this.bot.database.run(`UPDATE active_tickets SET assigned_to = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?`, [staffId, ticket.id]);

            const channel = guild.channels.cache.get(ticket.channel_id);
            if (channel && channel.isTextBased && channel.isTextBased()) {
                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setTitle('📌 Ticket Claimed')
                    .setDescription(`This ticket has been claimed by <@${staffId}>.`)
                    .setColor('#00d4ff')
                    .setTimestamp();

                await channel.send({ embeds: [embed] }).catch(() => {});
                // Update topic if possible
                try { await channel.setTopic(`Ticket #${ticket.ticket_id} | Assigned to <@${staffId}>`); } catch (e) {}
            }

            // Log action
            try {
                await this.logAction(guild, config, this.buildLogEmbed('claimed', { toString: () => `<@${staffId}>` }, ticket.ticket_id || ticket.id, channel || null));
            } catch (e) {}

            // Emit website event
            await this.emitWebsite('ticketClaimed', { guildId: guild.id, ticketId: ticket.ticket_id || ticket.id, channelId: ticket.channel_id, claimedBy: staffId });

            return { ok: true };
        } catch (error) {
            this.bot.logger?.error('Error in claimFromDashboard:', error);
            return { ok: false, error: error.message };
        }
    }

    /**
     * Close a ticket initiated from the dashboard
     */
    async closeFromDashboard(ticketIdOrId, closerId, reason) {
        try {
            const ticket = await this.bot.database.get(`SELECT * FROM active_tickets WHERE ticket_id = ? OR id = ?`, [ticketIdOrId, ticketIdOrId]);
            if (!ticket) return { ok: false, error: 'Ticket not found' };

            const guild = this.bot.client.guilds.cache.get(ticket.guild_id);
            if (!guild) return { ok: false, error: 'Guild not found' };

            const channel = guild.channels.cache.get(ticket.channel_id);

            await this.bot.database.run(`UPDATE active_tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ? WHERE id = ?`, [closerId, ticket.id]);
            await this.bot.database.run(`UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`, [ticket.id]);

            // Build transcript and persist
            let transcript = { logs: [], count: 0 };
            if (channel && channel.isTextBased && channel.isTextBased()) {
                transcript = await this.buildTranscript(channel).catch(() => ({ logs: [], count: 0 }));
            }

            await this.bot.database.run(
                `INSERT INTO ticket_transcripts (guild_id, channel_id, channel_name, user_id, closer_id, ticket_id, transcript, message_count, closed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [ticket.guild_id, ticket.channel_id, channel?.name || null, ticket.user_id, closerId, ticket.ticket_id, JSON.stringify(transcript.logs), transcript.count]
            ).catch(() => {});

            // Notify channel and owner
            if (channel && channel.isTextBased && channel.isTextBased()) {
                const { EmbedBuilder } = require('discord.js');
                const closeEmbed = new EmbedBuilder()
                    .setTitle('❎ Ticket Closed')
                    .setDescription([`Ticket ID: ${ticket.ticket_id || ticket.id}`, reason ? `Reason: ${reason}` : 'No reason provided.', '', 'This channel will be deleted in 10 seconds.'].join('\n'))
                    .setColor('#ff4757')
                    .setTimestamp();

                await channel.send({ embeds: [closeEmbed] }).catch(() => {});
                setTimeout(() => channel.delete('Ticket closed from dashboard').catch(() => {}), 10000);
            }

            try {
                const user = await this.bot.client.users.fetch(ticket.user_id).catch(() => null);
                if (user) {
                    const { EmbedBuilder } = require('discord.js');
                    const dm = new EmbedBuilder()
                        .setTitle('❎ Your ticket has been closed')
                        .setDescription([`Ticket ID: ${ticket.ticket_id || ticket.id}`, `Reason: ${reason || 'No reason provided.'}`, 'Thank you for contacting support.'].join('\n'))
                        .setColor('#ff4757');
                    await user.send({ embeds: [dm] }).catch(() => {});
                }
            } catch (e) {}

            // Log action
            const config = await this.getConfig(guild.id);
            try { await this.logAction(guild, config, this.buildLogEmbed('closed', { toString: () => `<@${closerId}>` }, ticket.ticket_id || ticket.id, channel || null, reason)); } catch (e) {}

            // Emit website event
            await this.emitWebsite('ticketClosed', { guildId: guild.id, ticketId: ticket.ticket_id || ticket.id, channelId: ticket.channel_id, closedBy: closerId, reason: reason || null, transcript });

            return { ok: true };
        } catch (error) {
            this.bot.logger?.error('Error in closeFromDashboard:', error);
            return { ok: false, error: error.message };
        }
    }

    /**
     * Reply to a ticket initiated from the dashboard
     */
    async replyFromDashboard(ticketIdOrId, senderId, messageContent) {
        try {
            const ticket = await this.bot.database.get(`SELECT * FROM active_tickets WHERE ticket_id = ? OR id = ?`, [ticketIdOrId, ticketIdOrId]);
            if (!ticket) return { ok: false, error: 'Ticket not found' };

            const guild = this.bot.client.guilds.cache.get(ticket.guild_id);
            if (!guild) return { ok: false, error: 'Guild not found' };

            const channel = guild.channels.cache.get(ticket.channel_id);
            const sender = await guild.members.fetch(senderId).catch(() => null);

            const { EmbedBuilder } = require('discord.js');
            const replyEmbed = new EmbedBuilder()
                .setAuthor({ name: sender ? sender.user.tag : 'Staff', iconURL: sender ? sender.user.displayAvatarURL() : null })
                .setDescription(messageContent)
                .setColor('#00d4ff')
                .setTimestamp();

            if (channel && channel.isTextBased && channel.isTextBased()) {
                await channel.send({ embeds: [replyEmbed] }).catch(() => {});
            }

            // Send DM to ticket owner
            try {
                const ticketOwner = await this.bot.client.users.fetch(ticket.user_id).catch(() => null);
                if (ticketOwner) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle(`💬 Reply to Ticket #${ticket.ticket_id || ticket.id}`)
                        .setDescription(messageContent)
                        .setFooter({ text: `From: ${sender ? sender.user.tag : 'Staff'}` })
                        .setColor('#00d4ff')
                        .setTimestamp();
                    await ticketOwner.send({ embeds: [dmEmbed] }).catch(() => {});
                }
            } catch (dmError) {}

            // Persist message to ticket_messages table
            try {
                await this.bot.database.run(
                    `INSERT INTO ticket_messages (ticket_id, message_id, user_id, username, avatar_url, content, attachments)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [ticket.id, null, senderId, sender ? sender.user.tag : 'Staff', sender ? sender.user.displayAvatarURL() : null, messageContent, JSON.stringify([])]
                );
            } catch (e) { }

            // Emit website event for updates
            await this.emitWebsite('ticketMessage', { guildId: guild.id, ticketId: ticket.ticket_id || ticket.id, channelId: ticket.channel_id, userId: senderId, username: sender ? sender.user.tag : 'Staff', content: messageContent, attachments: [] });

            return { ok: true };
        } catch (error) {
            this.bot.logger?.error('Error in replyFromDashboard:', error);
            return { ok: false, error: error.message };
        }
    }
}

module.exports = TicketSystem;
