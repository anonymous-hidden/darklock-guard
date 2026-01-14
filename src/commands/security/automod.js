/**
 * /automod - Unified Auto-Moderation Command
 * Consolidates: anti-spam, anti-raid, anti-links, anti-phishing, emojispam
 * 
 * Structure:
 * /automod status                    → View all automod settings
 * /automod spam on|off|config        → Spam detection
 * /automod raid on|off|config        → Raid detection
 * /automod links on|off|config       → Link detection
 * /automod phishing on|off|scan      → Phishing detection
 * /automod emoji on|off|config       → Emoji spam detection
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { 
    spamHandlers, 
    raidHandlers, 
    linksHandlers, 
    phishingHandlers, 
    emojiHandlers,
    getAutomodStatus 
} = require('../handlers/automod');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('🤖 Unified auto-moderation settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        
        // ============ STATUS ============
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('View all automod settings'))
        
        // ============ SPAM ============
        .addSubcommandGroup(group => group
            .setName('spam')
            .setDescription('Anti-spam protection')
            .addSubcommand(sub => sub
                .setName('on')
                .setDescription('Enable anti-spam protection'))
            .addSubcommand(sub => sub
                .setName('off')
                .setDescription('Disable anti-spam protection'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure spam thresholds')
                .addStringOption(opt => opt
                    .setName('bypass_channels')
                    .setDescription('Channel IDs to bypass (comma-separated)'))
                .addIntegerOption(opt => opt
                    .setName('flood_threshold')
                    .setDescription('Messages in 10s to trigger (default: 8)')
                    .setMinValue(3)
                    .setMaxValue(50))
                .addIntegerOption(opt => opt
                    .setName('duplicate_threshold')
                    .setDescription('Repeated messages to trigger (default: 3)')
                    .setMinValue(2)
                    .setMaxValue(20))
                .addIntegerOption(opt => opt
                    .setName('mention_threshold')
                    .setDescription('Mentions to trigger (default: 5)')
                    .setMinValue(2)
                    .setMaxValue(50))))
        
        // ============ RAID ============
        .addSubcommandGroup(group => group
            .setName('raid')
            .setDescription('Anti-raid protection')
            .addSubcommand(sub => sub
                .setName('on')
                .setDescription('Enable anti-raid protection'))
            .addSubcommand(sub => sub
                .setName('off')
                .setDescription('Disable anti-raid protection'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure raid thresholds')
                .addIntegerOption(opt => opt
                    .setName('threshold')
                    .setDescription('Joins in 60s to trigger (default: 10)')
                    .setMinValue(3)
                    .setMaxValue(100))
                .addIntegerOption(opt => opt
                    .setName('lockdown_duration')
                    .setDescription('Auto-unlock after X seconds (default: 600)')
                    .setMinValue(60)
                    .setMaxValue(86400))))
        
        // ============ LINKS ============
        .addSubcommandGroup(group => group
            .setName('links')
            .setDescription('Anti-links protection')
            .addSubcommand(sub => sub
                .setName('on')
                .setDescription('Enable link filtering'))
            .addSubcommand(sub => sub
                .setName('off')
                .setDescription('Disable link filtering'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure link settings')
                .addStringOption(opt => opt
                    .setName('allow_domains')
                    .setDescription('Allowed domains (comma-separated)'))
                .addStringOption(opt => opt
                    .setName('block_domains')
                    .setDescription('Blocked domains (comma-separated)'))
                .addBooleanOption(opt => opt
                    .setName('safe_browsing')
                    .setDescription('Enable Google Safe Browsing'))))
        
        // ============ PHISHING ============
        .addSubcommandGroup(group => group
            .setName('phishing')
            .setDescription('Anti-phishing protection')
            .addSubcommand(sub => sub
                .setName('on')
                .setDescription('Enable phishing detection'))
            .addSubcommand(sub => sub
                .setName('off')
                .setDescription('Disable phishing detection'))
            .addSubcommand(sub => sub
                .setName('scan')
                .setDescription('Scan for phishing links')
                .addStringOption(opt => opt
                    .setName('url')
                    .setDescription('Specific URL to scan'))
                .addIntegerOption(opt => opt
                    .setName('limit')
                    .setDescription('Messages to scan (default: 50)')
                    .setMinValue(10)
                    .setMaxValue(100))))
        
        // ============ EMOJI ============
        .addSubcommandGroup(group => group
            .setName('emoji')
            .setDescription('Emoji spam detection')
            .addSubcommand(sub => sub
                .setName('on')
                .setDescription('Enable emoji spam detection')
                .addIntegerOption(opt => opt
                    .setName('max_emojis')
                    .setDescription('Max emojis per message (default: 10)')
                    .setMinValue(3)
                    .setMaxValue(100))
                .addStringOption(opt => opt
                    .setName('action')
                    .setDescription('Action to take')
                    .addChoices(
                        { name: 'Delete message', value: 'delete' },
                        { name: 'Warn user', value: 'warn' },
                        { name: 'Delete and warn', value: 'delete_warn' },
                        { name: 'Timeout user', value: 'timeout' }
                    )))
            .addSubcommand(sub => sub
                .setName('off')
                .setDescription('Disable emoji spam detection'))
            .addSubcommand(sub => sub
                .setName('config')
                .setDescription('Configure emoji settings')
                .addIntegerOption(opt => opt
                    .setName('max_emojis')
                    .setDescription('Max emojis per message')
                    .setMinValue(3)
                    .setMaxValue(100))
                .addIntegerOption(opt => opt
                    .setName('max_stickers')
                    .setDescription('Max stickers per message')
                    .setMinValue(1)
                    .setMaxValue(10))
                .addStringOption(opt => opt
                    .setName('action')
                    .setDescription('Action to take')
                    .addChoices(
                        { name: 'Delete message', value: 'delete' },
                        { name: 'Warn user', value: 'warn' },
                        { name: 'Delete and warn', value: 'delete_warn' },
                        { name: 'Timeout user', value: 'timeout' }
                    )))),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        try {
            // Status (no group)
            if (!group && sub === 'status') {
                return getAutomodStatus(interaction, bot);
            }

            // ============ SPAM ============
            if (group === 'spam') {
                switch (sub) {
                    case 'on':
                        return spamHandlers.enable(interaction, bot);
                    case 'off':
                        return spamHandlers.disable(interaction, bot);
                    case 'config':
                        return spamHandlers.config(interaction, bot, {
                            bypass_channels: interaction.options.getString('bypass_channels'),
                            flood_mid: interaction.options.getInteger('flood_threshold'),
                            duplicate_mid: interaction.options.getInteger('duplicate_threshold'),
                            mention_threshold: interaction.options.getInteger('mention_threshold')
                        });
                }
            }

            // ============ RAID ============
            if (group === 'raid') {
                switch (sub) {
                    case 'on':
                        return raidHandlers.enable(interaction, bot);
                    case 'off':
                        return raidHandlers.disable(interaction, bot);
                    case 'config':
                        const duration = interaction.options.getInteger('lockdown_duration');
                        return raidHandlers.config(interaction, bot, {
                            threshold: interaction.options.getInteger('threshold'),
                            lockdown_duration: duration ? duration * 1000 : null // Convert to ms
                        });
                }
            }

            // ============ LINKS ============
            if (group === 'links') {
                switch (sub) {
                    case 'on':
                        return linksHandlers.enable(interaction, bot);
                    case 'off':
                        return linksHandlers.disable(interaction, bot);
                    case 'config':
                        return linksHandlers.config(interaction, bot, {
                            allow_domains: interaction.options.getString('allow_domains'),
                            block_domains: interaction.options.getString('block_domains'),
                            safe_browsing: interaction.options.getBoolean('safe_browsing')
                        });
                }
            }

            // ============ PHISHING ============
            if (group === 'phishing') {
                switch (sub) {
                    case 'on':
                        return phishingHandlers.enable(interaction, bot);
                    case 'off':
                        return phishingHandlers.disable(interaction, bot);
                    case 'scan':
                        return phishingHandlers.scan(
                            interaction, 
                            bot, 
                            interaction.options.getString('url'),
                            interaction.options.getInteger('limit') || 50
                        );
                }
            }

            // ============ EMOJI ============
            if (group === 'emoji') {
                switch (sub) {
                    case 'on':
                        return emojiHandlers.enable(interaction, bot, {
                            max_emojis: interaction.options.getInteger('max_emojis'),
                            action: interaction.options.getString('action')
                        });
                    case 'off':
                        return emojiHandlers.disable(interaction, bot);
                    case 'config':
                        return emojiHandlers.config(interaction, bot, {
                            max_emojis: interaction.options.getInteger('max_emojis'),
                            max_stickers: interaction.options.getInteger('max_stickers'),
                            action: interaction.options.getString('action')
                        });
                }
            }

        } catch (err) {
            bot.logger?.error('automod command error:', err);
            const reply = { content: '❌ Error processing command.', ephemeral: true };
            if (interaction.deferred) return interaction.editReply(reply);
            return interaction.reply(reply);
        }
    }
};
