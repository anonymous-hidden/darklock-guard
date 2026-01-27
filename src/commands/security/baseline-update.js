const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('baseline-update')
        .setDescription('Regenerate and sign the tamper-protection baseline (OWNER_ID only)'),

    async execute(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });

        const ownerId = process.env.OWNER_ID;
        if (!ownerId || interaction.user.id !== ownerId) {
            return interaction.editReply({
                content: 'Only the configured OWNER_ID can run this command.',
                ephemeral: true
            });
        }

        if (!bot || !bot.tamperProtection || typeof bot.tamperProtection.regenerateBaseline !== 'function') {
            return interaction.editReply({
                content: 'Tamper protection system is not initialized.',
                ephemeral: true
            });
        }

        try {
            const baseline = await bot.tamperProtection.regenerateBaseline(interaction.user.tag || interaction.user.id);

            if (bot.forensicsManager && typeof bot.forensicsManager.logAuditEvent === 'function') {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild?.id || null,
                    eventType: 'baseline_update',
                    eventCategory: 'tamper_protection',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { type: 'baseline', id: 'tamper_protection_baseline', name: 'baseline.json' },
                    changes: { fileCount: baseline?.fileCount || 0, generated: baseline?.generated || null },
                    canReplay: false,
                    timestamp: new Date().toISOString()
                });
            }

            await interaction.editReply({
                content: `Baseline regenerated and signed (${baseline?.fileCount || 0} entries).`,
                ephemeral: true
            });
        } catch (error) {
            await interaction.editReply({
                content: `Failed to regenerate baseline: ${error.message || error}`,
                ephemeral: true
            });
        }
    }
};
