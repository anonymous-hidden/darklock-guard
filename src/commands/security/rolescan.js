const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

/**
 * @deprecated This command has been absorbed into /admin audit
 * Use /admin audit type:roles instead
 */

// Dangerous permissions that could be exploited
const DANGEROUS_PERMISSIONS = {
    Administrator: {
        flag: PermissionFlagsBits.Administrator,
        severity: 'CRITICAL',
        description: 'Full control over the server',
        emoji: '🔴'
    },
    BanMembers: {
        flag: PermissionFlagsBits.BanMembers,
        severity: 'HIGH',
        description: 'Can permanently ban members',
        emoji: '🟠'
    },
    KickMembers: {
        flag: PermissionFlagsBits.KickMembers,
        severity: 'HIGH',
        description: 'Can kick members from server',
        emoji: '🟠'
    },
    ManageGuild: {
        flag: PermissionFlagsBits.ManageGuild,
        severity: 'CRITICAL',
        description: 'Can modify server settings',
        emoji: '🔴'
    },
    ManageRoles: {
        flag: PermissionFlagsBits.ManageRoles,
        severity: 'CRITICAL',
        description: 'Can create/delete/modify roles',
        emoji: '🔴'
    },
    ManageChannels: {
        flag: PermissionFlagsBits.ManageChannels,
        severity: 'HIGH',
        description: 'Can create/delete/modify channels',
        emoji: '🟠'
    },
    ManageWebhooks: {
        flag: PermissionFlagsBits.ManageWebhooks,
        severity: 'HIGH',
        description: 'Can create webhooks (potential spam vector)',
        emoji: '🟠'
    },
    ManageMessages: {
        flag: PermissionFlagsBits.ManageMessages,
        severity: 'MEDIUM',
        description: 'Can delete any message',
        emoji: '🟡'
    },
    MentionEveryone: {
        flag: PermissionFlagsBits.MentionEveryone,
        severity: 'MEDIUM',
        description: 'Can ping @everyone/@here',
        emoji: '🟡'
    },
    ManageNicknames: {
        flag: PermissionFlagsBits.ManageNicknames,
        severity: 'LOW',
        description: 'Can change member nicknames',
        emoji: '🟢'
    },
    ModerateMembers: {
        flag: PermissionFlagsBits.ModerateMembers,
        severity: 'MEDIUM',
        description: 'Can timeout members',
        emoji: '🟡'
    },
    ManageEmojisAndStickers: {
        flag: PermissionFlagsBits.ManageEmojisAndStickers,
        severity: 'LOW',
        description: 'Can manage server emojis',
        emoji: '🟢'
    },
    ManageEvents: {
        flag: PermissionFlagsBits.ManageEvents,
        severity: 'LOW',
        description: 'Can create/edit events',
        emoji: '🟢'
    },
    ManageThreads: {
        flag: PermissionFlagsBits.ManageThreads,
        severity: 'LOW',
        description: 'Can manage threads',
        emoji: '🟢'
    }
};

const SEVERITY_ORDER = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };

