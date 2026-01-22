const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getDeprecationNotice } = require('../handlers');

// DEPRECATED: Use /setup roles instead
module.exports = {
    deprecated: true,
    newCommand: '/setup roles',
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('⚠️ MOVED → Use /setup roles instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a role to be automatically assigned')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to automatically assign')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a role from auto-assignment')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Role to remove from auto-assignment')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all auto-assigned roles')),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const role = interaction.options.getRole('role');

            if (role.managed) {
                return await interaction.reply({
                    content: '❌ Cannot auto-assign managed roles (bot roles)',
                    ephemeral: true
                });
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                return await interaction.reply({
                    content: '❌ Cannot auto-assign roles higher than my highest role',
                    ephemeral: true
                });
            }

            try {
                await bot.database.run(`
                    INSERT OR IGNORE INTO autoroles (guild_id, role_id)
                    VALUES (?, ?)
                `, [interaction.guild.id, role.id]);

                await interaction.reply({
                    content: `✅ ${role} will now be automatically assigned to new members`,
                    ephemeral: false
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to add auto-role',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'remove') {
            const role = interaction.options.getRole('role');

            try {
                const result = await bot.database.run(`
                    DELETE FROM autoroles
                    WHERE guild_id = ? AND role_id = ?
                `, [interaction.guild.id, role.id]);

                if (result.changes > 0) {
                    await interaction.reply({
                        content: `✅ Removed ${role} from auto-assignment`,
                        ephemeral: false
                    });
                } else {
                    await interaction.reply({
                        content: `❌ ${role} was not set as an auto-role`,
                        ephemeral: true
                    });
                }
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to remove auto-role',
                    ephemeral: true
                });
            }
        } else if (subcommand === 'list') {
            try {
                const autoroles = await bot.database.all(`
                    SELECT role_id FROM autoroles
                    WHERE guild_id = ?
                `, [interaction.guild.id]);

                if (autoroles.length === 0) {
                    return await interaction.reply({
                        content: 'No auto-roles configured',
                        ephemeral: true
                    });
                }

                const roles = autoroles
                    .map(ar => interaction.guild.roles.cache.get(ar.role_id))
                    .filter(r => r)
                    .map(r => r.toString())
                    .join('\n');

                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Auto-Assigned Roles')
                    .setDescription(roles || 'No valid roles found')
                    .setColor('#5865F2')
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to retrieve auto-roles',
                    ephemeral: true
                });
            }
        }
    }
};
