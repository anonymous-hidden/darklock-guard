const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('modnote')
        .setDescription('Manage moderator notes for users')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a note to a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to add note to')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('note')
                        .setDescription('Note content')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View notes for a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to view notes for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a note by ID')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('Note ID to remove')
                        .setRequired(true))),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const user = interaction.options.getUser('user');
            const note = interaction.options.getString('note');

            try {
                await bot.database.run(`
                    INSERT INTO mod_notes (guild_id, user_id, moderator_id, note, created_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `, [interaction.guild.id, user.id, interaction.user.id, note]);

                // Broadcast to dashboard console
                if (typeof bot?.broadcastConsole === 'function') {
                    bot.broadcastConsole(interaction.guild.id, `[MODNOTE] Added note for ${user.tag} by ${interaction.user.tag}`);
                }

                // Log to bot_logs for dashboard Logs & Audit Trail page
                if (bot?.logger) {
                    await bot.logger.logSecurityEvent({
                        eventType: 'modnote_add',
                        guildId: interaction.guild.id,
                        moderatorId: interaction.user.id,
                        moderatorTag: interaction.user.tag,
                        targetId: user.id,
                        targetTag: user.tag,
                        details: { notePreview: note.substring(0, 50) + (note.length > 50 ? '...' : '') }
                    });
                }

                await interaction.reply({
                    content: `✅ Note added for ${user.tag}`,
                    ephemeral: true
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to add note',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'view') {
            const user = interaction.options.getUser('user');

            try {
                const notes = await bot.database.all(`
                    SELECT * FROM mod_notes
                    WHERE guild_id = ? AND user_id = ?
                    ORDER BY created_at DESC
                `, [interaction.guild.id, user.id]);

                if (notes.length === 0) {
                    return await interaction.reply({
                        content: `No notes found for ${user.tag}`,
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setTitle(`📝 Moderator Notes for ${user.tag}`)
                    .setColor('#5865F2')
                    .setThumbnail(user.displayAvatarURL())
                    .setTimestamp();

                for (const note of notes.slice(0, 10)) {
                    const moderator = await interaction.client.users.fetch(note.moderator_id).catch(() => null);
                    embed.addFields({
                        name: `Note #${note.id} - ${new Date(note.created_at).toLocaleDateString()}`,
                        value: `**Moderator:** ${moderator?.tag || 'Unknown'}\n**Note:** ${note.note}`,
                        inline: false
                    });
                }

                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to retrieve notes',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'remove') {
            const noteId = interaction.options.getInteger('id');

            try {
                const result = await bot.database.run(`
                    DELETE FROM mod_notes
                    WHERE id = ? AND guild_id = ?
                `, [noteId, interaction.guild.id]);

                if (result.changes > 0) {
                    await interaction.reply({
                        content: `✅ Note #${noteId} removed`,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: '❌ Note not found',
                        ephemeral: true
                    });
                }
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to remove note',
                    ephemeral: true
                });
            }
        }
    }
};
