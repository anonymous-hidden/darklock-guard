const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getDeprecationNotice } = require('../handlers');

// DEPRECATED: Use /setup permissions instead
module.exports = {
    deprecated: true,
    newCommand: '/setup permissions',
    data: new SlashCommandBuilder()
        .setName('permissions')
        .setDescription('⚠️ MOVED → Use /setup permissions instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sc => sc
            .setName('set-group')
            .setDescription('Allow specific roles to use a command group')
            .addStringOption(o => o.setName('group').setDescription('Command group')
                .setRequired(true)
                .addChoices(
                    { name: 'admin', value: 'admin' },
                    { name: 'security', value: 'security' },
                    { name: 'moderation', value: 'moderation' },
                    { name: 'utility', value: 'utility' },
                    { name: 'analytics', value: 'analytics' },
                    { name: 'tickets', value: 'tickets' }
                ))
            .addRoleOption(o => o.setName('role1').setDescription('Allowed role 1').setRequired(true))
            .addRoleOption(o => o.setName('role2').setDescription('Allowed role 2').setRequired(false))
            .addRoleOption(o => o.setName('role3').setDescription('Allowed role 3').setRequired(false))
            .addRoleOption(o => o.setName('role4').setDescription('Allowed role 4').setRequired(false))
            .addRoleOption(o => o.setName('role5').setDescription('Allowed role 5').setRequired(false))
        )
        .addSubcommand(sc => sc
            .setName('set-command')
            .setDescription('Allow specific roles to use a command')
            .addStringOption(o => o.setName('name').setDescription('Command name (e.g., ban)').setRequired(true))
            .addRoleOption(o => o.setName('role1').setDescription('Allowed role 1').setRequired(true))
            .addRoleOption(o => o.setName('role2').setDescription('Allowed role 2').setRequired(false))
            .addRoleOption(o => o.setName('role3').setDescription('Allowed role 3').setRequired(false))
            .addRoleOption(o => o.setName('role4').setDescription('Allowed role 4').setRequired(false))
            .addRoleOption(o => o.setName('role5').setDescription('Allowed role 5').setRequired(false))
        )
        .addSubcommand(sc => sc
            .setName('list')
            .setDescription('Show current permission rules')
        )
        .addSubcommand(sc => sc
            .setName('clear')
            .setDescription('Clear permission rules')
            .addStringOption(o => o.setName('scope').setDescription('What to clear').setRequired(false)
                .addChoices(
                    { name: 'all', value: 'all' },
                    { name: 'group', value: 'group' },
                    { name: 'command', value: 'command' }
                ))
            .addStringOption(o => o.setName('name').setDescription('Group or command name (optional)').setRequired(false))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        const bot = interaction.client.bot;
        const sub = interaction.options.getSubcommand();

        if (!bot.permissionManager) {
            return interaction.editReply({ content: '❌ Permission system is not available.', ephemeral: true });
        }

        switch (sub) {
            case 'set-group':
                return this.setGroup(interaction, bot);
            case 'set-command':
                return this.setCommand(interaction, bot);
            case 'list':
                return this.list(interaction, bot);
            case 'clear':
                return this.clear(interaction, bot);
        }
    },

    async setGroup(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const group = interaction.options.getString('group');
        const roles = ['role1','role2','role3','role4','role5']
            .map(n => interaction.options.getRole(n))
            .filter(Boolean);
        const roleIds = roles.map(r => r.id);

        await bot.permissionManager.setRoles(interaction.guild.id, 'group', group, roleIds);
        return interaction.editReply({ content: `✅ Allowed roles for group \`${group}\` updated: ${roles.map(r => r.toString()).join(', ')}` });
    },

    async setCommand(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const name = interaction.options.getString('name').toLowerCase();
        const roles = ['role1','role2','role3','role4','role5']
            .map(n => interaction.options.getRole(n))
            .filter(Boolean);
        const roleIds = roles.map(r => r.id);

        // Optional: validate the command exists
        if (!bot.commands.has(name)) {
            // We'll still allow setting it in case it gets added later
        }
        await bot.permissionManager.setRoles(interaction.guild.id, 'command', name, roleIds);
        return interaction.editReply({ content: `✅ Allowed roles for command \`/${name}\` updated: ${roles.map(r => r.toString()).join(', ')}` });
    },

    async list(interaction, bot) {
        const list = await bot.permissionManager.list(interaction.guild.id);
        if (list.length === 0) {
            return interaction.editReply({ content: 'ℹ️ No custom permission rules set. All commands follow default Discord permissions.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔐 Command Permission Rules')
            .setColor(0x00aa00)
            .setDescription('Members must have at least one of the allowed roles for a rule to use matching commands.')
            .addFields(
                list.map(item => ({
                    name: `${item.scope}: ${item.name}`,
                    value: item.roles.length ? item.roles.map(id => `<@&${id}>`).join(', ') : '`(no roles)`',
                    inline: false
                }))
            );

        return interaction.editReply({ embeds: [embed], ephemeral: true });
    },

    async clear(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const scope = interaction.options.getString('scope') || 'all';
        const name = interaction.options.getString('name') || null;

        if (scope === 'all') {
            await bot.permissionManager.clear(interaction.guild.id);
            return interaction.editReply({ content: '🧹 Cleared all permission rules for this server.' });
        }

        await bot.permissionManager.clear(interaction.guild.id, scope, name);
        return interaction.editReply({ content: `🧹 Cleared ${scope} ${name ? '`' + name + '` ' : ''}rules.` });
    }
};
