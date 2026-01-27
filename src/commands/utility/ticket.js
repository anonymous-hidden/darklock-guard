const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

/**
 * @deprecated Use /ticket instead (unified command)
 * This command is kept for backwards compatibility
 */
module.exports = {
    deprecated: true,
    newCommand: '/ticket create, /ticket close, /ticket setup',
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket system management')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Setup the ticket system')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel where the ticket panel will be posted')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)
                )
                .addRoleOption(option =>
                    option
                        .setName('staff-role')
                        .setDescription('Role that can claim and handle tickets')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('admin-role')
                        .setDescription('Higher-permission role for ticket management')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('category')
                        .setDescription('Category for ticket channels')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildCategory)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('close')
                .setDescription('Close the current ticket')
                .addStringOption(option =>
                    option
                        .setName('reason')
                        .setDescription('Optional reason for closing')
                        .setRequired(false)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        // ticketSystem is set on client directly (alias for ticketManager)
        const ticketSystem = interaction.client.ticketSystem || interaction.client.bot?.ticketSystem;

        if (!ticketSystem) {
            return interaction.reply({ content: '❌ Ticket system is not available.', ephemeral: true });
        }

        if (subcommand === 'setup') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Only administrators can run setup.', ephemeral: true });
            }

            const channel = interaction.options.getChannel('channel');
            const staffRole = interaction.options.getRole('staff-role');
            const adminRole = interaction.options.getRole('admin-role');
            const category = interaction.options.getChannel('category');

            return ticketSystem.handleSetup(interaction, {
                channel,
                staffRole,
                adminRole,
                category
            });
        }

        if (subcommand === 'close') {
            const reason = interaction.options.getString('reason') || '';
            return ticketSystem.handleClose(interaction, reason);
        }
    }
};