module.exports = {
    deprecated: true,
    newCommand: '/admin audit type:roles',
    
    data: new SlashCommandBuilder()
        .setName('rolescan')
        .setDescription('⚠️ DEPRECATED → Use /admin audit type:roles instead')
        .setDescription('Scan server roles for dangerous permissions')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('severity')
                .setDescription('Minimum severity level to report')
                .addChoices(
                    { name: '🔴 Critical Only', value: 'CRITICAL' },
                    { name: '🟠 High & Above', value: 'HIGH' },
                    { name: '🟡 Medium & Above', value: 'MEDIUM' },
                    { name: '🟢 All (Including Low)', value: 'LOW' }
                )
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('include_bots')
                .setDescription('Include bot roles in the scan')
                .setRequired(false)
        )
        .addRoleOption(option =>
            option.setName('exclude_role')
                .setDescription('Exclude a specific role from the scan')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const minSeverity = interaction.options.getString('severity') || 'MEDIUM';
        const includeBots = interaction.options.getBoolean('include_bots') ?? false;
        const excludeRole = interaction.options.getRole('exclude_role');
        
        const guild = interaction.guild;
        const botMember = guild.members.me;
        const results = [];

        // Scan all roles
        for (const [roleId, role] of guild.roles.cache) {
            // Skip @everyone role
            if (role.id === guild.id) continue;
            
            // Skip excluded role
            if (excludeRole && role.id === excludeRole.id) continue;
            
            // Skip bot roles if not including them
            if (!includeBots && role.managed) continue;
            
            // Skip roles higher than or equal to bot's highest role (can't modify them anyway)
            if (role.position >= botMember.roles.highest.position) continue;

            const dangerousPerms = [];
            
            for (const [permName, permData] of Object.entries(DANGEROUS_PERMISSIONS)) {
                // Check severity filter
                if (SEVERITY_ORDER[permData.severity] > SEVERITY_ORDER[minSeverity]) continue;
                
                if (role.permissions.has(permData.flag)) {
                    dangerousPerms.push({
                        name: permName,
                        ...permData
                    });
                }
            }

            if (dangerousPerms.length > 0) {
                // Sort by severity
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
                    value: [
                        `**Minimum Severity:** ${minSeverity}`,
                        `**Include Bot Roles:** ${includeBots ? 'Yes' : 'No'}`,
                        `**Excluded Role:** ${excludeRole ? excludeRole.name : 'None'}`,
                        `**Roles Scanned:** ${guild.roles.cache.size - 1}`
                    ].join('\n')
                })
                .setTimestamp()
                .setFooter({ text: 'Role Security Scanner' });

            return await interaction.editReply({ embeds: [embed] });
        }

        // Sort results by severity then member count
        results.sort((a, b) => {
            const severityDiff = SEVERITY_ORDER[a.highestSeverity] - SEVERITY_ORDER[b.highestSeverity];
            if (severityDiff !== 0) return severityDiff;
            return b.memberCount - a.memberCount;
        });

        // Store results for button interaction
        const scanId = `rolescan_${interaction.user.id}_${Date.now()}`;
        
        // Create summary embed
        const embed = this.createSummaryEmbed(results, minSeverity, includeBots, excludeRole, guild);
        
        // Create buttons
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${scanId}_details`)
                    .setLabel('📋 View Details')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`${scanId}_fix`)
                    .setLabel('🔧 Fix Issues')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`${scanId}_export`)
                    .setLabel('📤 Export Report')
                    .setStyle(ButtonStyle.Secondary)
            );

        const response = await interaction.editReply({ 
            embeds: [embed], 
            components: [row] 
        });

        // Handle button interactions
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000 // 5 minutes
        });

        collector.on('collect', async (btnInteraction) => {
            if (btnInteraction.user.id !== interaction.user.id) {
                return btnInteraction.reply({ 
                    content: '❌ Only the person who ran this command can use these buttons.', 
                    ephemeral: true 
                });
            }

            const action = btnInteraction.customId.split('_').pop();

            switch (action) {
                case 'details':
                    await this.showDetails(btnInteraction, results);
                    break;
                case 'fix':
                    await this.showFixOptions(btnInteraction, results, guild, botMember);
                    break;
                case 'export':
                    await this.exportReport(btnInteraction, results, guild);
                    break;
            }
        });

        collector.on('end', async () => {
            try {
                const disabledRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('disabled1')
                            .setLabel('📋 View Details')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled2')
                            .setLabel('🔧 Fix Issues')
                            .setStyle(ButtonStyle.Danger)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('disabled3')
                            .setLabel('📤 Export Report')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                await interaction.editReply({ components: [disabledRow] });
            } catch (e) {
                // Message may have been deleted
            }
        });
    },

    createSummaryEmbed(results, minSeverity, includeBots, excludeRole, guild) {
        const criticalCount = results.filter(r => r.highestSeverity === 'CRITICAL').length;
        const highCount = results.filter(r => r.highestSeverity === 'HIGH').length;
        const mediumCount = results.filter(r => r.highestSeverity === 'MEDIUM').length;
        const lowCount = results.filter(r => r.highestSeverity === 'LOW').length;

        const totalAffectedMembers = new Set(
            results.flatMap(r => [...r.role.members.keys()])
        ).size;

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Role Security Scan Results')
            .setDescription(`Found **${results.length} roles** with potentially dangerous permissions`)
            .setColor(criticalCount > 0 ? 0xff0000 : (highCount > 0 ? 0xff8800 : 0xffff00))
            .addFields(
                {
                    name: '📊 Severity Breakdown',
                    value: [
                        `🔴 **Critical:** ${criticalCount} roles`,
                        `🟠 **High:** ${highCount} roles`,
                        `🟡 **Medium:** ${mediumCount} roles`,
                        `🟢 **Low:** ${lowCount} roles`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '👥 Impact',
                    value: [
                        `**Affected Roles:** ${results.length}`,
                        `**Unique Members:** ${totalAffectedMembers}`,
                        `**Total Permissions:** ${results.reduce((sum, r) => sum + r.permissions.length, 0)}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🔍 Scan Settings',
                    value: [
                        `**Min Severity:** ${minSeverity}`,
                        `**Bot Roles:** ${includeBots ? 'Included' : 'Excluded'}`,
                        `**Excluded:** ${excludeRole ? excludeRole.name : 'None'}`
                    ].join('\n'),
                    inline: true
                }
            )
            .addFields({
                name: '⚡ Top Concerns',
                value: results.slice(0, 5).map((r, i) => {
                    const emoji = r.highestSeverity === 'CRITICAL' ? '🔴' : 
                                  r.highestSeverity === 'HIGH' ? '🟠' : 
                                  r.highestSeverity === 'MEDIUM' ? '🟡' : '🟢';
                    return `${i + 1}. ${emoji} **${r.role.name}** - ${r.permissions.length} dangerous perms (${r.memberCount} members)`;
                }).join('\n') || 'None'
            })
            .setTimestamp()
            .setFooter({ text: `Role Security Scanner • ${guild.name}` });

        return embed;
    },

    async showDetails(interaction, results) {
        await interaction.deferReply({ ephemeral: true });

        const embeds = [];
        const chunkedResults = [];
        
        // Split results into chunks of 5 for multiple embeds
        for (let i = 0; i < results.length; i += 5) {
            chunkedResults.push(results.slice(i, i + 5));
        }

        for (let i = 0; i < Math.min(chunkedResults.length, 2); i++) {
            const chunk = chunkedResults[i];
            const embed = new EmbedBuilder()
                .setTitle(i === 0 ? '📋 Detailed Role Analysis' : '📋 Detailed Role Analysis (Continued)')
                .setColor(0x5865F2)
                .setTimestamp();

            for (const result of chunk) {
                const permList = result.permissions.map(p => 
                    `${p.emoji} \`${p.name}\` - ${p.description}`
                ).join('\n');

                embed.addFields({
                    name: `${result.permissions[0].emoji} ${result.role.name} (${result.memberCount} members)`,
                    value: permList.substring(0, 1024),
                    inline: false
                });
            }

            embeds.push(embed);
        }

        if (results.length > 10) {
            embeds[embeds.length - 1].setFooter({ 
                text: `Showing 10 of ${results.length} roles. Use export for full report.` 
            });
        }

        await interaction.editReply({ embeds });
    },

    async showFixOptions(interaction, results, guild, botMember) {
        await interaction.deferReply({ ephemeral: true });

        // Filter to only roles the bot can actually modify
        const fixableResults = results.filter(r => 
            r.role.position < botMember.roles.highest.position && 
            !r.role.managed
        );

        if (fixableResults.length === 0) {
            return await interaction.editReply({
                content: '❌ No roles can be fixed. Either they are bot-managed roles or positioned higher than my highest role.'
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🔧 Fix Dangerous Permissions')
            .setDescription([
                '**⚠️ WARNING: This will remove dangerous permissions from roles!**',
                '',
                'Choose which severity levels to fix:',
                '• **Fix Critical** - Remove only Administrator, ManageGuild, ManageRoles',
                '• **Fix High & Critical** - Also removes Ban, Kick, ManageChannels, ManageWebhooks',
                '• **Fix All** - Removes all flagged permissions',
                '',
                `**Fixable Roles:** ${fixableResults.length}`,
                `**Unfixable (bot/higher roles):** ${results.length - fixableResults.length}`
            ].join('\n'))
            .setColor(0xff0000)
            .setTimestamp();

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`fix_critical_${interaction.user.id}`)
                    .setLabel('🔴 Fix Critical Only')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`fix_high_${interaction.user.id}`)
                    .setLabel('🟠 Fix High & Critical')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`fix_all_${interaction.user.id}`)
                    .setLabel('⚠️ Fix All Issues')
                    .setStyle(ButtonStyle.Danger)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`fix_cancel_${interaction.user.id}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        const response = await interaction.editReply({ 
            embeds: [embed], 
            components: [row1, row2] 
        });

        const fixCollector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000
        });

        fixCollector.on('collect', async (btn) => {
            if (!btn.customId.endsWith(interaction.user.id)) {
                return btn.reply({ content: '❌ Not your button!', ephemeral: true });
            }

            const action = btn.customId.split('_')[1];

            if (action === 'cancel') {
                await btn.update({ 
                    content: '❌ Fix operation cancelled.', 
                    embeds: [], 
                    components: [] 
                });
                fixCollector.stop();
                return;
            }

            await btn.deferUpdate();

            // Determine which severities to fix
            let severitiesToFix = [];
            if (action === 'critical') {
                severitiesToFix = ['CRITICAL'];
            } else if (action === 'high') {
                severitiesToFix = ['CRITICAL', 'HIGH'];
            } else if (action === 'all') {
                severitiesToFix = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
            }

            // Perform the fixes
            const fixResults = await this.performFixes(fixableResults, severitiesToFix, guild);

            const resultEmbed = new EmbedBuilder()
                .setTitle('🔧 Fix Results')
                .setDescription([
                    `**Severity Fixed:** ${severitiesToFix.join(', ')}`,
                    '',
                    `✅ **Successful:** ${fixResults.success.length} roles`,
                    `❌ **Failed:** ${fixResults.failed.length} roles`,
                    `📝 **Permissions Removed:** ${fixResults.permsRemoved}`
                ].join('\n'))
                .setColor(fixResults.failed.length === 0 ? 0x00ff00 : 0xffaa00)
                .setTimestamp();

            if (fixResults.success.length > 0) {
                embed.addFields({
                    name: '✅ Successfully Fixed',
                    value: fixResults.success.slice(0, 10).map(r => `• ${r.name}`).join('\n') +
                           (fixResults.success.length > 10 ? `\n... and ${fixResults.success.length - 10} more` : ''),
                    inline: true
                });
            }

            if (fixResults.failed.length > 0) {
                embed.addFields({
                    name: '❌ Failed to Fix',
                    value: fixResults.failed.slice(0, 10).map(r => `• ${r.name}: ${r.reason}`).join('\n'),
                    inline: true
                });
            }

            await btn.editReply({ 
                embeds: [resultEmbed], 
                components: [] 
            });

            // Log the action
            try {
                const bot = interaction.client.bot;
                if (bot?.logger) {
                    bot.logger.info(`[ROLESCAN] ${interaction.user.tag} fixed ${fixResults.success.length} roles in ${guild.name}`);
                }
            } catch (e) {
                // Logging failed, not critical
            }

            fixCollector.stop();
        });

        fixCollector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                try {
                    await interaction.editReply({ 
                        content: '⏰ Fix operation timed out.', 
                        embeds: [], 
                        components: [] 
                    });
                } catch (e) {}
            }
        });
    },

    async performFixes(results, severities, guild) {
        const fixResults = {
            success: [],
            failed: [],
            permsRemoved: 0
        };

        for (const result of results) {
            try {
                const permsToRemove = result.permissions
                    .filter(p => severities.includes(p.severity))
                    .map(p => p.flag);

                if (permsToRemove.length === 0) continue;

                // Calculate new permissions by removing dangerous ones
                let newPerms = result.role.permissions.bitfield;
                for (const perm of permsToRemove) {
                    newPerms = newPerms & ~perm;
                }

                await result.role.setPermissions(newPerms, `Security fix by rolescan command`);
                
                fixResults.success.push({ name: result.role.name });
                fixResults.permsRemoved += permsToRemove.length;
            } catch (error) {
                fixResults.failed.push({ 
                    name: result.role.name, 
                    reason: error.message.substring(0, 50) 
                });
            }
        }

        return fixResults;
    },

    async exportReport(interaction, results, guild) {
        await interaction.deferReply({ ephemeral: true });

        const reportLines = [
            '═══════════════════════════════════════════════════════════',
            '                    ROLE SECURITY SCAN REPORT              ',
            '═══════════════════════════════════════════════════════════',
            '',
            `Server: ${guild.name}`,
            `Server ID: ${guild.id}`,
            `Scan Date: ${new Date().toISOString()}`,
            `Total Flagged Roles: ${results.length}`,
            '',
            '───────────────────────────────────────────────────────────',
            '                      DETAILED FINDINGS                    ',
            '───────────────────────────────────────────────────────────',
            ''
        ];

        for (const result of results) {
            reportLines.push(`▸ ROLE: ${result.role.name}`);
            reportLines.push(`  ID: ${result.role.id}`);
            reportLines.push(`  Members: ${result.memberCount}`);
            reportLines.push(`  Highest Severity: ${result.highestSeverity}`);
            reportLines.push(`  Position: ${result.role.position}`);
            reportLines.push(`  Managed: ${result.role.managed ? 'Yes (Bot Role)' : 'No'}`);
            reportLines.push(`  Dangerous Permissions:`);
            
            for (const perm of result.permissions) {
                reportLines.push(`    [${perm.severity}] ${perm.name} - ${perm.description}`);
            }
            reportLines.push('');
        }

        reportLines.push('───────────────────────────────────────────────────────────');
        reportLines.push('                      RECOMMENDATIONS                      ');
        reportLines.push('───────────────────────────────────────────────────────────');
        reportLines.push('');
        reportLines.push('1. Review all CRITICAL severity roles immediately');
        reportLines.push('2. Ensure Administrator permission is only given to trusted roles');
        reportLines.push('3. Use the "Fix Issues" option to automatically remove dangerous permissions');
        reportLines.push('4. Regularly audit role permissions using this command');
        reportLines.push('');
        reportLines.push('═══════════════════════════════════════════════════════════');
        reportLines.push('                    END OF REPORT                          ');
        reportLines.push('═══════════════════════════════════════════════════════════');

        const reportContent = reportLines.join('\n');

        // Create a buffer and send as attachment
        const buffer = Buffer.from(reportContent, 'utf-8');
        const attachment = {
            attachment: buffer,
            name: `role-security-report-${guild.id}-${Date.now()}.txt`
        };

        await interaction.editReply({
            content: '📤 **Security Report Generated**\nDownload the attached file for the full report.',
            files: [attachment]
        });
    }
};
