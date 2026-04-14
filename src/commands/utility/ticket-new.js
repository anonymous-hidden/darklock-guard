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
                .addChannelTypes(ChannelType.GuildCategory)))

        // REOPEN - Staff only
        .addSubcommand(sub => sub
            .setName('reopen')
            .setDescription('Reopen a closed ticket')
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for reopening')
                .setRequired(false)))

        // NOTE - Staff only (private internal note)
        .addSubcommand(sub => sub
            .setName('note')
            .setDescription('Add a private staff note to this ticket')
            .addStringOption(opt => opt
                .setName('text')
                .setDescription('Note content')
                .setRequired(true)))

        // BLACKLIST - Admin only
        .addSubcommand(sub => sub
            .setName('blacklist')
            .setDescription('Manage the ticket blacklist')
            .addStringOption(opt => opt
                .setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Add user', value: 'add' },
                    { name: 'Remove user', value: 'remove' },
                    { name: 'Check user', value: 'check' }
                ))
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('Target user')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason (required for add action)')
                .setRequired(false)))

        // LOCK - Staff only
        .addSubcommand(sub => sub
            .setName('lock')
            .setDescription('Lock this ticket channel so only staff can send messages')
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for locking')
                .setRequired(false)))

        // UNLOCK - Staff only
        .addSubcommand(sub => sub
            .setName('unlock')
            .setDescription('Unlock this ticket channel to allow the user to send messages again'))

        // RENAME - Staff only
        .addSubcommand(sub => sub
            .setName('rename')
            .setDescription('Rename this ticket channel')
            .addStringOption(opt => opt
                .setName('name')
                .setDescription('New channel name (no spaces, use hyphens)')
                .setRequired(true)))

        // FLAG - Staff only (mark ticket as suspicious/escalate)
        .addSubcommand(sub => sub
            .setName('flag')
            .setDescription('Flag this ticket for review or mark its priority')
            .addStringOption(opt => opt
                .setName('level')
                .setDescription('Flag level')
                .setRequired(true)
                .addChoices(
                    { name: 'Normal', value: 'normal' },
                    { name: 'Medium', value: 'medium' },
                    { name: 'High', value: 'high' },
                    { name: 'Urgent', value: 'urgent' }
                ))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for flag')
                .setRequired(false))),

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

            // Check ticket blacklist
            try {
                const blacklisted = await bot.database.get(
                    `SELECT reason FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?`,
                    [guildId, userId]
                );
                if (blacklisted) {
                    return interaction.reply({
                        content: `🚫 You are blacklisted from creating tickets.${blacklisted.reason ? `\n**Reason:** ${blacklisted.reason}` : ''}`,
                        ephemeral: true
                    });
                }
            } catch (_) { /* table may not exist yet */ }
            
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
                transcript += `Generated by: ${interaction.user.username}\n`;
                transcript += `${'='.repeat(60)}\n\n`;
                
                for (const msg of sortedMessages) {
                    const time = msg.createdAt.toLocaleString();
                    transcript += `[${time}] ${msg.author.username}: ${msg.content || '[No text content]'}\n`;
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
                    .setFooter({ text: `Requested by ${interaction.user.username}` });
                
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: '❌ Failed to load statistics.', ephemeral: true });
            }
        }

        // ============ REOPEN ============
        if (sub === 'reopen') {
            if (!isStaff) return interaction.reply({ content: '❌ Only staff can reopen tickets.', ephemeral: true });
            if (!isTicketChannel) return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            try {
                const ticket = await bot.database.get(
                    `SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ?`,
                    [interaction.channel.id, interaction.guild.id]
                );
                if (!ticket) return interaction.reply({ content: '❌ No ticket record found for this channel.', ephemeral: true });
                if (ticket.status === 'open') return interaction.reply({ content: '⚠️ This ticket is already open.', ephemeral: true });

                const reason = interaction.options.getString('reason') || 'No reason provided';
                await bot.database.run(
                    `UPDATE tickets SET status = 'open', updated_at = datetime('now') WHERE channel_id = ? AND guild_id = ?`,
                    [interaction.channel.id, interaction.guild.id]
                );
                // Remove [CLOSED] prefix from channel name if present
                const newName = interaction.channel.name.replace(/^\[closed\]-/, 'ticket-');
                await interaction.channel.setName(newName).catch(() => {});
                // Restore user permissions
                if (ticket.user_id) {
                    await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
                        ViewChannel: true, SendMessages: true, ReadMessageHistory: true
                    }).catch(() => {});
                }
                const embed = new EmbedBuilder()
                    .setTitle('🔓 Ticket Reopened')
                    .setColor('#57F287')
                    .setDescription(`Ticket reopened by ${interaction.user}.`)
                    .addFields({ name: 'Reason', value: reason })
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } catch (error) {
                console.error('[ticket-new] reopen error:', error);
                await interaction.reply({ content: '❌ Failed to reopen ticket.', ephemeral: true });
            }
        }

        // ============ NOTE ============
        if (sub === 'note') {
            if (!isStaff) return interaction.reply({ content: '❌ Only staff can add notes.', ephemeral: true });
            if (!isTicketChannel) return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            try {
                const text = interaction.options.getString('text');
                // Ensure ticket_notes table exists (graceful)
                await bot.database.run(`CREATE TABLE IF NOT EXISTS ticket_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    added_by_id TEXT NOT NULL,
                    added_by_tag TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now'))
                )`).catch(() => {});
                await bot.database.run(
                    `INSERT INTO ticket_notes (channel_id, guild_id, content, added_by_id, added_by_tag) VALUES (?, ?, ?, ?, ?)`,
                    [interaction.channel.id, interaction.guild.id, text, interaction.user.id, interaction.user.username]
                );
                const embed = new EmbedBuilder()
                    .setTitle('📝 Staff Note Added')
                    .setColor('#FEE75C')
                    .setDescription(text)
                    .setFooter({ text: `Added by ${interaction.user.username}` })
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                console.error('[ticket-new] note error:', error);
                await interaction.reply({ content: '❌ Failed to add note.', ephemeral: true });
            }
        }

        // ============ BLACKLIST ============
        if (sub === 'blacklist') {
            if (!isAdmin) return interaction.reply({ content: '❌ Only administrators can manage the ticket blacklist.', ephemeral: true });
            try {
                const action = interaction.options.getString('action');
                const target = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const guildId = interaction.guild.id;

                // Ensure table exists
                await bot.database.run(`CREATE TABLE IF NOT EXISTS ticket_blacklist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    reason TEXT,
                    added_by TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(guild_id, user_id)
                )`).catch(() => {});

                if (action === 'add') {
                    await bot.database.run(
                        `INSERT OR REPLACE INTO ticket_blacklist (guild_id, user_id, reason, added_by) VALUES (?, ?, ?, ?)`,
                        [guildId, target.id, reason, interaction.user.username]
                    );
                    const embed = new EmbedBuilder()
                        .setTitle('🚫 User Blacklisted from Tickets')
                        .setColor('#ED4245')
                        .addFields(
                            { name: 'User', value: `${target.username} (${target.id})`, inline: true },
                            { name: 'Reason', value: reason, inline: true }
                        )
                        .setFooter({ text: `By ${interaction.user.username}` })
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed] });

                } else if (action === 'remove') {
                    const result = await bot.database.run(
                        `DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?`,
                        [guildId, target.id]
                    );
                    const removed = result?.changes > 0;
                    await interaction.reply({ content: removed ? `✅ ${target.username} removed from the ticket blacklist.` : `⚠️ ${target.username} was not on the blacklist.`, ephemeral: true });

                } else if (action === 'check') {
                    const row = await bot.database.get(
                        `SELECT * FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?`,
                        [guildId, target.id]
                    );
                    const embed = new EmbedBuilder()
                        .setTitle('🔍 Blacklist Check')
                        .setColor(row ? '#ED4245' : '#57F287')
                        .addFields(
                            { name: 'User', value: `${target.username} (${target.id})` },
                            { name: 'Blacklisted?', value: row ? '🚫 Yes' : '✅ No' },
                            ...(row ? [
                                { name: 'Reason', value: row.reason || 'None', inline: true },
                                { name: 'Added By', value: row.added_by || 'Unknown', inline: true },
                                { name: 'Date', value: row.created_at || 'Unknown', inline: true }
                            ] : [])
                        )
                        .setTimestamp();
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                }
            } catch (error) {
                console.error('[ticket-new] blacklist error:', error);
                await interaction.reply({ content: '❌ Failed to manage blacklist.', ephemeral: true });
            }
        }

        // ============ LOCK ============
        if (sub === 'lock') {
            if (!isStaff) return interaction.reply({ content: '❌ Only staff can lock tickets.', ephemeral: true });
            if (!isTicketChannel) return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            try {
                const reason = interaction.options.getString('reason') || 'No reason provided';
                const ticket = await bot.database.get(
                    `SELECT user_id FROM tickets WHERE channel_id = ? AND guild_id = ?`,
                    [interaction.channel.id, interaction.guild.id]
                );
                // Remove SendMessages from @everyone in this channel
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
                // Staff keep their SendMessages via role override
                if (ticket?.user_id) {
                    await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }).catch(() => {});
                }
                await bot.database.run(
                    `UPDATE tickets SET locked = 1, updated_at = datetime('now') WHERE channel_id = ? AND guild_id = ?`,
                    [interaction.channel.id, interaction.guild.id]
                ).catch(() => {});
                const embed = new EmbedBuilder()
                    .setTitle('🔒 Ticket Locked')
                    .setColor('#ED4245')
                    .setDescription(`This ticket has been locked by ${interaction.user}. Only staff can send messages.`)
                    .addFields({ name: 'Reason', value: reason })
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } catch (error) {
                console.error('[ticket-new] lock error:', error);
                await interaction.reply({ content: '❌ Failed to lock ticket.', ephemeral: true });
            }
        }

        // ============ UNLOCK ============
        if (sub === 'unlock') {
            if (!isStaff) return interaction.reply({ content: '❌ Only staff can unlock tickets.', ephemeral: true });
            if (!isTicketChannel) return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            try {
                const ticket = await bot.database.get(
                    `SELECT user_id FROM tickets WHERE channel_id = ? AND guild_id = ?`,
                    [interaction.channel.id, interaction.guild.id]
                );
                await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
                if (ticket?.user_id) {
                    await interaction.channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: true }).catch(() => {});
                }
                await bot.database.run(
                    `UPDATE tickets SET locked = 0, updated_at = datetime('now') WHERE channel_id = ? AND guild_id = ?`,
                    [interaction.channel.id, interaction.guild.id]
                ).catch(() => {});
                const embed = new EmbedBuilder()
                    .setTitle('🔓 Ticket Unlocked')
                    .setColor('#57F287')
                    .setDescription(`This ticket has been unlocked by ${interaction.user}.`)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } catch (error) {
                console.error('[ticket-new] unlock error:', error);
                await interaction.reply({ content: '❌ Failed to unlock ticket.', ephemeral: true });
            }
        }

        // ============ RENAME ============
        if (sub === 'rename') {
            if (!isStaff) return interaction.reply({ content: '❌ Only staff can rename ticket channels.', ephemeral: true });
            if (!isTicketChannel) return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            try {
                const name = interaction.options.getString('name').toLowerCase().replace(/[^a-z0-9-]/g, '-');
                const fullName = `ticket-${name}`;
                await interaction.channel.setName(fullName);
                await interaction.reply({ content: `✅ Channel renamed to **${fullName}**.`, ephemeral: true });
            } catch (error) {
                console.error('[ticket-new] rename error:', error);
                await interaction.reply({ content: '❌ Failed to rename channel.', ephemeral: true });
            }
        }

        // ============ FLAG ============
        if (sub === 'flag') {
            if (!isStaff) return interaction.reply({ content: '❌ Only staff can flag tickets.', ephemeral: true });
            if (!isTicketChannel) return interaction.reply({ content: '❌ This command can only be used in ticket channels.', ephemeral: true });
            try {
                const level = interaction.options.getString('level');
                const reason = interaction.options.getString('reason') || 'No reason provided';
                await bot.database.run(
                    `UPDATE tickets SET priority = ?, updated_at = datetime('now') WHERE channel_id = ? AND guild_id = ?`,
                    [level, interaction.channel.id, interaction.guild.id]
                ).catch(() => {});
                const colorMap = { normal: '#5865F2', medium: '#FEE75C', high: '#FF8C00', urgent: '#ED4245' };
                const labelMap = { normal: '⚪ Normal', medium: '🟡 Medium', high: '🟠 High', urgent: '🔴 Urgent' };
                const embed = new EmbedBuilder()
                    .setTitle('🚩 Ticket Flagged')
                    .setColor(colorMap[level] || '#5865F2')
                    .addFields(
                        { name: 'Priority Set To', value: labelMap[level] || level, inline: true },
                        { name: 'Reason', value: reason, inline: true }
                    )
                    .setFooter({ text: `Flagged by ${interaction.user.username}` })
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } catch (error) {
                console.error('[ticket-new] flag error:', error);
                await interaction.reply({ content: '❌ Failed to flag ticket.', ephemeral: true });
            }
        }
    }
};
