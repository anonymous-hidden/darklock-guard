const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getDeprecationNotice } = require('../handlers');

// DEPRECATED: Use /setup onboarding instead
module.exports = {
    deprecated: true,
    newCommand: '/setup onboarding channel|message|test',
    data: new SlashCommandBuilder()
        .setName('verified_setup')
        .setDescription('⚠️ MOVED → Use /setup onboarding channel|message|test')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('channel').setDescription('Set visible verification channel').addChannelOption(o => o.setName('channel').setDescription('Channel used for verification visibility').setRequired(true)))
        .addSubcommand(sub => sub.setName('message').setDescription('Set post-verification welcome message').addStringOption(o => o.setName('content').setDescription('Message sent after verification').setRequired(true)))
        .addSubcommand(sub => sub.setName('test').setDescription('Preview post-verification welcome message')),

    async execute(interaction, bot) {
        const cfg = await bot.database.getGuildConfig(interaction.guild.id);
        if (cfg.welcome_enabled) {
            return interaction.reply({ content: '❌ Verification System is disabled.', ephemeral: true });
        }
        if (!cfg.verification_enabled && interaction.options.getSubcommand() !== 'channel') {
            return interaction.reply({ content: 'Verification system is disabled. Use `/onboarding verify` first.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'channel') {
            const ch = interaction.options.getChannel('channel');
            await bot.database.run(`UPDATE guild_configs SET verification_channel_id = ? WHERE guild_id = ?`, [ch.id, interaction.guild.id]);
            try { if (typeof bot.emitSettingChange === 'function') { await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'verification_channel_id', ch.id, null, 'configuration'); } } catch (e) { bot.logger?.warn && bot.logger.warn('emitSettingChange failed in verified_setup.channel:', e?.message || e); }
            return interaction.reply({ content: `Verification channel set to ${ch}`, ephemeral: true });
        }
        if (sub === 'message') {
            const content = interaction.options.getString('content');
            await bot.database.run(`UPDATE guild_configs SET verified_welcome_message = ? WHERE guild_id = ?`, [content, interaction.guild.id]);
            try { if (typeof bot.emitSettingChange === 'function') { await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'verified_welcome_message', content, null, 'configuration'); } } catch (e) { bot.logger?.warn && bot.logger.warn('emitSettingChange failed in verified_setup.message:', e?.message || e); }
            return interaction.reply({ content: 'Verified welcome message updated.', ephemeral: true });
        }
        if (sub === 'test') {
            const msg = (cfg.verified_welcome_message || 'Welcome {user} to {server}!').replace('{user}', interaction.user).replace('{server}', interaction.guild.name);
            return interaction.reply({ content: msg, ephemeral: true });
        }
    }
};
