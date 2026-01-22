/**
 * Verification Join Flow with Staff Overrides
 * - Assigns an Unverified role on join (auto-creates if missing)
 * - Sends DM instructions to the user
 * - Posts a staff log with two buttons:
 *     1) Allow Skip Verification (grants verified role + welcome)
 *     2) Deny & Kick User
 * - Buttons are restricted to staff (ManageGuild/Admin) and disable after use
 * - Uses guild config (via SettingsManager/database) for role/channel IDs
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

const AUTO_KICK_DELAY_MS = 5 * 60 * 1000; // 5 minutes; set to 0 to disable

module.exports = {
    name: 'guildMemberAdd',
    once: false,

    /**
     * @param {import('discord.js').GuildMember} member
     * @param {Object} bot Bot instance (injected by loader)
     */
    async execute(member, bot) {
        const guild = member.guild;
        const cfg = await getGuildConfig(bot, guild);

        // Feature toggle enforcement - skip if verification is disabled
        if (!cfg || !cfg.verification_enabled) {
            bot.logger?.debug(`[VERIFICATION] Skipping verification for ${member.user.tag} in ${guild.name} - feature disabled`);
            return;
        }

        try {
            const roles = await ensureRoles(guild, cfg, bot);
            if (roles.unverifiedRole) {
                await member.roles.add(roles.unverifiedRole, 'New member - awaiting verification');
            }

            // Record pending status for queue/analytics
            try {
                const now = new Date().toISOString();
                await bot.database.run(
                    `INSERT INTO verification_records (guild_id, user_id, status, source, created_at, updated_at)
                     VALUES (?, ?, 'pending', 'join', ?, ?)
                     ON CONFLICT(guild_id, user_id) DO UPDATE SET status='pending', source='join', updated_at=?`,
                    [guild.id, member.id, now, now, now]
                );
            } catch (e) { bot.logger?.warn('[VERIFICATION] queue record failed:', e.message); }

            await sendVerificationDM(member);
            await postStaffLog(member, guild, roles, cfg, bot);

            if (AUTO_KICK_DELAY_MS > 0) {
                scheduleAutoKick(member, roles.unverifiedRole?.id, cfg, bot);
            }
        } catch (error) {
            bot?.logger?.error('[VERIFICATION] Error in guildMemberAdd:', error);
        }
    }
};

// Export button handler
module.exports.handleVerificationButtons = async function handleVerificationButtons(interaction, bot) {
    if (!interaction.isButton()) return;
    const { customId, guild } = interaction;
    if (!guild) return;

    if (!customId.startsWith('verify_allow_') && !customId.startsWith('verify_deny_')) return;

    // Staff permission check
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You need Manage Server or Administrator to use this.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetId = customId.split('_')[2];
    const action = customId.startsWith('verify_allow_') ? 'allow' : 'deny';

    const cfg = await getGuildConfig(bot, guild);
    const roles = await ensureRoles(guild, cfg, bot);
    const member = await guild.members.fetch(targetId).catch(() => null);

    if (!member) {
        return interaction.editReply({ content: 'User not found (may have left).' });
    }

    try {
        const Actions = require('../security/verificationActions');
        if (!bot.verificationActions) bot.verificationActions = new Actions(bot);
        const actorId = interaction.user.id;

        if (action === 'allow') {
            await bot.verificationActions.approveUser(guild.id, member.id, actorId, 'staff-button');
            await sendWelcomeMessage(member, guild, cfg);
            await updateLogMessage(interaction, member, 'Approved & Verified', '#00FF00');
            await interaction.editReply({ content: `Approved ${member.user.tag} and marked verified.` });
        } else {
            await bot.verificationActions.kickUser(guild.id, member.id, actorId, 'staff-button');
            await updateLogMessage(interaction, member, 'Denied & Kicked', '#FF0000');
            await interaction.editReply({ content: `Denied and kicked ${member.user.tag}.` });
        }
    } catch (err) {
        bot?.logger?.error('[VERIFICATION] Button handler error:', err);
        await interaction.editReply({ content: `Error: ${err.message}` }).catch(() => {});
    }
};

// Helpers

async function getGuildConfig(bot, guild) {
    try {
        if (bot?.settingsManager?.getSettings) {
            const settings = await bot.settingsManager.getSettings(guild.id);
            const config = await bot.database.getGuildConfig(guild.id);
            return { ...config, settings };
        }
        return await bot?.database?.getGuildConfig(guild.id) ?? {};
    } catch {
        return {};
    }
}

