const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('webhookprotect')
        .setDescription('Webhook protection management')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Setup webhook protection')
            .addChannelOption(opt => opt
                .setName('log_channel')
                .setDescription('Channel for webhook logs'))
            .addIntegerOption(opt => opt
                .setName('rate_limit')
                .setDescription('Max messages per window (default 10)')
                .setMinValue(1)
                .setMaxValue(100))
            .addIntegerOption(opt => opt
                .setName('rate_window')
                .setDescription('Time window in seconds (default 60)')
                .setMinValue(10)
                .setMaxValue(3600)))
        .addSubcommand(sub => sub
            .setName('config')
            .setDescription('View or update configuration')
            .addBooleanOption(opt => opt
                .setName('auto_delete')
                .setDescription('Auto-delete spam messages'))
            .addBooleanOption(opt => opt
                .setName('notify_create')
                .setDescription('Notify when webhooks are created'))
            .addBooleanOption(opt => opt
                .setName('notify_delete')
                .setDescription('Notify when webhooks are deleted')))
        .addSubcommand(sub => sub
            .setName('whitelist')
            .setDescription('Add a webhook to the whitelist')
            .addStringOption(opt => opt
                .setName('webhook_id')
                .setDescription('Webhook ID to whitelist')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for whitelisting')))
        .addSubcommand(sub => sub
            .setName('unwhitelist')
            .setDescription('Remove a webhook from the whitelist')
            .addStringOption(opt => opt
                .setName('webhook_id')
                .setDescription('Webhook ID to remove')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List whitelisted webhooks'))
        .addSubcommand(sub => sub
            .setName('scan')
            .setDescription('Scan all webhooks in the server'))
        .addSubcommand(sub => sub
            .setName('activity')
            .setDescription('View recent webhook activity'))
        .addSubcommand(sub => sub
            .setName('delete')
            .setDescription('Delete a webhook')
            .addStringOption(opt => opt
                .setName('webhook_id')
                .setDescription('Webhook ID to delete')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('reason')
                .setDescription('Reason for deletion'))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const webhookProtect = interaction.client.webhookProtection;

        if (!webhookProtect) {
            return interaction.reply({ content: '❌ Webhook protection is not initialized.', ephemeral: true });
        }

        switch (sub) {
            case 'setup':
                return this.handleSetup(interaction, webhookProtect);
            case 'config':
                return this.handleConfig(interaction, webhookProtect);
            case 'whitelist':
                return this.handleWhitelist(interaction, webhookProtect);
            case 'unwhitelist':
                return this.handleUnwhitelist(interaction, webhookProtect);
            case 'list':
                return this.handleList(interaction, webhookProtect);
            case 'scan':
                return this.handleScan(interaction, webhookProtect);
            case 'activity':
                return this.handleActivity(interaction, webhookProtect);
            case 'delete':
                return this.handleDelete(interaction, webhookProtect);
        }
    },

    async handleSetup(interaction, webhookProtect) {
        const logChannel = interaction.options.getChannel('log_channel');
        const rateLimit = interaction.options.getInteger('rate_limit');
        const rateWindow = interaction.options.getInteger('rate_window');

        await interaction.deferReply();

        await webhookProtect.setup(interaction.guildId, {
            logChannelId: logChannel?.id,
            rateLimit: rateLimit || 10,
            rateWindow: rateWindow || 60
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Webhook Protection Setup')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Log Channel', value: logChannel ? `<#${logChannel.id}>` : 'Not set', inline: true },
                { name: 'Rate Limit', value: `${rateLimit || 10} messages`, inline: true },
                { name: 'Time Window', value: `${rateWindow || 60} seconds`, inline: true }
            )
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    },

    async handleConfig(interaction, webhookProtect) {
        const autoDelete = interaction.options.getBoolean('auto_delete');
        const notifyCreate = interaction.options.getBoolean('notify_create');
        const notifyDelete = interaction.options.getBoolean('notify_delete');

        await interaction.deferReply();

        if (autoDelete === null && notifyCreate === null && notifyDelete === null) {
            // Show current config
            const config = await webhookProtect.getConfig(interaction.guildId);

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Webhook Protection Config')
                .setColor(0x5865F2)
                .setTimestamp();

            if (!config) {
                embed.setDescription('Webhook protection is not configured. Use `/webhookprotect setup` first.');
            } else {
                embed.addFields(
                    { name: 'Enabled', value: config.enabled ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Auto-Delete Spam', value: config.auto_delete_spam ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Rate Limit', value: `${config.rate_limit} / ${config.rate_window}s`, inline: true },
                    { name: 'Notify on Create', value: config.notify_on_create ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Notify on Delete', value: config.notify_on_delete ? '✅ Yes' : '❌ No', inline: true },
                    { name: 'Log Channel', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true }
                );
            }

            return interaction.editReply({ embeds: [embed] });
        }

        const settings = {};
        if (autoDelete !== null) settings.auto_delete_spam = autoDelete;
        if (notifyCreate !== null) settings.notify_on_create = notifyCreate;
        if (notifyDelete !== null) settings.notify_on_delete = notifyDelete;

        await webhookProtect.updateConfig(interaction.guildId, settings);

        const embed = new EmbedBuilder()
            .setTitle('✅ Configuration Updated')
            .setColor(0x00FF00)
            .setTimestamp();

        const changes = [];
        if (autoDelete !== null) changes.push(`Auto-delete spam: ${autoDelete ? '✅' : '❌'}`);
        if (notifyCreate !== null) changes.push(`Notify on create: ${notifyCreate ? '✅' : '❌'}`);
        if (notifyDelete !== null) changes.push(`Notify on delete: ${notifyDelete ? '✅' : '❌'}`);

        embed.setDescription(changes.join('\n'));

        return interaction.editReply({ embeds: [embed] });
    },

    async handleWhitelist(interaction, webhookProtect) {
        const webhookId = interaction.options.getString('webhook_id');
        const reason = interaction.options.getString('reason');

        await interaction.deferReply();

        await webhookProtect.whitelistWebhook(interaction.guildId, webhookId, {
            addedBy: interaction.user.id,
            reason
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Webhook Whitelisted')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Webhook ID', value: webhookId, inline: true }
            )
            .setTimestamp();

        if (reason) {
            embed.addFields({ name: 'Reason', value: reason, inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleUnwhitelist(interaction, webhookProtect) {
        const webhookId = interaction.options.getString('webhook_id');

        await interaction.deferReply();

        const removed = await webhookProtect.removeFromWhitelist(interaction.guildId, webhookId);

        if (removed) {
            return interaction.editReply({ content: `✅ Webhook \`${webhookId}\` removed from whitelist.` });
        } else {
            return interaction.editReply({ content: `❌ Webhook not found in whitelist.` });
        }
    },

    async handleList(interaction, webhookProtect) {
        await interaction.deferReply();

        const whitelist = await webhookProtect.getWhitelist(interaction.guildId);

        const embed = new EmbedBuilder()
            .setTitle('📋 Whitelisted Webhooks')
            .setColor(0x5865F2)
            .setTimestamp();

        if (whitelist.length === 0) {
            embed.setDescription('No webhooks are whitelisted.');
        } else {
            const list = whitelist.map((w, i) => {
                const line = `**${i + 1}.** \`${w.webhook_id}\``;
                return w.webhook_name ? `${line} (${w.webhook_name})` : line;
            }).join('\n');

            embed.setDescription(list);
            embed.setFooter({ text: `Total: ${whitelist.length} webhook(s)` });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleScan(interaction, webhookProtect) {
        await interaction.deferReply();

        const webhooks = await webhookProtect.scanGuildWebhooks(interaction.guild);

        const embed = new EmbedBuilder()
            .setTitle('🔍 Webhook Scan Results')
            .setColor(0x5865F2)
            .setTimestamp();

        if (webhooks.length === 0) {
            embed.setDescription('No webhooks found in this server.');
        } else {
            const list = webhooks.slice(0, 15).map((w, i) => {
                const owner = w.owner ? `<@${w.owner}>` : 'Unknown';
                return `**${i + 1}.** ${w.name}\n↳ ID: \`${w.id}\` • Channel: <#${w.channelId}> • Owner: ${owner}`;
            }).join('\n\n');

            embed.setDescription(list);
            embed.setFooter({ text: `Total: ${webhooks.length} webhook(s)` });
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleActivity(interaction, webhookProtect) {
        await interaction.deferReply();

        const activity = await webhookProtect.getActivityLog(interaction.guildId, 15);

        const embed = new EmbedBuilder()
            .setTitle('📊 Recent Webhook Activity')
            .setColor(0x5865F2)
            .setTimestamp();

        if (activity.length === 0) {
            embed.setDescription('No recent webhook activity.');
        } else {
            const list = activity.map((a, i) => {
                const time = `<t:${Math.floor(new Date(a.created_at).getTime() / 1000)}:R>`;
                return `**${i + 1}.** ${a.action_type}\n↳ ${a.webhook_name || a.webhook_id || 'Unknown'} • ${time}`;
            }).join('\n\n');

            embed.setDescription(list);
        }

        return interaction.editReply({ embeds: [embed] });
    },

    async handleDelete(interaction, webhookProtect) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Only administrators can delete webhooks.', ephemeral: true });
        }

        const webhookId = interaction.options.getString('webhook_id');
        const reason = interaction.options.getString('reason') || 'Deleted via command';

        await interaction.deferReply();

        const result = await webhookProtect.deleteWebhook(interaction.guild, webhookId, reason);

        if (result.success) {
            return interaction.editReply({ content: `✅ Webhook \`${webhookId}\` deleted.` });
        } else {
            return interaction.editReply({ content: `❌ Failed to delete webhook: ${result.error}` });
        }
    }
};
