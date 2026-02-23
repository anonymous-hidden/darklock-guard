/**
 * Command Handlers - Centralized routing layer
 * All setup/admin commands route through here to avoid code duplication
 */

const { EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');

// =====================================================
// WIZARD HANDLERS
// =====================================================
const wizardHandlers = {
    async start(interaction, bot, restart = false) {
        if (!bot.setupWizard) {
            return interaction.reply({
                content: '❌ Setup wizard is not available.',
                ephemeral: true
            });
        }
        await bot.setupWizard.startSetup(interaction, restart);
    },

    async cancel(interaction, bot) {
        if (!bot.setupWizard) {
            return interaction.reply({
                content: '❌ Setup wizard is not available.',
                ephemeral: true
            });
        }
        const guildId = interaction.guild.id;
        if (bot.setupWizard.activeSetups.has(guildId)) {
            bot.setupWizard.activeSetups.delete(guildId);
            await interaction.reply({
                content: '✅ Setup wizard session cancelled. Start a new one with `/setup wizard start`.',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: 'ℹ️ No active setup wizard session to cancel.',
                ephemeral: true
            });
        }
    },

    async status(interaction, bot) {
        const guildId = interaction.guild.id;
        try {
            const setupData = await bot.database.get(`
                SELECT * FROM setup_wizard WHERE guild_id = ?
            `, [guildId]);

            if (!setupData) {
                return interaction.reply({
                    content: '⚠️ Setup wizard has not been completed yet. Run `/setup wizard start` to begin!',
                    ephemeral: true
                });
            }

            const completedAt = new Date(setupData.completed_at).toLocaleString();
            const data = JSON.parse(setupData.setup_data);

            const features = [];
            if (data.security) features.push('🛡️ Security Protection');
            if (data.analytics) features.push('📊 Analytics Tracking');
            if (data.tickets) features.push('🎫 Ticket System');
            if (data.channels) features.push('📂 Channel Setup');

            const embed = new EmbedBuilder()
                .setTitle('✅ Setup Status')
                .setDescription('Your server setup is complete!')
                .addFields([
                    { name: 'Completed At', value: completedAt, inline: true },
                    { name: 'Configured Features', value: features.length > 0 ? features.join('\n') : 'Basic configuration', inline: false }
                ])
                .setColor(0x00ff00);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            bot.logger?.error('Error checking setup status:', error);
            await interaction.reply({
                content: '❌ Error checking setup status.',
                ephemeral: true
            });
        }
    }
};

// =====================================================
// ONBOARDING HANDLERS
// =====================================================
const onboardingHandlers = {
    async setMode(interaction, bot, mode) {
        const guildId = interaction.guild.id;
        const cfg = await bot.database.getGuildConfig(guildId);
        let welcome = cfg.welcome_enabled;
        let verify = cfg.verification_enabled;

        if (mode === 'welcome') {
            welcome = true; verify = false;
        } else if (mode === 'verify') {
            welcome = false; verify = true;
        } else if (mode === 'disable') {
            welcome = false; verify = false;
        }

        if (mode !== 'view') {
            await bot.database.run(
                `UPDATE guild_configs SET welcome_enabled = ?, verification_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
                [welcome ? 1 : 0, verify ? 1 : 0, guildId]
            );

            try {
                if (typeof bot.emitSettingChange === 'function') {
                    await bot.emitSettingChange(guildId, interaction.user.id, 'welcome_enabled', welcome ? 1 : 0, cfg.welcome_enabled, 'security');
                    await bot.emitSettingChange(guildId, interaction.user.id, 'verification_enabled', verify ? 1 : 0, cfg.verification_enabled, 'security');
                }
            } catch (e) {
                bot.logger?.warn?.('emitSettingChange failed:', e?.message || e);
            }

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
            content: `Welcome: ${welcome ? '✅ ON' : '❌ OFF'} | Verification: ${verify ? '✅ ON' : '❌ OFF'}`,
            ephemeral: true
        });
    },

    async setChannel(interaction, bot, channel) {
        const cfg = await bot.database.getGuildConfig(interaction.guild.id);
        if (cfg.welcome_enabled) {
            return interaction.reply({ content: '❌ Verification system is disabled (welcome mode is active).', ephemeral: true });
        }

        await bot.database.run(`UPDATE guild_configs SET verification_channel_id = ? WHERE guild_id = ?`, [channel.id, interaction.guild.id]);
        try {
            if (typeof bot.emitSettingChange === 'function') {
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'verification_channel_id', channel.id, null, 'configuration');
            }
        } catch (e) {
            bot.logger?.warn?.('emitSettingChange failed:', e?.message || e);
        }
        return interaction.reply({ content: `✅ Verification channel set to ${channel}`, ephemeral: true });
    },

    async setMessage(interaction, bot, content) {
        const cfg = await bot.database.getGuildConfig(interaction.guild.id);
        if (!cfg.verification_enabled) {
            return interaction.reply({ content: '❌ Verification system is disabled. Enable it first.', ephemeral: true });
        }

        await bot.database.run(`UPDATE guild_configs SET verified_welcome_message = ? WHERE guild_id = ?`, [content, interaction.guild.id]);
        try {
            if (typeof bot.emitSettingChange === 'function') {
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'verified_welcome_message', content, null, 'configuration');
            }
        } catch (e) {
            bot.logger?.warn?.('emitSettingChange failed:', e?.message || e);
        }
        return interaction.reply({ content: '✅ Verified welcome message updated.', ephemeral: true });
    },

    async testMessage(interaction, bot) {
        const cfg = await bot.database.getGuildConfig(interaction.guild.id);
        const msg = (cfg.verified_welcome_message || 'Welcome {user} to {server}!')
            .replace('{user}', interaction.user)
            .replace('{server}', interaction.guild.name);
        return interaction.reply({ content: `**Preview:** ${msg}`, ephemeral: true });
    }
};

// =====================================================
// AUTOROLE HANDLERS
// =====================================================
const autoroleHandlers = {
    async add(interaction, bot, role) {
        if (role.managed) {
            return interaction.reply({
                content: '❌ Cannot auto-assign managed roles (bot roles)',
                ephemeral: true
            });
        }

        if (role.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.reply({
                content: '❌ Cannot auto-assign roles higher than my highest role',
                ephemeral: true
            });
        }

        try {
            await bot.database.run(`
                INSERT OR IGNORE INTO autoroles (guild_id, role_id)
                VALUES (?, ?)
            `, [interaction.guild.id, role.id]);

            await interaction.reply({
                content: `✅ ${role} will now be automatically assigned to new members`,
                ephemeral: false
            });
        } catch (error) {
            await interaction.reply({
                content: '❌ Failed to add auto-role',
                ephemeral: true
            });
        }
    },

    async remove(interaction, bot, role) {
        try {
            const result = await bot.database.run(`
                DELETE FROM autoroles
                WHERE guild_id = ? AND role_id = ?
            `, [interaction.guild.id, role.id]);

            if (result.changes > 0) {
                await interaction.reply({
                    content: `✅ Removed ${role} from auto-assignment`,
                    ephemeral: false
                });
            } else {
                await interaction.reply({
                    content: `❌ ${role} was not set as an auto-role`,
                    ephemeral: true
                });
            }
        } catch (error) {
            await interaction.reply({
                content: '❌ Failed to remove auto-role',
                ephemeral: true
            });
        }
    },

    async list(interaction, bot) {
        try {
            const autoroles = await bot.database.all(`
                SELECT role_id FROM autoroles
                WHERE guild_id = ?
            `, [interaction.guild.id]);

            if (autoroles.length === 0) {
                return interaction.reply({
                    content: 'No auto-roles configured',
                    ephemeral: true
                });
            }

            const roles = autoroles
                .map(ar => interaction.guild.roles.cache.get(ar.role_id))
                .filter(r => r)
                .map(r => r.toString())
                .join('\n');

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Auto-Assigned Roles')
                .setDescription(roles || 'No valid roles found')
                .setColor('#5865F2')
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            await interaction.reply({
                content: '❌ Failed to retrieve auto-roles',
                ephemeral: true
            });
        }
    }
};

// =====================================================
// SERVER CONTROL HANDLERS (Destructive Actions)
// =====================================================
const serverControlHandlers = {
    async lockdown(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const everyone = interaction.guild.roles.everyone;
        let affected = 0;
        for (const [, channel] of interaction.guild.channels.cache) {
            if (channel.type !== ChannelType.GuildText) continue;
            try {
                await channel.permissionOverwrites.edit(everyone, { SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false });
                affected++;
            } catch {}
        }
        return interaction.editReply({ content: `🔒 Locked down ${affected} text channels for @everyone.` });
    },

    async unlock(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const everyone = interaction.guild.roles.everyone;
        let affected = 0;
        for (const [, channel] of interaction.guild.channels.cache) {
            if (channel.type !== ChannelType.GuildText) continue;
            try {
                await channel.permissionOverwrites.edit(everyone, { SendMessages: null, CreatePublicThreads: null, CreatePrivateThreads: null });
                affected++;
            } catch {}
        }
        return interaction.editReply({ content: `🔓 Unlocked ${affected} text channels for @everyone.` });
    },

    async slowmode(interaction, bot, seconds, scope = 'here') {
        await interaction.deferReply({ ephemeral: true });
        let affected = 0;

        if (scope === 'all') {
            for (const [, channel] of interaction.guild.channels.cache) {
                if (channel.type !== ChannelType.GuildText) continue;
                try { await channel.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`); affected++; } catch {}
            }
        } else {
            const ch = interaction.channel;
            if (ch?.type === ChannelType.GuildText) {
                try { await ch.setRateLimitPerUser(seconds, `Set by ${interaction.user.tag}`); affected = 1; } catch {}
            }
        }

        return interaction.editReply({ content: `🐢 Slowmode ${seconds}s applied to ${affected} channel(s).` });
    },

    async nuke(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const ch = interaction.channel;
        if (!ch || ch.type !== ChannelType.GuildText) {
            return interaction.editReply({ content: '❌ Please use this in a text channel.' });
        }
        try {
            const position = ch.position;
            const parent = ch.parent;
            const newCh = await ch.clone({ reason: `Nuked by ${interaction.user.tag}` });
            await newCh.setPosition(position);
            if (parent) await newCh.setParent(parent.id);
            await ch.delete(`Nuked by ${interaction.user.tag}`);
            await newCh.send({ content: '💣 This channel has been nuked.' });
            return; // Original interaction is deleted with channel
        } catch (e) {
            return interaction.editReply({ content: '❌ Failed to nuke channel. Check my permissions.' });
        }
    },

    async auditPerms(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const dangerousPerms = [
            PermissionsBitField.Flags.Administrator,
            PermissionsBitField.Flags.ManageGuild,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageRoles,
            PermissionsBitField.Flags.MentionEveryone
        ];

        const riskyRoles = guild.roles.cache
            .filter(r => dangerousPerms.some(p => r.permissions.has(p)) && !r.managed)
            .sort((a,b) => b.position - a.position)
            .map(r => `${r} - ${r.permissions.toArray().filter(p => dangerousPerms.includes(PermissionsBitField.Flags[p]) ).length} critical perms`)
            .slice(0, 20);

        const openChannels = guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildText)
            .filter(ch => {
                const ow = ch.permissionOverwrites.cache.get(guild.roles.everyone.id);
                return ow?.allow.has(PermissionsBitField.Flags.SendMessages);
            })
            .map(ch => `${ch}`)
            .slice(0, 20);

        const embed = new EmbedBuilder()
            .setTitle('🔎 Permissions Audit')
            .setColor(0xffcc00)
            .addFields(
                { name: '⚠️ Roles with dangerous permissions', value: riskyRoles.length ? riskyRoles.join('\n') : 'None', inline: false },
                { name: '📣 Channels open to @everyone', value: openChannels.length ? openChannels.join('\n') : 'None', inline: false }
            )
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }
};