async function ensureRoles(guild, cfg, bot) {
    let unverifiedRole = null;
    let verifiedRole = null;

    // Verified role from config
    if (cfg?.verification_role || cfg?.verification_role_id) {
        verifiedRole = guild.roles.cache.get(cfg.verification_role || cfg.verification_role_id) || null;
    }

    // Try to locate an existing "Unverified" role
    unverifiedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'unverified') || null;

    if (!unverifiedRole) {
        try {
            unverifiedRole = await guild.roles.create({
                name: 'Unverified',
                color: '#888888',
                hoist: false,
                mentionable: false,
                reason: 'Auto-created unverified role'
            });
            bot?.logger?.info(`[VERIFICATION] Auto-created Unverified role in ${guild.name}`);
        } catch (err) {
            bot?.logger?.warn(`[VERIFICATION] Failed to create Unverified role in ${guild.name}: ${err.message}`);
        }
    }

    return { unverifiedRole, verifiedRole };
}

async function sendVerificationDM(member) {
    try {
        // Build the web verification URL
        const dashboardUrl = process.env.DASHBOARD_URL || 'https://discord-security-bot-uyx6.onrender.com';
        const verifyUrl = `${dashboardUrl}/verify/${member.guild.id}/${member.id}`;
        
        const dmEmbed = new EmbedBuilder()
            .setTitle(`🔐 Welcome to ${member.guild.name}!`)
            .setDescription('Thank you for joining! Please complete verification to access the server.')
            .addFields(
                {
                    name: '🌐 How to Verify',
                    value: `Click the link below to open our secure verification portal:\n\n**[Click Here to Verify](${verifyUrl})**\n\nOr copy this link: \`${verifyUrl}\``
                },
                {
                    name: '📜 Server Rules',
                    value: '• Be respectful\n• No spam or self-promo\n• Follow Discord TOS\n• Enjoy your stay!'
                },
                {
                    name: '❓ Need Help?',
                    value: 'If you have questions or issues verifying, head to the verification channel in the server or ping a staff member.'
                }
            )
            .setColor('#00d4ff')
            .setThumbnail(member.guild.iconURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${member.id} | Verification required` })
            .setTimestamp();

        // Add a button to the DM as well
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel('🔗 Verify Now')
                    .setStyle(ButtonStyle.Link)
                    .setURL(verifyUrl)
            );

        await member.send({ embeds: [dmEmbed], components: [row] });
    } catch (error) {
        // User may have DMs disabled
    }
}

async function postStaffLog(member, guild, roles, cfg, bot) {
    try {
        const logChannelId = cfg?.log_channel_id || cfg?.mod_log_channel;
        const logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;

        if (!logChannel || !logChannel.isTextBased()) {
            bot?.logger?.warn('[VERIFICATION] Log channel missing; staff buttons not sent.');
            return;
        }

        const logEmbed = new EmbedBuilder()
            .setTitle('dY` New Member Joined')
            .setDescription(`**${member.user.tag}** joined and is awaiting verification.`)
            .addFields(
                { name: 'User', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                { name: 'Status', value: '⏳ Awaiting Verification', inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setColor('#FFA500')
            .setTimestamp();

        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`verify_allow_${member.id}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`verify_deny_${member.id}`)
                .setLabel('Kick')
                .setStyle(ButtonStyle.Danger)
        );

        await logChannel.send({ embeds: [logEmbed], components: [actionRow] });
    } catch (error) {
        bot?.logger?.error('[VERIFICATION] Failed to post staff log:', error);
    }
}

async function updateLogMessage(interaction, member, statusText, color) {
    const base = interaction.message.embeds?.[0];
    const updatedEmbed = base ? EmbedBuilder.from(base) : new EmbedBuilder().setDescription(`${member.user.tag}`);
    updatedEmbed.setColor(color).addFields({ name: 'Action', value: `${statusText} by ${interaction.user.tag}` });

    await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
}

function scheduleAutoKick(member, unverifiedRoleId, cfg, bot) {
    setTimeout(async () => {
        try {
            const fresh = await member.guild.members.fetch(member.id).catch(() => null);
            if (!fresh) return;
            const stillUnverified = unverifiedRoleId && fresh.roles.cache.has(unverifiedRoleId);
            if (stillUnverified) {
                await fresh.kick('Verification timeout');
                bot?.logger?.info(`[VERIFICATION] Auto-kicked ${fresh.user.tag} for not verifying`);
            }
        } catch (error) {
            bot?.logger?.warn('[VERIFICATION] Auto-kick failed:', error.message);
        }
    }, AUTO_KICK_DELAY_MS);
}

async function sendWelcomeMessage(member, guild, cfg) {
    try {
        const welcomeId = cfg?.welcome_channel;
        const welcomeChannel = welcomeId ? guild.channels.cache.get(welcomeId) : guild.systemChannel;
        if (!welcomeChannel || !welcomeChannel.isTextBased()) return;

        const welcomeEmbed = new EmbedBuilder()
            .setTitle('dYZ% Welcome!')
            .setDescription(`Everyone welcome **${member.user.tag}** to the server!`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setColor('#00FF00')
            .setTimestamp();

        await welcomeChannel.send({ content: `${member}`, embeds: [welcomeEmbed] });
    } catch (error) {
        guild.client.bot?.logger?.warn('[VERIFICATION] Failed to send welcome message:', error.message);
    }
}
