const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * @deprecated Use /ticket instead (unified command)
 * - /ticket priority
 * - /ticket tag
 * - /ticket transcript  
 * - /ticket assign → /ticket transfer
 * - /ticket stats
 */
module.exports = {
    deprecated: true,
    newCommand: '/ticket (unified)',
    data: new SlashCommandBuilder()
        .setName('ticket-manage')
        .setDescription('Advanced ticket management commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName('priority')
                .setDescription('Set ticket priority')
                .addStringOption(option =>
                    option.setName('priority')
                        .setDescription('Priority level')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔴 Urgent', value: 'urgent' },
                            { name: '🟠 High', value: 'high' },
                            { name: '🟡 Normal', value: 'normal' },
                            { name: '🟢 Low', value: 'low' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('tag')
                .setDescription('Add a tag to this ticket')
                .addStringOption(option =>
                    option.setName('tag')
                        .setDescription('Tag name')
                        .setRequired(true)
                        .addChoices(
                            { name: '🛠️ Technical', value: 'technical' },
                            { name: '💰 Billing', value: 'billing' },
                            { name: '🤝 Support', value: 'support' },
                            { name: '⚠️ Report', value: 'report' },
                            { name: '💡 Suggestion', value: 'suggestion' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transcript')
                .setDescription('Generate a transcript of this ticket'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('assign')
                .setDescription('Assign a staff member to this ticket')
                .addUserOption(option =>
                    option.setName('staff')
                        .setDescription('Staff member to assign')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View ticket statistics')),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const subcommand = interaction.options.getSubcommand();

        // Check if this is a ticket channel
        const isTicket = interaction.channel.name.startsWith('ticket-');
        
        if (['priority', 'tag', 'transcript', 'assign'].includes(subcommand) && !isTicket) {
            return await interaction.reply({
                content: '❌ This command can only be used in ticket channels',
                ephemeral: true
            });
        }

        if (subcommand === 'priority') {
            const priority = interaction.options.getString('priority');
            const emoji = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🟢' }[priority];

            try {
                await bot.database.run(`
                    UPDATE tickets SET priority = ? WHERE channel_id = ?
                `, [priority, interaction.channel.id]);

                await interaction.channel.setTopic(`${emoji} Priority: ${priority.toUpperCase()}`);

                await interaction.reply({
                    content: `${emoji} Ticket priority set to **${priority.toUpperCase()}**`,
                    ephemeral: false
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to set priority',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'tag') {
            const tag = interaction.options.getString('tag');
            const emoji = { technical: '🛠️', billing: '💰', support: '🤝', report: '⚠️', suggestion: '💡' }[tag];

            try {
                await bot.database.run(`
                    UPDATE tickets SET tag = ? WHERE channel_id = ?
                `, [tag, interaction.channel.id]);

                await interaction.reply({
                    content: `${emoji} Ticket tagged as **${tag.toUpperCase()}**`,
                    ephemeral: false
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to add tag',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'transcript') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                const sortedMessages = [...messages.values()].reverse();

                let transcript = `TICKET TRANSCRIPT - ${interaction.channel.name}\n`;
                transcript += `Generated: ${new Date().toLocaleString()}\n`;
                transcript += `${'='.repeat(60)}\n\n`;

                for (const msg of sortedMessages) {
                    const time = msg.createdAt.toLocaleString();
                    transcript += `[${time}] ${msg.author.tag}: ${msg.content}\n`;
                    if (msg.embeds.length > 0) {
                        transcript += `  [Embed: ${msg.embeds[0].title || 'No title'}]\n`;
                    }
                    transcript += '\n';
                }

                // Save to database
                await bot.database.run(`
                    INSERT INTO ticket_transcripts (ticket_id, channel_id, content, created_at)
                    VALUES ((SELECT id FROM tickets WHERE channel_id = ?), ?, ?, datetime('now'))
                `, [interaction.channel.id, interaction.channel.id, transcript]);

                // Create file
                const buffer = Buffer.from(transcript, 'utf-8');
                const attachment = { name: `transcript-${interaction.channel.name}.txt`, attachment: buffer };

                await interaction.editReply({
                    content: '✅ Transcript generated',
                    files: [attachment]
                });
            } catch (error) {
                await interaction.editReply({
                    content: '❌ Failed to generate transcript'
                });
            }
        } else if (subcommand === 'assign') {
            const staff = interaction.options.getUser('staff');

            try {
                await bot.database.run(`
                    UPDATE tickets SET assigned_to = ? WHERE channel_id = ?
                `, [staff.id, interaction.channel.id]);

                await interaction.channel.permissionOverwrites.edit(staff, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });

                await interaction.reply({
                    content: `✅ Ticket assigned to ${staff}`,
                    ephemeral: false
                });

                await interaction.channel.send({
                    content: `📌 ${staff}, you've been assigned to this ticket!`
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to assign staff member',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'stats') {
            try {
                const stats = await bot.database.get(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
                        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                        AVG(CASE WHEN closed_at IS NOT NULL 
                            THEN (julianday(closed_at) - julianday(created_at)) * 24 
                            ELSE NULL END) as avg_resolution_hours
                    FROM tickets
                    WHERE guild_id = ?
                `, [interaction.guild.id]);

                const embed = new EmbedBuilder()
                    .setTitle('🎫 Ticket Statistics')
                    .setColor('#5865F2')
                    .addFields(
                        { name: 'Total Tickets', value: `${stats.total || 0}`, inline: true },
                        { name: 'Open Tickets', value: `${stats.open || 0}`, inline: true },
                        { name: 'Closed Tickets', value: `${stats.closed || 0}`, inline: true },
                        { name: 'Avg Resolution Time', value: stats.avg_resolution_hours ? `${Math.round(stats.avg_resolution_hours)}h` : 'N/A', inline: true }
                    )
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to retrieve statistics',
                    ephemeral: true
                });
            }
        }
    }
};
