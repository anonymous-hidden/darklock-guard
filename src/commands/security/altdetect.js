const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('altdetect')
        .setDescription('Alt account detection commands (v2.0)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Setup alt detection')
                .addChannelOption(opt =>
                    opt.setName('log_channel')
                        .setDescription('Channel to log detections')
                        .setRequired(true)
                )
                .addRoleOption(opt =>
                    opt.setName('quarantine_role')
                        .setDescription('Role to give suspected alts')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable alt detection')
                .addBooleanOption(opt =>
                    opt.setName('enabled')
                        .setDescription('Enable or disable')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('action')
                .setDescription('Set the action for detected alts')
                .addStringOption(opt =>
                    opt.setName('action')
                        .setDescription('Action to take')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Alert Only', value: 'alert' },
                            { name: 'Quarantine', value: 'quarantine' },
                            { name: 'Kick', value: 'kick' },
                            { name: 'Ban', value: 'ban' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('minage')
                .setDescription('Set minimum account age (days)')
                .addIntegerOption(opt =>
                    opt.setName('days')
                        .setDescription('Minimum account age in days')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(365)
                )
        )
        .addSubcommand(sub =>
            sub.setName('threshold')
                .setDescription('Set detection thresholds')
                .addNumberOption(opt =>
                    opt.setName('alert')
                        .setDescription('Alert threshold (0.0-1.0, default 0.35)')
                        .setRequired(false)
                        .setMinValue(0.1)
                        .setMaxValue(0.9)
                )
                .addNumberOption(opt =>
                    opt.setName('action')
                        .setDescription('Action threshold (0.0-1.0, default 0.60)')
                        .setRequired(false)
                        .setMinValue(0.2)
                        .setMaxValue(0.95)
                )
        )
        .addSubcommand(sub =>
            sub.setName('check')
                .setDescription('Manually check a user for alt indicators')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to check')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('link')
                .setDescription('Manually link two accounts as alts')
                .addUserOption(opt =>
                    opt.setName('user1')
                        .setDescription('First user (original account)')
                        .setRequired(true)
                )
                .addUserOption(opt =>
                    opt.setName('user2')
                        .setDescription('Second user (the alt)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('alts')
                .setDescription('View known alts of a user')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to check')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('detections')
                .setDescription('View recent alt detections')
        )
        .addSubcommand(sub =>
            sub.setName('review')
                .setDescription('Mark a detection as reviewed (correct or false positive)')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('User to mark as reviewed')
                        .setRequired(true)
                )
                .addBooleanOption(opt =>
                    opt.setName('was_alt')
                        .setDescription('Was this actually an alt? (for calibration)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('calibrate')
                .setDescription('View detection accuracy and suggested thresholds')
        )
        .addSubcommand(sub =>
            sub.setName('config')
                .setDescription('View current alt detection configuration')
        )
        .addSubcommand(sub =>
            sub.setName('signals')
                .setDescription('View signal weights and confidence levels')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const detector = interaction.client.altDetector;

        if (!detector) {
            return interaction.reply({
                content: '❌ Alt detection system is not available.',
                ephemeral: true
            });
        }

        switch (subcommand) {
            case 'setup':
                return this.setup(interaction, detector);
            case 'toggle':
                return this.toggle(interaction, detector);
            case 'action':
                return this.setAction(interaction, detector);
            case 'minage':
                return this.setMinAge(interaction, detector);
            case 'threshold':
                return this.setThreshold(interaction, detector);
            case 'check':
                return this.checkUser(interaction, detector);
            case 'link':
                return this.linkAccounts(interaction, detector);
            case 'alts':
                return this.viewAlts(interaction, detector);
            case 'detections':
                return this.viewDetections(interaction, detector);
            case 'review':
                return this.markReviewed(interaction, detector);
            case 'calibrate':
                return this.viewCalibration(interaction, detector);
            case 'config':
                return this.viewConfig(interaction, detector);
            case 'signals':
                return this.viewSignals(interaction, detector);
        }
    },

    async setup(interaction, detector) {
        const logChannel = interaction.options.getChannel('log_channel');
        const quarantineRole = interaction.options.getRole('quarantine_role');

        await detector.setEnabled(interaction.guild.id, true);
        await detector.updateConfig(interaction.guild.id, {
            log_channel_id: logChannel.id,
            quarantine_role_id: quarantineRole?.id || null
        });

        const embed = new EmbedBuilder()
            .setTitle('✅ Alt Detection v2.0 Configured')
            .setColor(0x00FF00)
            .addFields(
                { name: 'Log Channel', value: `${logChannel}`, inline: true },
                { name: 'Quarantine Role', value: quarantineRole ? `${quarantineRole}` : 'Not set', inline: true },
                { name: 'Status', value: '✅ Enabled', inline: true }
            )
            .setDescription('**New in v2.0:**\n• Bigram-based username similarity\n• Post-ban timing correlation\n• Wave detection for coordinated attacks\n• Behavior fingerprinting\n• Time decay on old fingerprints\n• Feedback loop calibration')
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async toggle(interaction, detector) {
        const enabled = interaction.options.getBoolean('enabled');
        await detector.setEnabled(interaction.guild.id, enabled);

        await interaction.reply({
            content: `✅ Alt detection has been **${enabled ? 'enabled' : 'disabled'}**.`,
            ephemeral: true
        });
    },

    async setAction(interaction, detector) {
        const action = interaction.options.getString('action');
        await detector.updateConfig(interaction.guild.id, { auto_action: action });

        const actionNames = {
            'alert': 'Alert Only (no automatic action)',
            'quarantine': 'Quarantine (assign quarantine role)',
            'kick': 'Kick suspected alts',
            'ban': 'Ban suspected alts'
        };

        await interaction.reply({
            content: `✅ Action for detected alts set to: **${actionNames[action]}**\n\nNote: Actions only trigger when confidence exceeds the action threshold (default 60%).`,
            ephemeral: true
        });
    },

    async setMinAge(interaction, detector) {
        const days = interaction.options.getInteger('days');
        await detector.updateConfig(interaction.guild.id, { min_account_age_days: days });

        await interaction.reply({
            content: `✅ Minimum account age set to **${days} days**.\nAccounts younger than this will receive a low-confidence flag.`,
            ephemeral: true
        });
    },

    async setThreshold(interaction, detector) {
        const alertThreshold = interaction.options.getNumber('alert');
        const actionThreshold = interaction.options.getNumber('action');

        const updates = {};
        if (alertThreshold !== null) updates.alert_threshold = alertThreshold;
        if (actionThreshold !== null) updates.action_threshold = actionThreshold;

        if (Object.keys(updates).length === 0) {
            return interaction.reply({
                content: '❌ Please provide at least one threshold value.',
                ephemeral: true
            });
        }

        await detector.updateConfig(interaction.guild.id, updates);

        let response = '✅ Thresholds updated:\n';
        if (alertThreshold !== null) {
            response += `• Alert threshold: **${Math.round(alertThreshold * 100)}%** (users above this get flagged)\n`;
        }
        if (actionThreshold !== null) {
            response += `• Action threshold: **${Math.round(actionThreshold * 100)}%** (users above this trigger auto-action)\n`;
        }
        response += '\n💡 Use `/altdetect calibrate` to see suggested thresholds based on your review history.';

        await interaction.reply({ content: response, ephemeral: true });
    },

    async checkUser(interaction, detector) {
        await interaction.deferReply();

        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
            return interaction.editReply({ content: '❌ User not found in this server.' });
        }

        // Get any existing detection data
        const detections = await detector.getDetectedAlts(interaction.guild.id);
        const userDetection = detections.find(d => d.alt_user_id === user.id);

        const accountAgeDays = Math.floor((Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24));
        const pattern = detector.extractPattern(user.username);
        
        const embed = new EmbedBuilder()
            .setTitle(`🔍 Alt Check: ${user.tag}`)
            .setColor(userDetection ? 0xFFA500 : 0x00FF00)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'User ID', value: user.id, inline: true },
                { name: 'Account Age', value: `${accountAgeDays} days`, inline: true },
                { name: 'Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Avatar Hash', value: user.avatar || 'None (default)', inline: true }
            );

        // Show fingerprint analysis
        if (pattern) {
            embed.addFields({
                name: '🔬 Fingerprint Analysis',
                value: [
                    `**Letters:** \`${pattern.letters || 'none'}\``,
                    `**Numbers:** \`${pattern.numbers || 'none'}\``,
                    `**Structure:** \`${pattern.structure || 'none'}\``,
                    `**Length:** ${pattern.length}`,
                    `**Bigrams:** ${pattern.bigrams?.length || 0}`,
                    `**Decorators:** ${pattern.startsWithDecorator ? 'Start ' : ''}${pattern.endsWithDecorator ? 'End ' : ''}${pattern.endsWithNumbers ? 'Numbers' : ''}`.trim() || 'None'
                ].join('\n'),
                inline: false
            });
        }

        if (userDetection) {
            const reasons = JSON.parse(userDetection.detection_reasons || '[]');
            const signalBreakdown = JSON.parse(userDetection.signal_breakdown || '[]');
            
            embed.addFields(
                { 
                    name: '⚠️ Previous Detection', 
                    value: `Confidence: **${Math.round(userDetection.confidence_score * 100)}%**\nReviewed: ${userDetection.reviewed ? '✅ Yes' : '⏳ Pending'}\nWas Alt: ${userDetection.was_correct === 1 ? '✅ Confirmed' : userDetection.was_correct === 0 ? '❌ False Positive' : '❓ Unknown'}`, 
                    inline: false 
                }
            );
            
            if (signalBreakdown.length > 0) {
                const breakdown = signalBreakdown.map(s => {
                    const icon = s.confidence === 'high' ? '🔴' : s.confidence === 'medium' ? '🟡' : '🟢';
                    return `${icon} ${s.name}: +${Math.round(s.score * 100)}%`;
                }).join('\n');
                embed.addFields({ name: 'Signal Breakdown', value: breakdown, inline: false });
            }
        } else {
            // Run a live check
            const result = await detector.checkNewMember(member);
            if (result && result.flagged) {
                const breakdown = result.signals.map(s => {
                    const icon = s.confidence === 'high' ? '🔴' : s.confidence === 'medium' ? '🟡' : '🟢';
                    return `${icon} ${s.reason} (+${Math.round(s.score * 100)}%)`;
                }).join('\n');
                
                embed.addFields(
                    { name: '⚠️ Live Analysis Result', value: `Confidence: **${Math.round(result.confidence * 100)}%**\nWave Factor: ${result.waveFactor}x`, inline: false },
                    { name: 'Signals Detected', value: breakdown || 'None', inline: false }
                );
                embed.setColor(0xFFA500);
            } else {
                embed.addFields({ name: '✅ Live Analysis', value: 'No significant alt indicators found.', inline: false });
            }
        }

        await interaction.editReply({ embeds: [embed] });
    },

    async linkAccounts(interaction, detector) {
        const user1 = interaction.options.getUser('user1');
        const user2 = interaction.options.getUser('user2');

        if (user1.id === user2.id) {
            return interaction.reply({
                content: '❌ Cannot link a user to themselves.',
                ephemeral: true
            });
        }

        await detector.linkAccounts(interaction.guild.id, user2.id, user1.id, interaction.user.id);

        await interaction.reply({
            content: `✅ Linked **${user2.tag}** as an alt of **${user1.tag}**.\n\nThis has been marked as a confirmed alt (contributes to calibration).`,
            ephemeral: true
        });
    },

    async viewAlts(interaction, detector) {
        const user = interaction.options.getUser('user');
        const alts = await detector.getKnownAlts(interaction.guild.id, user.id);

        if (alts.length === 0) {
            return interaction.reply({
                content: `📋 No known alts for **${user.tag}**.`,
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`👥 Known Alts of ${user.tag}`)
            .setColor(0x5865F2)
            .setTimestamp();

        let description = '';
        for (const alt of alts) {
            const altId = alt.alt_user_id === user.id ? alt.linked_to_user_id : alt.alt_user_id;
            const confidence = Math.round(alt.confidence_score * 100);
            const status = alt.was_correct === 1 ? '✅' : alt.was_correct === 0 ? '❌' : '❓';
            description += `${status} <@${altId}> (\`${altId}\`)\n`;
            description += `   Confidence: ${confidence}% | Method: ${alt.action_taken || 'detected'}\n`;
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
    },

    async viewDetections(interaction, detector) {
        const detections = await detector.getDetectedAlts(interaction.guild.id, 25);

        if (detections.length === 0) {
            return interaction.reply({
                content: '📋 No alt detections recorded.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔍 Recent Alt Detections')
            .setColor(0xFFA500)
            .setTimestamp();

        let description = '';
        for (const det of detections.slice(0, 15)) {
            const reviewed = det.reviewed ? '✅' : '⏳';
            const result = det.was_correct === 1 ? ' (confirmed)' : det.was_correct === 0 ? ' (FP)' : '';
            const confidence = Math.round(det.confidence_score * 100);
            description += `${reviewed} <@${det.alt_user_id}> - **${confidence}%**${result}\n`;
            description += `   <t:${Math.floor(new Date(det.detected_at).getTime() / 1000)}:R> | Action: ${det.action_taken}\n`;
        }

        embed.setDescription(description);
        
        // Add stats
        const reviewed = detections.filter(d => d.reviewed).length;
        const confirmed = detections.filter(d => d.was_correct === 1).length;
        const falsePositives = detections.filter(d => d.was_correct === 0).length;
        
        embed.setFooter({ 
            text: `Total: ${detections.length} | Reviewed: ${reviewed} | Confirmed: ${confirmed} | False Positives: ${falsePositives}` 
        });

        await interaction.reply({ embeds: [embed] });
    },

    async markReviewed(interaction, detector) {
        const user = interaction.options.getUser('user');
        const wasAlt = interaction.options.getBoolean('was_alt');
        
        let success;
        if (wasAlt !== null) {
            success = await detector.markDetectionResult(interaction.guild.id, user.id, wasAlt, interaction.user.id);
        } else {
            success = await detector.markReviewed(interaction.guild.id, user.id, interaction.user.id);
        }

        if (success) {
            let msg = `✅ Marked **${user.tag}** detection as reviewed.`;
            if (wasAlt !== null) {
                msg += `\n${wasAlt ? '✅ Confirmed as alt - this improves detection accuracy.' : '❌ Marked as false positive - this helps reduce false alerts.'}`;
            }
            msg += '\n\n💡 Use `/altdetect calibrate` to see how your reviews affect suggested thresholds.';
            await interaction.reply({ content: msg, ephemeral: true });
        } else {
            await interaction.reply({
                content: `❌ No detection found for **${user.tag}**.`,
                ephemeral: true
            });
        }
    },

    async viewCalibration(interaction, detector) {
        await interaction.deferReply({ ephemeral: true });
        
        const stats = await detector.getCalibrationStats(interaction.guild.id);

        if (stats.totalReviewed === 0) {
            return interaction.editReply({
                content: '📊 **Calibration Data**\n\nNo reviewed detections yet. Use `/altdetect review` on past detections to build calibration data.\n\nOnce you have reviewed detections, this command will show:\n• False positive rates at different thresholds\n• Suggested threshold adjustments\n• Detection accuracy over time'
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Detection Calibration Analysis')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Total Reviewed', value: stats.totalReviewed.toString(), inline: true },
                { name: 'True Positives', value: stats.truePositives.toString(), inline: true },
                { name: 'False Positives', value: stats.falsePositives.toString(), inline: true },
                { name: 'Overall FP Rate', value: `${Math.round(stats.falsePositiveRate * 100)}%`, inline: true },
                { name: 'Suggested Threshold', value: stats.suggestedThreshold ? `${Math.round(stats.suggestedThreshold * 100)}%` : 'Need more data', inline: true }
            );

        // Threshold analysis table
        if (stats.thresholdAnalysis && stats.thresholdAnalysis.length > 0) {
            let table = '```\nThreshold | Flagged | TP | FP | FP Rate\n';
            table += '-'.repeat(45) + '\n';
            for (const t of stats.thresholdAnalysis) {
                if (t.flagged > 0) {
                    table += `${Math.round(t.threshold * 100).toString().padStart(5)}%    | ${t.flagged.toString().padStart(7)} | ${t.truePositives.toString().padStart(2)} | ${t.falsePositives.toString().padStart(2)} | ${Math.round(t.fpRate * 100)}%\n`;
                }
            }
            table += '```';
            embed.addFields({ name: 'Threshold Analysis', value: table, inline: false });
        }

        embed.setDescription('This analysis is based on your reviewed detections. Mark more detections as "was alt" or "false positive" to improve accuracy.');

        await interaction.editReply({ embeds: [embed] });
    },

    async viewConfig(interaction, detector) {
        const config = await detector.getConfig(interaction.guild.id);

        if (!config) {
            return interaction.reply({
                content: '❌ Alt detection is not configured. Use `/altdetect setup` first.',
                ephemeral: true
            });
        }

        const actionNames = {
            'alert': 'Alert Only',
            'quarantine': 'Quarantine',
            'kick': 'Kick',
            'ban': 'Ban'
        };

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Alt Detection Configuration (v2.0)')
            .setColor(0x5865F2)
            .addFields(
                { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: 'Auto Action', value: actionNames[config.auto_action] || 'Alert', inline: true },
                { name: 'Min Account Age', value: `${config.min_account_age_days} days`, inline: true },
                { name: 'Alert Threshold', value: `${Math.round((config.alert_threshold || 0.35) * 100)}%`, inline: true },
                { name: 'Action Threshold', value: `${Math.round((config.action_threshold || 0.60) * 100)}%`, inline: true },
                { name: 'Log Channel', value: config.log_channel_id ? `<#${config.log_channel_id}>` : 'Not set', inline: true },
                { name: 'Quarantine Role', value: config.quarantine_role_id ? `<@&${config.quarantine_role_id}>` : 'Not set', inline: true },
                { name: 'Checks Enabled', value: [
                    config.check_avatar_hash ? '✅ Avatar' : '❌ Avatar',
                    config.check_username_patterns ? '✅ Username' : '❌ Username',
                    config.check_join_timing ? '✅ Timing' : '❌ Timing',
                    config.check_behavior !== 0 ? '✅ Behavior' : '❌ Behavior'
                ].join(' | '), inline: false }
            )
            .setFooter({ text: 'Use /altdetect calibrate to see suggested threshold adjustments' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async viewSignals(interaction, detector) {
        const signals = detector.SIGNAL_WEIGHTS;

        const embed = new EmbedBuilder()
            .setTitle('📡 Alt Detection Signal Weights')
            .setColor(0x5865F2)
            .setDescription('These are the signals used to detect alt accounts. Confidence levels indicate reliability.\n\n🔴 High = Strong indicator\n🟡 Medium = Moderate indicator\n🟢 Low = Weak, needs corroboration');

        const highConf = [];
        const medConf = [];
        const lowConf = [];

        for (const [name, data] of Object.entries(signals)) {
            const line = `**${name}**: ${Math.round(data.base * 100)}% base weight`;
            if (data.confidence === 'high') highConf.push(line);
            else if (data.confidence === 'medium') medConf.push(line);
            else lowConf.push(line);
        }

        if (highConf.length) {
            embed.addFields({ name: '🔴 High Confidence', value: highConf.join('\n'), inline: false });
        }
        if (medConf.length) {
            embed.addFields({ name: '🟡 Medium Confidence', value: medConf.join('\n'), inline: false });
        }
        if (lowConf.length) {
            embed.addFields({ name: '🟢 Low Confidence', value: lowConf.join('\n'), inline: false });
        }

        embed.addFields({
            name: '⚠️ Important Notes',
            value: '• No single signal should trigger action alone\n• Scores decay over time (6-month half-life)\n• Wave detection multiplies scores during attack patterns\n• Behavior fingerprints require message history',
            inline: false
        });

        await interaction.reply({ embeds: [embed] });
    }
};
