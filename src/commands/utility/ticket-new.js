/**
 * /ticket - Unified Ticket System Command
 * All ticket operations in one command
 * 
 * Structure:
 * /ticket create [reason] - Create a new ticket (anyone)
 * /ticket close [reason] - Close current ticket (staff/creator)
 * /ticket add @user - Add user to ticket (staff)
 * /ticket remove @user - Remove user from ticket (staff)
 * /ticket claim - Claim this ticket (staff)
 * /ticket transfer @staff - Transfer to another staff (staff)
 * /ticket priority [level] - Set priority (staff)
 * /ticket tag [tag] - Add tag to ticket (staff)
 * /ticket transcript - Generate transcript (staff)
 * /ticket stats - View ticket statistics (staff)
 * /ticket setup - Configure ticket system (admin)
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

// Rate limiting for ticket creation - prevents ticket bombing
const ticketCooldowns = new Map(); // guildId_userId -> timestamp
const TICKET_COOLDOWN_MS = 60000; // 1 minute between ticket creations
const MAX_OPEN_TICKETS_PER_USER = 3; // Max open tickets per user

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('🎫 Support ticket system')
        
        // CREATE - Anyone can use
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Create a new support ticket')
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Brief reason for the ticket')
                .setRequired(false)))
        
        // CLOSE - Staff/creator
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close the current ticket')
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for closing')
                .setRequired(false)))
        
        // ADD USER - Staff only
        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Add a user to this ticket')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to add')
                .setRequired(true)))
        
        // REMOVE USER - Staff only
        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Remove a user from this ticket')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('User to remove')
                .setRequired(true)))
        
        // CLAIM - Staff only
        .addSubcommand(sub => sub
            .setName('claim')
            .setDescription('Claim this ticket as yours'))
        
        // TRANSFER - Staff only
        .addSubcommand(sub => sub
            .setName('transfer')
            .setDescription('Transfer ticket to another staff member')
            .addUserOption(opt => opt
                .setName('staff')
                .setDescription('Staff member to transfer to')
                .setRequired(true)))
        
        // PRIORITY - Staff only
        .addSubcommand(sub => sub
            .setName('priority')
            .setDescription('Set ticket priority')
            .addStringOption(opt => opt
                .setName('level')
                .setDescription('Priority level')
                .setRequired(true)
                .addChoices(
                    { name: '🔴 Urgent', value: 'urgent' },
                    { name: '🟠 High', value: 'high' },
                    { name: '🟡 Normal', value: 'normal' },
                    { name: '🟢 Low', value: 'low' }
                )))
        
        // TAG - Staff only
        .addSubcommand(sub => sub
            .setName('tag')
            .setDescription('Add a tag to this ticket')
            .addStringOption(opt => opt
                .setName('type')
                .setDescription('Tag type')
                .setRequired(true)
                .addChoices(
                    { name: '🛠️ Technical', value: 'technical' },
                    { name: '💰 Billing', value: 'billing' },
                    { name: '🤝 Support', value: 'support' },
                    { name: '⚠️ Report', value: 'report' },
                    { name: '💡 Suggestion', value: 'suggestion' }
                )))
        
        // TRANSCRIPT - Staff only
        .addSubcommand(sub => sub
            .setName('transcript')
            .setDescription('Generate a transcript of this ticket'))
        
        // STATS - Staff only
        .addSubcommand(sub => sub
            .setName('stats')
            .setDescription('View ticket statistics'))
        
        // SETUP - Admin only
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Configure the ticket system (Admin only)')
            .addChannelOption(opt => opt
                .setName('channel')
                .setDescription('Channel for ticket panel')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addRoleOption(opt => opt
                .setName('staff-role')
                .setDescription('Role that handles tickets')
                .setRequired(true))
            .addRoleOption(opt => opt
                .setName('admin-role')
                .setDescription('Higher permission role (optional)'))
            .addChannelOption(opt => opt
                .setName('category')
                .setDescription('Category for ticket channels')
                .addChannelTypes(ChannelType.GuildCategory))),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const sub = interaction.options.getSubcommand();

        if (!bot.ticketSystem) {
            return interaction.reply({ content: '❌ Ticket system is not available.', ephemeral: true });
        }

        // Get ticket config for permission checks
        // Use TicketSystem.getConfig() which queries guild_configs (where handleSetup saves)
        const ticketConfig = await bot.ticketSystem.getConfig(interaction.guild.id).catch(() => null);

        const isTicketChannel = interaction.channel.name.startsWith('ticket-');
        const isStaff = ticketConfig && (
            interaction.member.roles.cache.has(ticketConfig.ticket_staff_role) ||
            interaction.member.roles.cache.has(ticketConfig.ticket_manage_role) ||
            interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        );
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

        // ============ CREATE ============
        if (sub === 'create') {
            // Block creation when ticket system is disabled
            const enabledRow = await bot.database.get(
                'SELECT tickets_enabled FROM guild_configs WHERE guild_id = ?',
                [interaction.guild.id]
            );
            if (enabledRow && !enabledRow.tickets_enabled) {
                return interaction.reply({
                    content: '❌ The ticket system is currently disabled. Please contact a server administrator.',
                    ephemeral: true
                });
            }

            const userId = interaction.user.id;
            const guildId = interaction.guild.id;
            const cooldownKey = `${guildId}_${userId}`;
            
            // Check rate limit (cooldown)
            const lastCreation = ticketCooldowns.get(cooldownKey);
            const now = Date.now();
            if (lastCreation && (now - lastCreation) < TICKET_COOLDOWN_MS) {
                const remaining = Math.ceil((TICKET_COOLDOWN_MS - (now - lastCreation)) / 1000);
                return interaction.reply({ 
                    content: `⏳ Please wait ${remaining} seconds before creating another ticket.`, 
                    ephemeral: true 
                });
            }
            
            // Check max open tickets per user
            const openTickets = await bot.database.get(
                `SELECT COUNT(*) as count FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`,
                [guildId, userId]
            ).catch(() => ({ count: 0 }));
            
            if (openTickets.count >= MAX_OPEN_TICKETS_PER_USER) {
                return interaction.reply({ 
                    content: `❌ You already have ${openTickets.count} open ticket(s). Please close an existing ticket before creating a new one.`, 
                    ephemeral: true 
                });
            }
            
            // Check guild-wide max from config
            if (ticketConfig?.max_tickets_per_user) {
                if (openTickets.count >= ticketConfig.max_tickets_per_user) {
                    return interaction.reply({ 
                        content: `❌ You have reached the maximum number of open tickets (${ticketConfig.max_tickets_per_user}).`, 
                        ephemeral: true 
                    });
                }
            }
            
            // Set cooldown BEFORE creation to prevent race condition
            ticketCooldowns.set(cooldownKey, now);
            
            // Clean up old cooldown entries periodically (every 100 creates)
            if (ticketCooldowns.size > 1000) {
                const cutoff = now - TICKET_COOLDOWN_MS;
                for (const [key, time] of ticketCooldowns) {
                    if (time < cutoff) ticketCooldowns.delete(key);
                }
            }
            
            const reason = interaction.options.getString('reason') || 'No reason provided';
            return bot.ticketSystem.handleCreate(interaction, reason);
        }

        // ============ CLOSE ============
        if (sub === 'close') {
            if (!isTicketChannel) {
                return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            }
            const reason = interaction.options.getString('reason') || '';
            return bot.ticketSystem.handleClose(interaction, reason);
        }

        // ============ SETUP (Admin only) ============
        if (sub === 'setup') {
            if (!isAdmin) {
                return interaction.reply({ content: '❌ Only administrators can configure tickets.', ephemeral: true });
            }

            // Block setup when ticket system is disabled in dashboard
            const setupEnabledRow = await bot.database.get(
                'SELECT tickets_enabled FROM guild_configs WHERE guild_id = ?',
                [interaction.guild.id]
            );
            if (setupEnabledRow && !setupEnabledRow.tickets_enabled) {
                return interaction.reply({
                    content: '❌ The ticket system is currently disabled in the dashboard. Enable it first before running setup.',
                    ephemeral: true
                });
            }
            
            const channel = interaction.options.getChannel('channel');
            const staffRole = interaction.options.getRole('staff-role');
            const adminRole = interaction.options.getRole('admin-role');
            const category = interaction.options.getChannel('category');
            
            return bot.ticketSystem.handleSetup(interaction, {
                channel,
                staffRole,
                adminRole,
                category
            });
        }

        // ============ STAFF-ONLY COMMANDS ============
        const staffCommands = ['add', 'remove', 'claim', 'transfer', 'priority', 'tag', 'transcript', 'stats'];
        
        if (staffCommands.includes(sub)) {
            // Stats can be used outside ticket channel
            if (sub !== 'stats' && !isTicketChannel) {
                return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            }
            
            if (!isStaff && sub !== 'stats') {
                return interaction.reply({ content: '❌ Only staff members can use this command.', ephemeral: true });
            }
        }

        // ============ ADD USER ============
        if (sub === 'add') {
            const user = interaction.options.getUser('user');
            try {
                await interaction.channel.permissionOverwrites.edit(user, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                
                await interaction.reply({ content: `✅ Added ${user} to this ticket.` });
                await interaction.channel.send({ content: `👋 ${user} has been added to this ticket.` });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to add user.', ephemeral: true });
            }
        }

        // ============ REMOVE USER ============
        if (sub === 'remove') {
            const user = interaction.options.getUser('user');
            try {
                await interaction.channel.permissionOverwrites.delete(user);
                await interaction.reply({ content: `✅ Removed ${user} from this ticket.` });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to remove user.', ephemeral: true });
            }
        }

        // ============ CLAIM ============
        if (sub === 'claim') {
            try {
                await bot.database.run(
                    `UPDATE tickets SET assigned_to = ? WHERE channel_id = ?`,
                    [interaction.user.id, interaction.channel.id]
                );
                
                const embed = new EmbedBuilder()
                    .setColor('#00d4ff')
                    .setDescription(`📌 This ticket has been claimed by ${interaction.user}`)
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to claim ticket.', ephemeral: true });
            }
        }

        // ============ TRANSFER ============
        if (sub === 'transfer') {
            const staff = interaction.options.getUser('staff');
            try {
                await bot.database.run(
                    `UPDATE tickets SET assigned_to = ? WHERE channel_id = ?`,
                    [staff.id, interaction.channel.id]
                );
                
                await interaction.channel.permissionOverwrites.edit(staff, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
                
                await interaction.reply({ content: `✅ Ticket transferred to ${staff}` });
                await interaction.channel.send({ content: `📌 ${staff}, this ticket has been transferred to you!` });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to transfer ticket.', ephemeral: true });
            }
        }

        // ============ PRIORITY ============
        if (sub === 'priority') {
            const priority = interaction.options.getString('level');
            const emoji = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🟢' }[priority];
            
            try {
                await bot.database.run(
                    `UPDATE tickets SET priority = ? WHERE channel_id = ?`,
                    [priority, interaction.channel.id]
                );
                
                await interaction.channel.setTopic(`${emoji} Priority: ${priority.toUpperCase()}`);
                await interaction.reply({ content: `${emoji} Ticket priority set to **${priority.toUpperCase()}**` });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to set priority.', ephemeral: true });
            }
        }

        // ============ TAG ============
        if (sub === 'tag') {
            const tag = interaction.options.getString('type');
            const emoji = { technical: '🛠️', billing: '💰', support: '🤝', report: '⚠️', suggestion: '💡' }[tag];
            
            try {
                await bot.database.run(
                    `UPDATE tickets SET tag = ? WHERE channel_id = ?`,
                    [tag, interaction.channel.id]
                );
                
                await interaction.reply({ content: `${emoji} Ticket tagged as **${tag.toUpperCase()}**` });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to add tag.', ephemeral: true });
            }
        }

        // ============ TRANSCRIPT ============
        if (sub === 'transcript') {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                const sortedMessages = [...messages.values()].reverse();
                
                let transcript = `TICKET TRANSCRIPT - ${interaction.channel.name}\n`;
                transcript += `Generated: ${new Date().toLocaleString()}\n`;
                transcript += `Generated by: ${interaction.user.tag}\n`;
                transcript += `${'='.repeat(60)}\n\n`;
                
                for (const msg of sortedMessages) {
                    const time = msg.createdAt.toLocaleString();
                    transcript += `[${time}] ${msg.author.tag}: ${msg.content || '[No text content]'}\n`;
                    if (msg.embeds.length > 0) {
                        transcript += `  [Embed: ${msg.embeds[0].title || 'No title'}]\n`;
                    }
                    if (msg.attachments.size > 0) {
                        transcript += `  [Attachments: ${msg.attachments.map(a => a.name).join(', ')}]\n`;
                    }
                    transcript += '\n';
                }
                
                // Save to database
                await bot.database.run(`
                    INSERT INTO ticket_transcripts (ticket_id, channel_id, content, created_by, created_at)
                    VALUES ((SELECT id FROM tickets WHERE channel_id = ?), ?, ?, ?, datetime('now'))
                `, [interaction.channel.id, interaction.channel.id, transcript, interaction.user.id]);
                
                const buffer = Buffer.from(transcript, 'utf-8');
                
                await interaction.editReply({
                    content: '✅ Transcript generated',
                    files: [{ name: `transcript-${interaction.channel.name}.txt`, attachment: buffer }]
                });
            } catch (error) {
                console.error('Transcript error:', error);
                await interaction.editReply({ content: '❌ Failed to generate transcript.' });
            }
        }

        // ============ STATS ============
        if (sub === 'stats') {
            try {
                const stats = await bot.database.get(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
                        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                        AVG(CASE WHEN closed_at IS NOT NULL 
                            THEN (julianday(closed_at) - julianday(created_at)) * 24 
                            ELSE NULL END) as avg_hours
                    FROM tickets WHERE guild_id = ?
                `, [interaction.guild.id]);
                
                // Get today's tickets
                const todayStats = await bot.database.get(`
                    SELECT COUNT(*) as today
                    FROM tickets 
                    WHERE guild_id = ? AND date(created_at) = date('now')
                `, [interaction.guild.id]);
                
                const embed = new EmbedBuilder()
                    .setTitle('🎫 Ticket Statistics')
                    .setColor('#5865F2')
                    .addFields(
                        { name: '📊 Total Tickets', value: `${stats?.total || 0}`, inline: true },
                        { name: '📬 Open', value: `${stats?.open || 0}`, inline: true },
                        { name: '📪 Closed', value: `${stats?.closed || 0}`, inline: true },
                        { name: '📅 Created Today', value: `${todayStats?.today || 0}`, inline: true },
                        { name: '⏱️ Avg Resolution', value: stats?.avg_hours ? `${Math.round(stats.avg_hours)}h` : 'N/A', inline: true },
                        { name: '📈 Close Rate', value: stats?.total ? `${Math.round((stats.closed / stats.total) * 100)}%` : 'N/A', inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: `Requested by ${interaction.user.tag}` });
                
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to load statistics.', ephemeral: true });
            }
        }
    }
};
