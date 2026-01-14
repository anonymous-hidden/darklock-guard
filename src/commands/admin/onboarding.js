const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getDeprecationNotice } = require('../handlers');

// DEPRECATED: Use /setup onboarding instead
module.exports = {
    deprecated: true,
    newCommand: '/setup onboarding',
    data: new SlashCommandBuilder()
        .setName('onboarding')
        .setDescription('⚠️ MOVED → Use /setup onboarding instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('welcome').setDescription('Enable welcome messages, disable verification'))
        .addSubcommand(sub => sub.setName('verify').setDescription('Enable verification system, disable welcome'))
        .addSubcommand(sub => sub.setName('view').setDescription('View current onboarding state'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable both welcome and verification')),

    async execute(interaction, bot) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const cfg = await bot.database.getGuildConfig(guildId);
        let welcome = cfg.welcome_enabled;
        let verify = cfg.verification_enabled;

        if (sub === 'welcome') {
            welcome = true; verify = false;
        } else if (sub === 'verify') {
            welcome = false; verify = true;
        } else if (sub === 'disable') {
            welcome = false; verify = false;
        }

        if (sub !== 'view') {
            await bot.database.run(
                `UPDATE guild_configs SET welcome_enabled = ?, verification_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
                [welcome ? 1 : 0, verify ? 1 : 0, guildId]
            );

            // Emit setting change events
            try {
                if (typeof bot.emitSettingChange === 'function') {
                    await bot.emitSettingChange(guildId, interaction.user.id, 'welcome_enabled', welcome ? 1 : 0, cfg.welcome_enabled, 'security');
                    await bot.emitSettingChange(guildId, interaction.user.id, 'verification_enabled', verify ? 1 : 0, cfg.verification_enabled, 'security');
                }
            } catch (e) {
                bot.logger?.warn && bot.logger.warn('emitSettingChange failed in admin.onboarding:', e?.message || e);
            }

            // Broadcast setting updates
            if (bot.dashboard?.broadcastToGuild) {
                bot.dashboard.broadcastToGuild(guildId, {
                    type: 'dashboard_setting_update',
                    guildId,
                    setting: 'welcome_enabled',
                    before: cfg.welcome_enabled,
                    after: welcome,
                    changedBy: interaction.user.tag
                });
                bot.dashboard.broadcastToGuild(guildId, {
                    type: 'dashboard_setting_update',
                    guildId,
                    setting: 'verification_enabled',
                    before: cfg.verification_enabled,
                    after: verify,
                    changedBy: interaction.user.tag
                });
                if (verify) {
                    bot.dashboard.broadcastToGuild(guildId, { type: 'verification_instructions', guildId });
                }
            }
        }

        await interaction.reply({
            content: `Welcome: ${welcome ? 'ON' : 'OFF'} | Verification: ${verify ? 'ON' : 'OFF'}`,
            ephemeral: true
        });
    }
};
