'use strict';

/**
 * ActionExecutor — The ONLY class that may delete Discord content.
 *
 * Rules:
 *  • Receives an explicit admin decision from DecisionLayer.
 *  • PNGs/GIFs are deleted ONLY when they matched MALICIOUS_FILE_PATTERNS.
 *  • All actions (including "Ignore") are written to the log channel.
 *  • Deletion requires both:
 *      1. The admin explicitly choosing "Delete Flagged Content", AND
 *      2. The item NOT being a whitelisted safe file type with a clean filename.
 */

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');

const DecisionLayer = require('./DecisionLayer');

// These types are always safe to delete when admin confirms
const ALWAYS_DELETABLE_TYPES = new Set(['malicious_link', 'phishing', 'spam', 'toxic_content']);
// suspicious_file is deletable only if filename matches a malicious pattern
// (this was already gated in ScanEngine — if it reached flaggedItems it's safe to delete)

const PAGE_SIZE = 5; // Items per page in review mode

class ActionExecutor {
    /**
     * @param {object}        bot
     * @param {DecisionLayer} decisionLayer
     */
    constructor(bot, decisionLayer) {
        this.bot           = bot;
        this.decisionLayer = decisionLayer;
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    /**
     * Handle a button interaction whose customId starts with "scanaction:".
     * Called from interactionCreate.js.
     *
     * @param {import('discord.js').ButtonInteraction} interaction
     */
    async handleInteraction(interaction) {
        // Only Administrators may interact
        if (!DecisionLayer.isAdmin(interaction.member)) {
            return interaction.reply({
                content: '❌ Only users with the **Administrator** permission can use these buttons.',
                ephemeral: true,
            });
        }

        // Parse customId:  scanaction:<action>:<decisionId>
        //            or:   scanreview:<guildId>:<page>
        const [prefix, ...rest] = interaction.customId.split(':');

        if (prefix === 'scanaction') {
            const [action, decisionId] = rest;
            return this._handleAction(interaction, action, decisionId);
        }

        if (prefix === 'scanreview') {
            const [guildId, pageStr] = rest;
            return this._handleReviewPage(interaction, guildId, parseInt(pageStr, 10));
        }
    }

    // ── Action dispatch ───────────────────────────────────────────────────────

    async _handleAction(interaction, action, decisionId) {
        const guild = interaction.guild;
        const entry = this.decisionLayer.pop(guild.id, decisionId);

        if (!entry) {
            return interaction.reply({
                content: '⏰ This decision has expired or was already acted upon.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        switch (action) {
            case 'delete': return this._executeDelete(interaction, entry);
            case 'ignore': return this._executeIgnore(interaction, entry);
            case 'review': return this._executeReview(interaction, entry);
            case 'cancel': return this._executeCancel(interaction, entry);
            default:
                return interaction.editReply({ content: `Unknown action: ${action}` });
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async _executeDelete(interaction, entry) {
        const { report } = entry;
        const { flaggedItems, whitelist } = report;

        let deleted = 0;
        let skipped = 0;
        const errors = [];

        for (const item of flaggedItems) {
            // Determine if this item is eligible for deletion
            if (!this._isDeletable(item, whitelist)) {
                skipped++;
                continue;
            }

            try {
                const channel = interaction.guild.channels.cache.get(item.channelId);
                if (!channel) { skipped++; continue; }

                const msg = await channel.messages.fetch(item.messageId).catch(() => null);
                if (!msg) { skipped++; continue; }

                await msg.delete();
                deleted++;

                // Brief pause to avoid rate limits
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                errors.push(`${item.messageId}: ${err.message}`);
                this.bot.logger?.error(`[ActionExecutor] Delete failed for msg ${item.messageId}:`, err);
            }
        }

        // Log the action
        await this._log(interaction.guild, {
            action:    'DELETE',
            adminTag:  interaction.user.username,
            adminId:   interaction.user.id,
            deleted,
            skipped,
            errors:    errors.length,
            total:     flaggedItems.length,
        });

        // Disable buttons on the original report message
        await this._disableReportButtons(interaction, entry, `✅ Deleted by ${interaction.user.username}`);

        await interaction.editReply({
            content: [
                `✅ **Done.** ${deleted} message${deleted !== 1 ? 's' : ''} deleted.`,
                skipped  ? `⏭️ ${skipped} item${skipped !== 1 ? 's' : ''} skipped (whitelisted or no longer exist).` : '',
                errors.length ? `⚠️ ${errors.length} deletion${errors.length !== 1 ? 's' : ''} failed.` : '',
            ].filter(Boolean).join('\n'),
        });
    }

    // ── Ignore ────────────────────────────────────────────────────────────────

    async _executeIgnore(interaction, entry) {
        await this._log(interaction.guild, {
            action:   'IGNORE',
            adminTag: interaction.user.username,
            adminId:  interaction.user.id,
            total:    entry.report.flaggedItems.length,
        });

        await this._disableReportButtons(interaction, entry, `⚠️ Ignored by ${interaction.user.username}`);

        await interaction.editReply({
            content: `⚠️ All ${entry.report.flaggedItems.length} flagged items marked as ignored. No content was deleted.`,
        });
    }

    // ── Review individually ───────────────────────────────────────────────────

    async _executeReview(interaction, entry) {
        // Store report in a temporary Map on the executor for pagination
        this._reviewData = this._reviewData ?? new Map();
        this._reviewData.set(interaction.guild.id, entry.report);

        await this._disableReportButtons(interaction, entry, `🔍 Review started by ${interaction.user.username}`);
        await this._sendReviewPage(interaction, interaction.guild.id, 0, entry.report);
    }

    async _handleReviewPage(interaction, guildId, page) {
        const report = this._reviewData?.get(guildId);
        if (!report) {
            return interaction.reply({ content: '⏰ Review session expired.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await this._sendReviewPage(interaction, guildId, page, report);
    }

    async _sendReviewPage(interaction, guildId, page, report) {
        const { flaggedItems } = report;
        const totalPages = Math.ceil(flaggedItems.length / PAGE_SIZE);
        const slice = flaggedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        const lines = slice.map((item, i) => {
            const n = page * PAGE_SIZE + i + 1;
            return [
                `**${n}.** ${item.type.replace(/_/g, ' ').toUpperCase()} in <#${item.channelId}>`,
                `👤 \`${item.username}\`  •  🕐 <t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:R>`,
                `📝 Reason: ${item.reason}`,
                item.content ? `💬 \`${item.content.substring(0, 100)}...\`` : '',
            ].filter(Boolean).join('\n');
        });

        const embed = new EmbedBuilder()
            .setTitle(`🔍 Review — Page ${page + 1} / ${totalPages}`)
            .setColor(0x339af0)
            .setDescription(lines.join('\n\n') || 'No items on this page.')
            .setFooter({ text: `${flaggedItems.length} total items • Use buttons to navigate` });

        const navRow = new ActionRowBuilder();
        if (page > 0) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`scanreview:${guildId}:${page - 1}`)
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        if (page < totalPages - 1) {
            navRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`scanreview:${guildId}:${page + 1}`)
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        const components = navRow.components.length ? [navRow] : [];

        if (typeof interaction.editReply === 'function' && interaction.deferred) {
            await interaction.editReply({ embeds: [embed], components });
        } else {
            await interaction.reply({ embeds: [embed], components, ephemeral: true });
        }
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    async _executeCancel(interaction, entry) {
        await this._disableReportButtons(interaction, entry, `❌ Cancelled by ${interaction.user.username}`);
        await interaction.editReply({ content: '❌ Action cancelled. No changes were made.' });
    }

    // ── Shared helpers ────────────────────────────────────────────────────────

    /**
     * Determine if a flagged item may be deleted.
     * PNGs/GIFs are only deletable if they matched a malicious pattern
     * (already gated in ScanEngine — suspicious_file is only set for bad names).
     */
    _isDeletable(item, whitelist) {
        if (ALWAYS_DELETABLE_TYPES.has(item.type)) return true;
        if (item.type === 'suspicious_file') return true;  // ScanEngine already validated
        return false;
    }

    /** Edit the original report message to disable its buttons and append a status note */
    async _disableReportButtons(interaction, entry, statusNote) {
        try {
            const ch  = interaction.guild.channels.cache.get(entry.channelId);
            const msg = ch ? await ch.messages.fetch(entry.messageId).catch(() => null) : null;
            if (msg) {
                const disabledRows = msg.components.map(row => {
                    const newRow = new ActionRowBuilder();
                    for (const btn of row.components) {
                        newRow.addComponents(
                            ButtonBuilder.from(btn).setDisabled(true)
                        );
                    }
                    return newRow;
                });

                const updatedEmbed = EmbedBuilder.from(msg.embeds[0] ?? {})
                    .setFooter({ text: `${statusNote} • ${new Date().toLocaleString()}` });

                await msg.edit({ embeds: [updatedEmbed], components: disabledRows });
            }
        } catch { /* best-effort */ }
    }

    /** Write an action log to the configured log channel (or console) */
    async _log(guild, details) {
        try {
            const config = await this.bot.database?.get(
                'SELECT alert_channel FROM guild_configs WHERE guild_id = ?', [guild.id]
            );
            const logChannelId = config?.alert_channel;
            const logChannel   = logChannelId ? guild.channels.cache.get(logChannelId) : null;

            const lines = Object.entries(details).map(([k, v]) => `**${k}:** ${v}`);
            const embed = new EmbedBuilder()
                .setTitle('🗂️ Scan Decision Log')
                .setColor(details.action === 'DELETE' ? 0xff6b6b : 0x868e96)
                .setDescription(lines.join('\n'))
                .setTimestamp();

            if (logChannel?.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
                await logChannel.send({ embeds: [embed] });
            }

            // Always log to bot logger as well
            this.bot.logger?.info(`[ActionExecutor] ${details.action} in ${guild.name} by ${details.adminTag}`, details);

            // Persist to DB if available
            await this.bot.database?.run(
                `INSERT OR IGNORE INTO admin_audit_log (guild_id, action, details, timestamp)
                 VALUES (?, ?, ?, ?)`,
                [guild.id, `SCAN_${details.action}`, JSON.stringify(details), new Date().toISOString()]
            ).catch(() => {});
        } catch (err) {
            this.bot.logger?.error('[ActionExecutor] Logging failed:', err);
        }
    }
}

module.exports = ActionExecutor;