// =====================================================
// PERMISSIONS HANDLERS
// =====================================================
const permissionHandlers = {
    async setGroup(interaction, bot, group, roles) {
        if (!bot.permissionManager) {
            return interaction.editReply({ content: '❌ Permission system is not available.', ephemeral: true });
        }
        const roleIds = roles.map(r => r.id);
        await bot.permissionManager.setRoles(interaction.guild.id, 'group', group, roleIds);
        return interaction.editReply({ content: `✅ Allowed roles for group \`${group}\` updated: ${roles.map(r => r.toString()).join(', ')}` });
    },

    async setCommand(interaction, bot, name, roles) {
        if (!bot.permissionManager) {
            return interaction.editReply({ content: '❌ Permission system is not available.', ephemeral: true });
        }
        const roleIds = roles.map(r => r.id);
        await bot.permissionManager.setRoles(interaction.guild.id, 'command', name.toLowerCase(), roleIds);
        return interaction.editReply({ content: `✅ Allowed roles for command \`/${name}\` updated: ${roles.map(r => r.toString()).join(', ')}` });
    },

    async list(interaction, bot) {
        if (!bot.permissionManager) {
            return interaction.editReply({ content: '❌ Permission system is not available.', ephemeral: true });
        }
        const list = await bot.permissionManager.list(interaction.guild.id);
        if (list.length === 0) {
            return interaction.editReply({ content: 'ℹ️ No custom permission rules set. All commands follow default Discord permissions.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔐 Command Permission Rules')
            .setColor(0x00aa00)
            .setDescription('Members must have at least one of the allowed roles for a rule to use matching commands.')
            .addFields(
                list.map(item => ({
                    name: `${item.scope}: ${item.name}`,
                    value: item.roles.length ? item.roles.map(id => `<@&${id}>`).join(', ') : '`(no roles)`',
                    inline: false
                }))
            );

        return interaction.editReply({ embeds: [embed], ephemeral: true });
    },

    async clear(interaction, bot, scope = 'all', name = null) {
        if (!bot.permissionManager) {
            return interaction.editReply({ content: '❌ Permission system is not available.', ephemeral: true });
        }
        if (scope === 'all') {
            await bot.permissionManager.clear(interaction.guild.id);
            return interaction.editReply({ content: '🧹 Cleared all permission rules for this server.' });
        }
        await bot.permissionManager.clear(interaction.guild.id, scope, name);
        return interaction.editReply({ content: `🧹 Cleared ${scope} ${name ? '`' + name + '` ' : ''}rules.` });
    }
};

// =====================================================
// WELCOME HANDLERS
// =====================================================
const welcomeHandlers = {
    async setup(interaction, bot, channel, message) {
        await interaction.deferReply();
        
        const customMessage = message || 'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉';

        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
            return interaction.editReply({ content: '❌ I don\'t have permission to send messages in that channel!' });
        }

        // Ensure *_id column exists
        try { await bot.database.run('ALTER TABLE guild_configs ADD COLUMN welcome_channel_id TEXT'); } catch (_) {}

        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, welcome_enabled, welcome_channel, welcome_channel_id, welcome_message)
            VALUES (?, 1, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                welcome_enabled    = 1,
                welcome_channel    = excluded.welcome_channel,
                welcome_channel_id = excluded.welcome_channel_id,
                welcome_message    = excluded.welcome_message,
                updated_at         = CURRENT_TIMESTAMP
        `, [interaction.guild.id, channel.id, channel.id, customMessage]);

        try { await bot.database.invalidateConfigCache(interaction.guild.id); } catch (e) {}
        
        try {
            if (typeof bot.emitSettingChange === 'function') {
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'welcome_enabled', 1, null, 'security');
                await bot.emitSettingChange(interaction.guild.id, interaction.user.id, 'welcome_channel', channel.id, null, 'configuration');
            }
        } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Welcome System Enabled')
            .setDescription(`Welcome messages will be sent to ${channel}`)
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Message', value: `\`\`\`${customMessage}\`\`\``, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },

    async disable(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        await bot.database.run('UPDATE guild_configs SET welcome_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [interaction.guild.id]);
        try { await bot.database.invalidateConfigCache(interaction.guild.id); } catch (e) {}
        await interaction.editReply({ content: '⏸️ Welcome messages disabled.' });
    },

    async customize(interaction, bot, message, embedTitle, embedColor, imageUrl) {
        await interaction.deferReply();
        
        const config = await bot.database.get('SELECT welcome_channel FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!config || !config.welcome_channel) {
            return interaction.editReply({ content: '❌ Welcome system not set up yet! Use `/setup onboarding welcome setup` first.', ephemeral: true });
        }

        const customization = {
            message: message,
            embedTitle: embedTitle || null,
            embedColor: embedColor || '#00d4ff',
            imageUrl: imageUrl || null
        };

        await bot.database.run('UPDATE guild_configs SET welcome_message = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [JSON.stringify(customization), interaction.guild.id]);
        try { await bot.database.invalidateConfigCache(interaction.guild.id); } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('✅ Welcome Message Customized')
            .addFields({ name: 'Message', value: message });
        if (embedTitle) embed.addFields({ name: 'Embed Title', value: embedTitle, inline: true });
        if (embedColor) embed.addFields({ name: 'Color', value: embedColor, inline: true });
        await interaction.editReply({ embeds: [embed] });
    },

    async test(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const cfg = await bot.database.get('SELECT welcome_enabled, welcome_channel, welcome_message FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!cfg || !cfg.welcome_channel) return interaction.editReply({ content: '❌ Welcome system not set up yet!' });
        
        const channel = interaction.guild.channels.cache.get(cfg.welcome_channel);
        if (!channel) return interaction.editReply({ content: '❌ Welcome channel not found!' });

        const preview = formatWelcomeMessage(cfg.welcome_message || 'Welcome {user} to **{server}**!', interaction.member, interaction.guild);
        await channel.send(preview);
        await interaction.editReply({ content: `✅ Test welcome message sent to ${channel}!` });
    },

    async status(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const cfg = await bot.database.get('SELECT welcome_enabled, welcome_channel, welcome_message FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        
        const embed = new EmbedBuilder()
            .setColor(cfg?.welcome_enabled ? '#00d4ff' : '#6b7280')
            .setTitle('📋 Welcome System Status')
            .setTimestamp();
            
        if (!cfg || !cfg.welcome_channel) {
            embed.setDescription('❌ Not configured').addFields({ name: 'Setup', value: 'Use `/setup onboarding welcome setup`' });
        } else {
            const channel = interaction.guild.channels.cache.get(cfg.welcome_channel);
            let messagePreview = cfg.welcome_message;
            try { const parsed = JSON.parse(cfg.welcome_message); messagePreview = parsed.message || messagePreview; } catch {}
            embed.setDescription(cfg.welcome_enabled ? '✅ Enabled' : '⏸️ Disabled')
                .addFields(
                    { name: 'Channel', value: channel ? `${channel}` : '❌ Not Found', inline: true },
                    { name: 'Message', value: `\`\`\`${(messagePreview || '').substring(0,150)}\`\`\``, inline: false }
                );
        }
        await interaction.editReply({ embeds: [embed] });
    }
};

// =====================================================
// GOODBYE HANDLERS
// =====================================================
const goodbyeHandlers = {
    async setup(interaction, bot, channel, message) {
        await interaction.deferReply();
        
        const customMessage = message || 'Goodbye {user}, thanks for being part of **{server}**!';

        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
            return interaction.editReply({ content: '❌ I don\'t have permission to send messages in that channel!' });
        }

        // Ensure columns exist
        try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_enabled BOOLEAN DEFAULT 0`); } catch (_) {}
        try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_channel TEXT`); } catch (_) {}
        try { await bot.database.run(`ALTER TABLE guild_configs ADD COLUMN goodbye_message TEXT`); } catch (_) {}

        // Ensure *_id column exists
        try { await bot.database.run('ALTER TABLE guild_configs ADD COLUMN goodbye_channel_id TEXT'); } catch (_) {}

        await bot.database.run(`
            INSERT INTO guild_configs (guild_id, goodbye_enabled, goodbye_channel, goodbye_channel_id, goodbye_message)
            VALUES (?, 1, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET
                goodbye_enabled    = 1,
                goodbye_channel    = excluded.goodbye_channel,
                goodbye_channel_id = excluded.goodbye_channel_id,
                goodbye_message    = excluded.goodbye_message,
                updated_at         = CURRENT_TIMESTAMP
        `, [interaction.guild.id, channel.id, channel.id, customMessage]);

        try { await bot.database.invalidateConfigCache(interaction.guild.id); } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setTitle('✅ Goodbye System Enabled')
            .setDescription(`Goodbye messages will be sent to ${channel}`)
            .addFields(
                { name: 'Channel', value: `${channel}`, inline: true },
                { name: 'Message', value: `\`\`\`${customMessage}\`\`\``, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },

    async disable(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        await bot.database.run('UPDATE guild_configs SET goodbye_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [interaction.guild.id]);
        try { await bot.database.invalidateConfigCache(interaction.guild.id); } catch (e) {}
        await interaction.editReply({ content: '⏸️ Goodbye messages disabled.' });
    },

    async customize(interaction, bot, message, embedTitle, embedColor, imageUrl) {
        await interaction.deferReply();
        
        const config = await bot.database.get('SELECT goodbye_channel FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!config || !config.goodbye_channel) {
            return interaction.editReply({ content: '❌ Goodbye system not set up yet! Use `/setup onboarding goodbye setup` first.', ephemeral: true });
        }

        const customization = {
            message: message,
            embedTitle: embedTitle || null,
            embedColor: embedColor || '#ff6b6b',
            imageUrl: imageUrl || null
        };

        await bot.database.run('UPDATE guild_configs SET goodbye_message = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?', [JSON.stringify(customization), interaction.guild.id]);
        try { await bot.database.invalidateConfigCache(interaction.guild.id); } catch (e) {}

        const embed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setTitle('✅ Goodbye Message Customized')
            .addFields({ name: 'Message', value: message });
        if (embedTitle) embed.addFields({ name: 'Embed Title', value: embedTitle, inline: true });
        if (embedColor) embed.addFields({ name: 'Color', value: embedColor, inline: true });
        await interaction.editReply({ embeds: [embed] });
    },

    async test(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const cfg = await bot.database.get('SELECT goodbye_enabled, goodbye_channel, goodbye_message FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        if (!cfg || !cfg.goodbye_channel) return interaction.editReply({ content: '❌ Goodbye system not set up yet!' });
        
        const channel = interaction.guild.channels.cache.get(cfg.goodbye_channel);
        if (!channel) return interaction.editReply({ content: '❌ Goodbye channel not found!' });

        const preview = formatGoodbyeMessage(cfg.goodbye_message || 'Goodbye {user}, thanks for being part of **{server}**!', interaction.member, interaction.guild);
        await channel.send(preview);
        await interaction.editReply({ content: `✅ Test goodbye message sent to ${channel}!` });
    },

    async status(interaction, bot) {
        await interaction.deferReply({ ephemeral: true });
        const cfg = await bot.database.get('SELECT goodbye_enabled, goodbye_channel, goodbye_message FROM guild_configs WHERE guild_id = ?', [interaction.guild.id]);
        
        const embed = new EmbedBuilder()
            .setColor(cfg?.goodbye_enabled ? '#ff6b6b' : '#6b7280')
            .setTitle('📋 Goodbye System Status')
            .setTimestamp();
            
        if (!cfg || !cfg.goodbye_channel) {
            embed.setDescription('❌ Not configured').addFields({ name: 'Setup', value: 'Use `/setup onboarding goodbye setup`' });
        } else {
            const channel = interaction.guild.channels.cache.get(cfg.goodbye_channel);
            let messagePreview = cfg.goodbye_message;
            try { const parsed = JSON.parse(cfg.goodbye_message); messagePreview = parsed.message || messagePreview; } catch {}
            embed.setDescription(cfg.goodbye_enabled ? '✅ Enabled' : '⏸️ Disabled')
                .addFields(
                    { name: 'Channel', value: channel ? `${channel}` : '❌ Not Found', inline: true },
                    { name: 'Message', value: `\`\`\`${(messagePreview || '').substring(0,150)}\`\`\``, inline: false }
                );
        }
        await interaction.editReply({ embeds: [embed] });
    }
};

// =====================================================
// ROLESCAN HANDLERS (Absorbed into /admin audit)
// =====================================================
const DANGEROUS_PERMISSIONS = {
    Administrator: { flag: PermissionsBitField.Flags.Administrator, severity: 'CRITICAL', emoji: '🔴' },
    ManageGuild: { flag: PermissionsBitField.Flags.ManageGuild, severity: 'CRITICAL', emoji: '🔴' },
    ManageRoles: { flag: PermissionsBitField.Flags.ManageRoles, severity: 'CRITICAL', emoji: '🔴' },
    BanMembers: { flag: PermissionsBitField.Flags.BanMembers, severity: 'HIGH', emoji: '🟠' },
    KickMembers: { flag: PermissionsBitField.Flags.KickMembers, severity: 'HIGH', emoji: '🟠' },
    ManageChannels: { flag: PermissionsBitField.Flags.ManageChannels, severity: 'HIGH', emoji: '🟠' },
    ManageWebhooks: { flag: PermissionsBitField.Flags.ManageWebhooks, severity: 'HIGH', emoji: '🟠' },
    MentionEveryone: { flag: PermissionsBitField.Flags.MentionEveryone, severity: 'MEDIUM', emoji: '🟡' },
    ManageMessages: { flag: PermissionsBitField.Flags.ManageMessages, severity: 'MEDIUM', emoji: '🟡' },
    ModerateMembers: { flag: PermissionsBitField.Flags.ModerateMembers, severity: 'MEDIUM', emoji: '🟡' }
};
const SEVERITY_ORDER = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };

const rolescanHandlers = {
    async scan(interaction, bot, minSeverity = 'MEDIUM', includeBots = false) {
        await interaction.deferReply({ ephemeral: true });
        
        const guild = interaction.guild;
        const botMember = guild.members.me;
        const results = [];

        for (const [roleId, role] of guild.roles.cache) {
            if (role.id === guild.id) continue; // Skip @everyone
            if (!includeBots && role.managed) continue;
            if (role.position >= botMember.roles.highest.position) continue;

            const dangerousPerms = [];
            for (const [permName, permData] of Object.entries(DANGEROUS_PERMISSIONS)) {
                if (SEVERITY_ORDER[permData.severity] > SEVERITY_ORDER[minSeverity]) continue;
                if (role.permissions.has(permData.flag)) {
                    dangerousPerms.push({ name: permName, ...permData });
                }
            }

            if (dangerousPerms.length > 0) {
                dangerousPerms.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
                results.push({
                    role,
                    permissions: dangerousPerms,
                    highestSeverity: dangerousPerms[0].severity,
                    memberCount: role.members.size
                });
            }
        }

        if (results.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('✅ Role Security Scan Complete')
                .setDescription('No roles with dangerous permissions found!')
                .setColor(0x00ff00)
                .addFields({
                    name: '📊 Scan Parameters',
                    value: `**Severity:** ${minSeverity} | **Bot Roles:** ${includeBots ? 'Yes' : 'No'} | **Scanned:** ${guild.roles.cache.size - 1}`
                })
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        results.sort((a, b) => {
            const severityDiff = SEVERITY_ORDER[a.highestSeverity] - SEVERITY_ORDER[b.highestSeverity];
            return severityDiff !== 0 ? severityDiff : b.memberCount - a.memberCount;
        });

        const criticalCount = results.filter(r => r.highestSeverity === 'CRITICAL').length;
        const highCount = results.filter(r => r.highestSeverity === 'HIGH').length;
        const mediumCount = results.filter(r => r.highestSeverity === 'MEDIUM').length;

        const roleList = results.slice(0, 15).map(r => {
            const emoji = r.highestSeverity === 'CRITICAL' ? '🔴' : r.highestSeverity === 'HIGH' ? '🟠' : '🟡';
            return `${emoji} ${r.role} (${r.permissions.length} perms, ${r.memberCount} members)`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Role Security Scan Results')
            .setDescription(`Found **${results.length} roles** with dangerous permissions`)
            .setColor(criticalCount > 0 ? 0xff0000 : (highCount > 0 ? 0xff8800 : 0xffff00))
            .addFields(
                { name: '📊 Severity Breakdown', value: `🔴 Critical: ${criticalCount}\n🟠 High: ${highCount}\n🟡 Medium: ${mediumCount}`, inline: true },
                { name: '🎯 Risky Roles', value: roleList || 'None', inline: false }
            )
            .setFooter({ text: 'Review these roles and remove unnecessary permissions' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};

// =====================================================
// MESSAGE FORMAT HELPERS
// =====================================================
function formatWelcomeMessage(configMessage, member, guild) {
    let customization;
    try { customization = JSON.parse(configMessage); } catch { customization = { message: configMessage }; }
    
    const message = (customization.message || 'Welcome {user} to **{server}**!')
        .replace(/{user}/g, member.user.toString())
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, guild.name)
        .replace(/{memberCount}/g, guild.memberCount.toString());
        
    if (customization.embedTitle || customization.embedColor || customization.imageUrl) {
        const embed = new EmbedBuilder()
            .setColor(customization.embedColor || '#00d4ff')
            .setDescription(message)
            .setTimestamp();
        if (customization.embedTitle) embed.setTitle(customization.embedTitle);
        if (customization.imageUrl) embed.setImage(customization.imageUrl);
        return { embeds: [embed] };
    }
    return { content: message };
}

function formatGoodbyeMessage(configMessage, member, guild) {
    let customization;
    try { customization = JSON.parse(configMessage); } catch { customization = { message: configMessage }; }
    
    const message = (customization.message || 'Goodbye {user}, thanks for being part of **{server}**!')
        .replace(/{user}/g, member.user.username)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, guild.name)
        .replace(/{memberCount}/g, guild.memberCount.toString());
        
    if (customization.embedTitle || customization.embedColor || customization.imageUrl) {
        const embed = new EmbedBuilder()
            .setColor(customization.embedColor || '#ff6b6b')
            .setDescription(message)
            .setTimestamp();
        if (customization.embedTitle) embed.setTitle(customization.embedTitle);
        if (customization.imageUrl) embed.setImage(customization.imageUrl);
        return { embeds: [embed] };
    }
    return { content: message };
}

// =====================================================
// DEPRECATION HELPER
// =====================================================
function getDeprecationNotice(oldCommand, newCommand) {
    return `⚠️ **Command Moved:** \`/${oldCommand}\` → \`${newCommand}\`\n_Old command will be removed in a future update._\n\n`;
}

module.exports = {
    wizardHandlers,
    onboardingHandlers,
    autoroleHandlers,
    serverControlHandlers,
    permissionHandlers,
    welcomeHandlers,
    goodbyeHandlers,
    rolescanHandlers,
    formatWelcomeMessage,
    formatGoodbyeMessage,
    getDeprecationNotice
};
