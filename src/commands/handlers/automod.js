/**
 * Automod Handlers - Centralized auto-moderation logic
 * Routes from /automod command to actual functionality
 */

const { EmbedBuilder } = require('discord.js');

// =====================================================
// UTILITY FUNCTIONS
// =====================================================
function normalizeList(raw) {
    const str = String(raw || '').trim();
    if (!str) return '[]';
    if (str.startsWith('[')) {
        try {
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) return JSON.stringify(parsed.map(s => String(s || '').trim()).filter(Boolean));
        } catch (_) { /* fall through */ }
    }
    const arr = str.split(',').map(s => s.trim()).filter(Boolean);
    return JSON.stringify(arr);
}

// =====================================================
// SPAM HANDLERS
// =====================================================
const spamHandlers = {
    async enable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_spam_enabled)
            VALUES (?, 1)
            ON CONFLICT(guild_id) DO UPDATE SET anti_spam_enabled = 1, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Anti-Spam Enabled')
            .setDescription('Spam bursts, repeated messages, and mention floods will be mitigated.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async disable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_spam_enabled)
            VALUES (?, 0)
            ON CONFLICT(guild_id) DO UPDATE SET anti_spam_enabled = 0, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('⏸️ Anti-Spam Disabled')
            .setDescription('Spam detection is now turned off.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async config(interaction, bot, options) {
        const guildId = interaction.guild.id;
        const updates = [];
        const values = [];

        const pushIfDefined = (col, val) => {
            if (val === null || val === undefined) return;
            updates.push(`${col} = ?`);
            values.push(val);
        };

        if (options.bypass_channels) {
            pushIfDefined('antispam_bypass_channels', normalizeList(options.bypass_channels));
        }
        pushIfDefined('antispam_flood_mid', options.flood_mid);
        pushIfDefined('antispam_flood_high', options.flood_high);
        pushIfDefined('antispam_duplicate_mid', options.duplicate_mid);
        pushIfDefined('antispam_duplicate_high', options.duplicate_high);
        pushIfDefined('antispam_mention_threshold', options.mention_threshold);

        if (updates.length === 0) {
            return interaction.reply({ content: 'No settings provided. Specify at least one option.', ephemeral: true });
        }

        values.push(guildId);
        await bot.database.run(`
            UPDATE guild_configs
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
        `, values);

        const embed = new EmbedBuilder()
            .setColor('#22c55e')
            .setTitle('✅ Spam Settings Updated')
            .setDescription('Custom thresholds have been saved.')
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

// =====================================================
// RAID HANDLERS
// =====================================================
const raidHandlers = {
    async enable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_raid_enabled)
            VALUES (?, 1)
            ON CONFLICT(guild_id) DO UPDATE SET anti_raid_enabled = 1, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Anti-Raid Enabled')
            .setDescription('Coordinated raid patterns will now be actively detected and blocked.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async disable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_raid_enabled)
            VALUES (?, 0)
            ON CONFLICT(guild_id) DO UPDATE SET anti_raid_enabled = 0, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('⏸️ Anti-Raid Disabled')
            .setDescription('Raid detection is now turned off.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async config(interaction, bot, options) {
        const guildId = interaction.guild.id;
        const updates = [];
        const values = [];

        if (options.threshold !== null && options.threshold !== undefined) {
            updates.push('raid_threshold = ?');
            values.push(options.threshold);
        }
        if (options.lockdown_duration !== null && options.lockdown_duration !== undefined) {
            updates.push('raid_lockdown_duration_ms = ?');
            values.push(options.lockdown_duration);
        }

        if (updates.length === 0) {
            return interaction.reply({ content: 'No settings provided. Specify at least one option.', ephemeral: true });
        }

        values.push(guildId);
        await bot.database.run(`
            UPDATE guild_configs
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
        `, values);

        const embed = new EmbedBuilder()
            .setColor('#22c55e')
            .setTitle('✅ Raid Settings Updated')
            .setDescription('Raid thresholds and lockdown duration saved.')
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

// =====================================================
// LINKS HANDLERS
// =====================================================
const linksHandlers = {
    async enable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_links_enabled)
            VALUES (?, 1)
            ON CONFLICT(guild_id) DO UPDATE SET anti_links_enabled = 1, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Anti-Links Enabled')
            .setDescription('Malicious links will be detected and mitigated.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async disable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_links_enabled)
            VALUES (?, 0)
            ON CONFLICT(guild_id) DO UPDATE SET anti_links_enabled = 0, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('⏸️ Anti-Links Disabled')
            .setDescription('Link detection is now turned off.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async config(interaction, bot, options) {
        const guildId = interaction.guild.id;
        const updates = [];
        const values = [];

        const pushJson = (col, raw) => {
            if (!raw) return;
            updates.push(`${col} = ?`);
            values.push(normalizeList(raw));
        };

        pushJson('antilinks_allowed_domains', options.allow_domains);
        pushJson('antilinks_blocked_domains', options.block_domains);

        if (options.safe_browsing !== null && options.safe_browsing !== undefined) {
            updates.push('safe_browsing_enabled = ?');
            values.push(options.safe_browsing ? 1 : 0);
        }

        if (updates.length === 0) {
            return interaction.reply({ content: 'No settings provided. Specify at least one option.', ephemeral: true });
        }

        values.push(guildId);
        await bot.database.run(`
            UPDATE guild_configs
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
        `, values);

        const embed = new EmbedBuilder()
            .setColor('#22c55e')
            .setTitle('✅ Link Settings Updated')
            .setDescription('Domain lists and Safe Browsing settings saved.')
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

// =====================================================
// PHISHING HANDLERS
// =====================================================
const LINK_REGEX = /https?:\/\/[^\s)]+/gi;
const SUSPICIOUS_PATTERNS = [/discord\.[a-z]{2}\//i, /free-?nitro/i, /steamgift/i, /@everyone/i];

function analyzeLink(link) {
    const flags = [];
    if (/discord(gifts|app)?\.com\.[a-z]{2,}/i.test(link)) flags.push('Domain spoof');
    if (/nitro|giveaway|free|gift/i.test(link)) flags.push('Incentive bait');
    if (/\bverify\b|login|auth/i.test(link)) flags.push('Credential lure');
    return { link, flags };
}

const phishingHandlers = {
    async enable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_phishing_enabled)
            VALUES (?, 1)
            ON CONFLICT(guild_id) DO UPDATE SET anti_phishing_enabled = 1, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);
        
        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Anti-Phishing Enabled')
            .setDescription('Suspicious links and phishing attempts will now be scanned.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async disable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, anti_phishing_enabled)
            VALUES (?, 0)
            ON CONFLICT(guild_id) DO UPDATE SET anti_phishing_enabled = 0, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);
        
        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('⏸️ Anti-Phishing Disabled')
            .setDescription('Phishing link detection is now turned off.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async scan(interaction, bot, url = null, limit = 50) {
        await interaction.deferReply({ ephemeral: true });
        
        if (url) {
            const result = analyzeLink(url);
            const suspicious = result.flags.length || SUSPICIOUS_PATTERNS.some(r => r.test(url));
            const embed = new EmbedBuilder()
                .setColor(suspicious ? '#ef4444' : '#22c55e')
                .setTitle(suspicious ? '⚠️ Suspicious Link' : '✅ Link Looks Safe')
                .addFields({ name: 'URL', value: url });
            if (result.flags.length) embed.addFields({ name: 'Indicators', value: result.flags.join(', ') });
            return interaction.editReply({ embeds: [embed] });
        }

        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) }).catch(() => new Map());
        const links = [];
        for (const msg of messages.values()) {
            const found = msg.content.match(LINK_REGEX);
            if (found) found.forEach(f => links.push({ link: f, author: msg.author }));
        }
        const analyzed = links.map(l => ({ author: l.author, ...analyzeLink(l.link) }));
        const suspicious = analyzed.filter(a => a.flags.length || SUSPICIOUS_PATTERNS.some(r => r.test(a.link)));

        const embed = new EmbedBuilder()
            .setColor(suspicious.length ? '#ef4444' : '#22c55e')
            .setTitle('🔎 Phishing Scan Results')
            .setDescription(`${links.length} links scanned. ${suspicious.length} flagged.`)
            .setTimestamp();

        if (suspicious.length) {
            embed.addFields({
                name: 'Flagged Links',
                value: suspicious.slice(0, 10).map(s => `${s.author}: ${s.link} (${s.flags.join('/') || 'pattern'})`).join('\n')
            });
            if (suspicious.length > 10) embed.addFields({ name: 'More', value: `${suspicious.length - 10} additional flagged link(s)...` });
        }

        return interaction.editReply({ embeds: [embed] });
    }
};

// =====================================================
// EMOJI HANDLERS
// =====================================================
const emojiHandlers = {
    async enable(interaction, bot, options = {}) {
        const guildId = interaction.guild.id;
        
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, emoji_spam_enabled, emoji_spam_max, emoji_spam_action)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET 
                emoji_spam_enabled = 1, 
                emoji_spam_max = COALESCE(?, emoji_spam_max, 10),
                emoji_spam_action = COALESCE(?, emoji_spam_action, 'delete'),
                updated_at = CURRENT_TIMESTAMP
        `, [guildId, options.max_emojis || 10, options.action || 'delete', options.max_emojis, options.action]);

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Emoji Spam Detection Enabled')
            .setDescription(`Messages with excessive emojis (>${options.max_emojis || 10}) will be handled.`)
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async disable(interaction, bot) {
        const guildId = interaction.guild.id;
        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, emoji_spam_enabled)
            VALUES (?, 0)
            ON CONFLICT(guild_id) DO UPDATE SET emoji_spam_enabled = 0, updated_at = CURRENT_TIMESTAMP
        `, [guildId]);

        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('⏸️ Emoji Spam Detection Disabled')
            .setDescription('Emoji spam detection is now turned off.')
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    },

    async config(interaction, bot, options) {
        const guildId = interaction.guild.id;
        const updates = [];
        const values = [];

        if (options.max_emojis !== null && options.max_emojis !== undefined) {
            updates.push('emoji_spam_max = ?');
            values.push(options.max_emojis);
        }
        if (options.action) {
            updates.push('emoji_spam_action = ?');
            values.push(options.action);
        }
        if (options.max_stickers !== null && options.max_stickers !== undefined) {
            updates.push('sticker_spam_max = ?');
            values.push(options.max_stickers);
        }

        if (updates.length === 0) {
            return interaction.reply({ content: 'No settings provided. Specify at least one option.', ephemeral: true });
        }

        values.push(guildId);
        await bot.database.run(`
            UPDATE guild_configs
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ?
        `, values);

        const embed = new EmbedBuilder()
            .setColor('#22c55e')
            .setTitle('✅ Emoji Settings Updated')
            .setDescription('Emoji spam detection settings saved.')
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

// =====================================================
// STATUS HANDLER
// =====================================================
async function getAutomodStatus(interaction, bot) {
    const guildId = interaction.guild.id;
    const cfg = await bot.database.getGuildConfig(guildId);

    const status = (enabled) => enabled ? '✅ ON' : '❌ OFF';

    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🤖 Automod Status')
        .setDescription('Current auto-moderation settings for this server')
        .addFields(
            { name: '🔇 Anti-Spam', value: status(cfg.anti_spam_enabled), inline: true },
            { name: '🚨 Anti-Raid', value: status(cfg.anti_raid_enabled), inline: true },
            { name: '🔗 Anti-Links', value: status(cfg.anti_links_enabled), inline: true },
            { name: '🎣 Anti-Phishing', value: status(cfg.anti_phishing_enabled), inline: true },
            { name: '😀 Emoji Spam', value: status(cfg.emoji_spam_enabled), inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        )
        .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
    spamHandlers,
    raidHandlers,
    linksHandlers,
    phishingHandlers,
    emojiHandlers,
    getAutomodStatus,
    normalizeList
};
