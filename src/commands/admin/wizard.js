const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getDeprecationNotice } = require('../handlers');

// DEPRECATED: Use /setup wizard instead
module.exports = {
    deprecated: true,
    newCommand: '/setup wizard',
    data: new SlashCommandBuilder()
        .setName('wizard')
        .setDescription('⚠️ MOVED → Use /setup wizard instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start the setup wizard from the beginning'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('restart')
                .setDescription('Restart the setup wizard'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('cancel')
                .setDescription('Cancel the current setup wizard session'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check setup completion status')),

    async execute(interaction) {
        const bot = interaction.client.bot;
        
        if (!bot.setupWizard) {
            return await interaction.reply({
                content: '❌ Setup wizard is not available.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start':
                await bot.setupWizard.startSetup(interaction, false);
                break;
            
            case 'restart':
                await bot.setupWizard.startSetup(interaction, true);
                break;
            
            case 'cancel':
                await this.cancelSetup(interaction, bot);
                break;
            
            case 'status':
                await this.showSetupStatus(interaction, bot);
                break;
        }
    },

    async cancelSetup(interaction, bot) {
        const guildId = interaction.guild.id;
        
        // Clear active setup session
        if (bot.setupWizard.activeSetups.has(guildId)) {
            bot.setupWizard.activeSetups.delete(guildId);
            await interaction.reply({
                content: '✅ Setup wizard session has been cancelled. You can start a new one with `/wizard start`.',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: 'ℹ️ There is no active setup wizard session to cancel.',
                ephemeral: true
            });
        }
    },

    async showSetupStatus(interaction, bot) {
        const guildId = interaction.guild.id;
        
        try {
            const setupData = await bot.database.get(`
                SELECT * FROM setup_wizard WHERE guild_id = ?
            `, [guildId]);

            if (!setupData) {
                return await interaction.reply({
                    content: '⚠️ Setup wizard has not been completed yet. Run `/wizard start` to begin!',
                    ephemeral: true
                });
            }

            const completedAt = new Date(setupData.completed_at).toLocaleString();
            const data = JSON.parse(setupData.setup_data);

            const embed = new EmbedBuilder()
                .setTitle('✅ Setup Status')
                .setDescription('Your server setup is complete!')
                .addFields([
                    {
                        name: 'Completed At',
                        value: completedAt,
                        inline: true
                    },
                    {
                        name: 'Configured Features',
                        value: this.getConfiguredFeatures(data),
                        inline: false
                    }
                ])
                .setColor(0x00ff00);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            bot.logger.error('Error checking setup status:', error);
            await interaction.reply({
                content: '❌ Error checking setup status.',
                ephemeral: true
            });
        }
    },

    getConfiguredFeatures(data) {
        const features = [];
        if (data.security) features.push('🛡️ Security Protection');
        if (data.analytics) features.push('📊 Analytics Tracking');
        if (data.tickets) features.push('🎫 Ticket System');
        if (data.channels) features.push('📂 Channel Setup');
        
        return features.length > 0 ? features.join('\n') : 'Basic configuration';
    }
};
