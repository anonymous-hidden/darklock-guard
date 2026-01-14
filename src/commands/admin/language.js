const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

/**
 * Language Command
 * Sets the server language which affects all bot responses
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('language')
        .setDescription('Set the server language for bot responses')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('set')
            .setDescription('Set the server language')
            .addStringOption(opt => opt
                .setName('language')
                .setDescription('Language to use')
                .setRequired(true)
                .addChoices(
                    { name: '🇬🇧 English', value: 'en' },
                    { name: '🇪🇸 Español', value: 'es' },
                    { name: '🇩🇪 Deutsch', value: 'de' },
                    { name: '🇫🇷 Français', value: 'fr' },
                    { name: '🇧🇷 Português', value: 'pt' }
                )))
        .addSubcommand(sub => sub
            .setName('current')
            .setDescription('View current server language'))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all supported languages')),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();
        const langSystem = bot?.languageSystem || interaction.client.languageSystem;

        if (!langSystem) {
            return interaction.reply({ content: '❌ Language system is not initialized.', ephemeral: true });
        }

        switch (sub) {
            case 'set':
                return this.handleSet(interaction, langSystem);
            case 'current':
                return this.handleCurrent(interaction, langSystem);
            case 'list':
                return this.handleList(interaction, langSystem);
        }
    },

    async handleSet(interaction, langSystem) {
        const language = interaction.options.getString('language');
        const guildId = interaction.guildId;

        const result = await langSystem.setLanguage(guildId, language);

        if (!result.success) {
            return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }

        // Get language info using new method
        const info = langSystem.getLanguageInfo(language);

        const embed = new EmbedBuilder()
            .setTitle('🌐 Language Updated')
            .setColor(0x00FF00)
            .setDescription(`Server language set to ${info.flag} **${info.native}**\n\nAll bot messages will now be in ${info.name}.`)
            .setFooter({ text: 'Changes take effect immediately' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },

    async handleCurrent(interaction, langSystem) {
        const guildId = interaction.guildId;
        const language = await langSystem.getLanguage(guildId);
        const info = langSystem.getLanguageInfo(language);

        const embed = new EmbedBuilder()
            .setTitle('🌐 Current Language')
            .setColor(0x5865F2)
            .setDescription(`This server is using ${info.flag} **${info.native}** (\`${language}\`)`)
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    },

    async handleList(interaction, langSystem) {
        const languages = langSystem.getSupportedLanguages();
        const guildId = interaction.guildId;
        const currentLang = await langSystem.getLanguage(guildId);

        const embed = new EmbedBuilder()
            .setTitle('🌐 Supported Languages')
            .setColor(0x5865F2)
            .setDescription(languages.map(l => {
                const current = l.code === currentLang ? ' ✅' : '';
                return `${l.flag} **${l.native}** (${l.name}) - \`${l.code}\`${current}`;
            }).join('\n'))
            .setFooter({ text: 'Use /language set to change the server language' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};
