/**
 * Interaction Create Event Handler
 * Handles all Discord interactions (commands, buttons, select menus, modals)
 */

const { Collection, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');

// Import the new help v2 handler
const { handleHelpInteraction, PREFIX: HELP_PREFIX } = require('../interactions/helpV2Handler');

// Bot maintenance check
async function isBotInMaintenance() {
    try {
        const darklockDbPath = path.join(process.cwd(), 'data', 'darklock.db');
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database(darklockDbPath);
        
        const result = await new Promise((resolve) => {
            db.get(`SELECT value FROM platform_settings WHERE key = 'bot_maintenance'`, (err, row) => {
                db.close();
                resolve(err ? null : row);
            });
        });
        
        if (!result?.value) return { enabled: false };
        
        const data = JSON.parse(result.value);
        return data;
    } catch (err) {
        console.error('[Bot Maintenance] Check failed:', err.message);
        return { enabled: false };
    }
}

module.exports = {
    name: 'interactionCreate',
    once: false,
    async execute(interaction, bot) {
        if (bot.commandProcessingDisabled) {
            if (interaction.isRepliable && interaction.isRepliable()) {
                return interaction.reply({
                    content: 'Security lockdown is active. Commands are temporarily disabled.',
                    ephemeral: true
                }).catch(() => {});
            }
            return;
        }
        
        // Check bot maintenance mode (separate from platform maintenance)
        const maintenance = await isBotInMaintenance();
        if (maintenance.enabled && interaction.isChatInputCommand()) {
            const embed = new EmbedBuilder()
                .setColor(0xf59e0b)
                .setTitle('🔧 Bot Maintenance')
                .setDescription(maintenance.reason || 'The bot is currently undergoing maintenance.')
                .setFooter({ text: 'We apologize for the inconvenience' });
            
            if (maintenance.endTime) {
                const endDate = new Date(maintenance.endTime);
                embed.addFields({
                    name: 'Estimated Back Online',
                    value: `<t:${Math.floor(endDate.getTime() / 1000)}:R>`
                });
            }
            
            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            }).catch(() => {});
        }
        
        // NEW: Check for help v2 interactions FIRST (buttons and modals)
        // This takes priority to ensure clean handling
        if ((interaction.isButton() || interaction.isModalSubmit()) && 
            interaction.customId?.startsWith(HELP_PREFIX)) {
            const handled = await handleHelpInteraction(interaction, bot);
            if (handled) return;
        }
        
        // Autocomplete handling
        if (interaction.isAutocomplete()) {
            await handleAutocomplete(interaction, bot);
        }
        // Slash command handling
        else if (interaction.isChatInputCommand()) {
            await handleSlashCommand(interaction, bot);
        }
        // Context menu commands (message/user right-click)
        else if (interaction.isMessageContextMenuCommand() || interaction.isUserContextMenuCommand()) {
            await handleContextMenuCommand(interaction, bot);
        }
        // Button interactions
        else if (interaction.isButton()) {
            await handleButtonInteraction(interaction, bot);
        }
        // Select menu interactions
        else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction, bot);
        }
        // Modal submissions
        else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction, bot);
        }
    }
};

/**
 * Handle slash command execution
 */
async function handleSlashCommand(interaction, bot) {
    const command = bot.commands.get(interaction.commandName);
    
    if (!command) {
        return await interaction.reply({
            content: '❌ Command not found.',
            ephemeral: true
        });
    }

    // Check cooldowns
    if (!bot.cooldowns.has(command.data.name)) {
        bot.cooldowns.set(command.data.name, new Collection());
    }

    const now = Date.now();
    const timestamps = bot.cooldowns.get(command.data.name);
    const cooldownAmount = (command.cooldown || 3) * 1000;

    if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return await interaction.reply({
                content: `⏰ Please wait ${timeLeft.toFixed(1)} seconds before using this command again.`,
                ephemeral: true
            });
        }
    }

    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    const startTime = Date.now();
    let commandSuccess = true;
    let commandError = null;

    try {
        // Feature gating
        const blocked = await bot.isFeatureBlocked(interaction);
        if (blocked) {
            return await interaction.reply({ content: '❌ This feature is disabled in this server.', ephemeral: true });
        }

        // Plan-based gating
        if (interaction.guild) {
            const requiredPlan = command.requiredPlan || bot.planRequirements?.[command.data?.name];
            if (requiredPlan === 'pro') {
                const hasPro = await bot.hasProFeatures(interaction.guild.id);
                if (!hasPro) {
                    return await interaction.reply('❌ This feature requires the **Pro plan**.');
                }
            } else if (requiredPlan === 'enterprise') {
                const hasEnterprise = await bot.hasEnterpriseFeatures(interaction.guild.id);
                if (!hasEnterprise) {
                    return await interaction.reply('❌ This feature requires the **Enterprise plan**.');
                }
            }
        }

        // Role-based permission check (before command execution)
        if (bot.permissionManager) {
            const allowed = await bot.permissionManager.isAllowed(interaction);
            if (!allowed) {
                return await interaction.reply({
                    content: '🚫 You do not have permission to use this command. Ask a server admin to grant access via `/permissions`.',
                    ephemeral: true
                });
            }
        }

        // Feature gating: if the command declares a feature requirement, ensure it's enabled for the guild
        if (interaction.guild && command.feature) {
            try {
                const enabled = await bot.isFeatureEnabledForGuild(interaction.guild.id, command.feature);
                if (!enabled) {
                    return await interaction.reply({
                        content: `⚠️ The feature required for this command (${command.feature}) is currently disabled in this server. Ask an admin to enable it in the dashboard.`,
                        ephemeral: true
                    });
                }
            } catch (e) {
                await bot.logger.logError({
                    error: e,
                    context: 'feature_gate_check',
                    guildId: interaction.guild.id,
                    userId: interaction.user.id
                });
            }
        }

        // Track command usage for analytics
        if (bot.eventEmitter && interaction.guild) {
            await bot.eventEmitter.emitCommandUsed(
                interaction.guild.id,
                interaction.commandName,
                interaction.user.id
            );
        }

        // Pass bot instance to commands that need it
        await command.execute(interaction, bot);
        
        // Broadcast command execution to console
        try {
            const guildId = interaction.guild ? interaction.guild.id : null;
            const who = interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : String(interaction.user?.id || 'Unknown');
            const cmd = command.data && command.data.name ? command.data.name : interaction.commandName;
            bot.broadcastConsole(guildId, `[COMMAND] ${who} -> /${cmd}`);
        } catch (e) {
            /* ignore */
        }
        
        // Track command usage in analytics
        if (bot.analyticsManager) {
            await bot.analyticsManager.trackCommand(interaction);
        }
    } catch (error) {
        commandSuccess = false;
        commandError = error.message || String(error);
        
        await bot.logger.logError({
            error,
            context: `command_${interaction.commandName}`,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        // Broadcast error to console
        try {
            const guildId = interaction.guild ? interaction.guild.id : null;
            bot.broadcastConsole(guildId, `[CMD ERROR] /${interaction.commandName} failed: ${error.message || error}`);
        } catch (_) {}
        
        const errorMessage = {
            content: '❌ An error occurred while executing this command.',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } finally {
        // Log command execution
        const duration = Date.now() - startTime;
        await bot.logger.logCommand({
            commandName: interaction.commandName,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id,
            options: interaction.options?.data || {},
            success: commandSuccess,
            duration,
            error: commandError
        });
    }
}

/**
 * Handle context menu command execution (message/user right-click)
 */
async function handleContextMenuCommand(interaction, bot) {
    // Context menu commands are stored by their display name (e.g., "Redact & Delete")
    const command = bot.commands.get(interaction.commandName);
    
    if (!command) {
        return await interaction.reply({
            content: '❌ Context menu command not found.',
            ephemeral: true
        });
    }

    // Check cooldowns (use same mechanism as slash commands)
    const commandName = command.data?.name || interaction.commandName;
    if (!bot.cooldowns.has(commandName)) {
        bot.cooldowns.set(commandName, new Collection());
    }

    const now = Date.now();
    const timestamps = bot.cooldowns.get(commandName);
    const cooldownAmount = (command.cooldown || 3) * 1000;

    if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return await interaction.reply({
                content: `⏰ Please wait ${timeLeft.toFixed(1)} seconds before using this command again.`,
                ephemeral: true
            });
        }
    }

    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    const startTime = Date.now();
    let commandSuccess = true;
    let commandError = null;

    try {
        // Execute the context menu command
        await command.execute(interaction, bot);
        
        // Broadcast command execution to console
        try {
            const guildId = interaction.guild ? interaction.guild.id : null;
            const who = interaction.user ? `${interaction.user.tag} (${interaction.user.id})` : String(interaction.user?.id || 'Unknown');
            const cmd = commandName;
            bot.broadcastConsole(guildId, `[CONTEXT MENU] ${who} -> ${cmd}`);
        } catch (e) {
            /* ignore */
        }
        
        // Track command usage in analytics
        if (bot.analyticsManager) {
            await bot.analyticsManager.trackCommand(interaction);
        }
    } catch (error) {
        commandSuccess = false;
        commandError = error.message || String(error);
        
        await bot.logger.logError({
            error,
            context: `context_menu_${interaction.commandName}`,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id
        });
        
        // Broadcast error to console
        try {
            const guildId = interaction.guild ? interaction.guild.id : null;
            bot.broadcastConsole(guildId, `[CONTEXT MENU ERROR] ${interaction.commandName} failed: ${error.message || error}`);
        } catch (_) {}
        
        const errorMessage = {
            content: '❌ An error occurred while executing this command.',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } finally {
        // Log command execution
        const duration = Date.now() - startTime;
        await bot.logger.logCommand({
            commandName: interaction.commandName,
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            guildId: interaction.guild?.id,
            channelId: interaction.channel?.id,
            type: 'context_menu',
            success: commandSuccess,
            duration,
            error: commandError
        });
    }
}

/**
 * Handle button interactions
 */
async function handleButtonInteraction(interaction, bot) {
    const buttonSuccess = await (async () => {
        try {
            // Reaction role buttons
            if (interaction.customId.startsWith('rr_')) {
                const reactionRoleButtonHandler = require('../events/reactionRoleButtons');
                await reactionRoleButtonHandler(interaction);
                return true;
            }
            
            // Channel access buttons
            if (interaction.customId.startsWith('channel_access_')) {
                const channelAccessHandler = require('../../events/channelAccessHandler');
                await channelAccessHandler.handleChannelAccessButton(interaction, bot);
                return true;
            }
            
            // ModMail buttons
            if (interaction.customId.startsWith('modmail_')) {
                await handleModMailButton(interaction, bot);
                return true;
            }
            
            // Appeal buttons
            if (interaction.customId.startsWith('appeal_')) {
                await handleAppealButton(interaction, bot);
                return true;
            }
            
            // Quarantine buttons
            if (interaction.customId.startsWith('quarantine_')) {
                await handleQuarantineButton(interaction, bot);
                return true;
            }
            
            // Verification skip/deny (staff buttons)
            if (interaction.customId.startsWith('verify_allow_') || interaction.customId.startsWith('verify_deny_')) {
                const targetId = interaction.customId.split('_')[2];
                const approve = interaction.customId.startsWith('verify_allow_');
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) &&
                    !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: 'Staff only.', ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                const member = await interaction.guild.members.fetch(targetId).catch(() => null);
                if (!member) return interaction.editReply({ content: 'User not found.' });
                const cfg = await bot.database.getGuildConfig(interaction.guild.id);
                const unverifiedRole = cfg.unverified_role_id ? interaction.guild.roles.cache.get(cfg.unverified_role_id) : null;
                const verifiedRole = cfg.verified_role_id ? interaction.guild.roles.cache.get(cfg.verified_role_id) : null;
                if (approve) {
                    if (unverifiedRole) await member.roles.remove(unverifiedRole).catch(() => {});
                    if (verifiedRole) await member.roles.add(verifiedRole).catch(() => {});
                    const welcomeChannel = cfg.verified_welcome_channel_id ? interaction.guild.channels.cache.get(cfg.verified_welcome_channel_id) : interaction.guild.systemChannel;
                    if (welcomeChannel?.isTextBased()) {
                        const msg = (cfg.verified_welcome_message || 'Welcome {user} to {server}!').replace('{user}', member).replace('{server}', interaction.guild.name);
                        await welcomeChannel.send({ content: msg });
                    }
                    await interaction.message.edit({ components: [] });
                    await interaction.editReply({ content: `Approved ${member.user.tag}.` });
                } else {
                    await member.kick(`Verification denied by ${interaction.user.tag}`);
                    await interaction.message.edit({ components: [] });
                    await interaction.editReply({ content: `Denied and kicked ${member.user.tag}.` });
                }
                return true;
            }
            
            // Main verification button (verify_button)
            if (interaction.customId === 'verify_button') {
                await handleVerifyButton(interaction, bot);
                return true;
            }
            
            // Dynamic verification buttons (verify_user_*)
            if (interaction.customId.startsWith('verify_user_')) {
                await handleDynamicVerifyButton(interaction, bot);
                return true;
            }
            
            // Enhanced ticket system buttons
            if (interaction.customId.startsWith('close_ticket_') || 
                interaction.customId.startsWith('claim_ticket_') || 
                interaction.customId.startsWith('add_user_') ||
                interaction.customId.startsWith('confirm_close_') ||
                interaction.customId.startsWith('cancel_close_') ||
                interaction.customId.startsWith('rate_ticket_')) {
                if (bot.enhancedTicketManager) {
                    await bot.enhancedTicketManager.handleTicketInteraction(interaction);
                }
                return true;
            }
            
            // Setup wizard buttons
            if (interaction.customId.startsWith('setup_')) {
                if (bot.setupWizard) {
                    await bot.setupWizard.handleSetupInteraction(interaction);
                }
                return true;
            }
            
            // Risk action buttons (from risk alerts)
            if (interaction.customId.startsWith('risk_action_')) {
                await handleRiskActionButton(interaction, bot);
                return true;
            }
            
            // Help category buttons (from /help command)
            if (interaction.customId.startsWith('help-category-')) {
                await handleHelpCategoryButton(interaction, bot);
                return true;
            }
            
            // Help ticket button
            if (interaction.customId.startsWith('help-ticket-')) {
                await handleHelpTicketButton(interaction, bot);
                return true;
            }
            
            // Help back button
            if (interaction.customId === 'help-back') {
                await handleHelpBackButton(interaction, bot);
                return true;
            }
            
            // Help quick setup button
            if (interaction.customId === 'help_quick_setup') {
                await handleHelpQuickSetupButton(interaction, bot);
                return true;
            }
            
            // Settings buttons
            if (interaction.customId.startsWith('toggle_') || 
                interaction.customId.startsWith('configure_') ||
                interaction.customId === 'settings_back') {
                if (bot.settingsManager) {
                    await bot.settingsManager.handleSettingsInteraction(interaction);
                }
                return true;
            }
            
            // Backup confirmation buttons - handled by awaitMessageComponent in serverbackup command
            // Don't process these here, let the collector handle them
            if (interaction.customId.startsWith('backup_confirm_') || 
                interaction.customId === 'backup_cancel') {
                return true; // Return without doing anything - the collector will handle it
            }
            
            // Ticket panel buttons (create_ticket, ticket_guidelines)
            if (interaction.customId === 'create_ticket' || 
                interaction.customId === 'ticket_guidelines' ||
                interaction.customId === 'close_ticket_confirm') {
                if (bot.ticketManager) {
                    await bot.ticketManager.handleTicketButton(interaction);
                } else {
                    await interaction.reply({
                        content: '❌ Ticket system is not available. Please contact an administrator.',
                        ephemeral: true
                    });
                }
                return true;
            }
            
            // Legacy ticket system and other buttons
            await bot.handleButtonInteraction(interaction);
            return true;
        } catch (error) {
            await bot.logger.logError({
                error,
                context: `button_${interaction.customId}`,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                guildId: interaction.guild?.id,
                channelId: interaction.channel?.id
            });
            return false;
        }
    })();

    // Log button interaction
    await bot.logger.logButton({
        customId: interaction.customId,
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id,
        messageId: interaction.message?.id,
        action: interaction.customId.split('_')[0],
        success: buttonSuccess
    });
}

/**
 * Handle risk action buttons (kick, ban, mark safe)
 */
async function handleRiskActionButton(interaction, bot) {
    const parts = interaction.customId.split('_'); // risk_action_kick_123456
    const action = parts[2]; // kick, ban, or clear
    const targetId = parts[3];
    
    // RATE-LIMIT: Prevent spam clicking / double actions
    const rateLimitKey = `risk_${interaction.guild.id}_${interaction.user.id}_${action}_${targetId}`;
    if (!bot._buttonCooldowns) bot._buttonCooldowns = new Map();
    const lastClick = bot._buttonCooldowns.get(rateLimitKey);
    const now = Date.now();
    if (lastClick && (now - lastClick) < 10000) { // 10 second cooldown
        return interaction.reply({ 
            content: '⏳ Please wait before clicking again.', 
            ephemeral: true 
        });
    }
    bot._buttonCooldowns.set(rateLimitKey, now);
    // Clean old entries
    if (bot._buttonCooldowns.size > 1000) {
        const cutoff = now - 60000;
        for (const [k, v] of bot._buttonCooldowns) {
            if (v < cutoff) bot._buttonCooldowns.delete(k);
        }
    }
    
    // CRITICAL: Verify specific permissions based on action
    const hasKickPerm = interaction.member.permissions.has(PermissionFlagsBits.KickMembers);
    const hasBanPerm = interaction.member.permissions.has(PermissionFlagsBits.BanMembers);
    const hasManagePerm = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                          interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    // Check permission based on action type
    if (action === 'kick' && !hasKickPerm && !hasManagePerm) {
        return interaction.reply({ content: '❌ You need **Kick Members** permission.', ephemeral: true });
    }
    if (action === 'ban' && !hasBanPerm && !hasManagePerm) {
        return interaction.reply({ content: '❌ You need **Ban Members** permission.', ephemeral: true });
    }
    if (action === 'clear' && !hasKickPerm && !hasBanPerm && !hasManagePerm) {
        return interaction.reply({ content: '❌ You need moderation permissions.', ephemeral: true });
    }
    
    await interaction.deferReply({ ephemeral: true });
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    
    // Log the action to mod_actions for audit trail
    const logAction = async (actionType, success, details = {}) => {
        try {
            await bot.database.run(`
                INSERT INTO mod_actions (guild_id, action_type, target_user_id, moderator_id, reason, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                interaction.guild.id,
                `risk_${actionType}`,
                targetId,
                interaction.user.id,
                JSON.stringify({ success, triggeredBy: interaction.user.tag, ...details })
            ]);
        } catch (e) {
            bot.logger?.warn(`[RiskAction] Failed to log action: ${e.message}`);
        }
    };
    
    if (action === 'clear') {
        // Mark user as safe - set manual_override=true AND raise trust to 80
        await bot.database.run(
            `INSERT INTO user_records (guild_id, user_id, trust_score, manual_override, updated_at) 
             VALUES (?, ?, 80, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(guild_id, user_id) DO UPDATE SET 
                trust_score = 80, 
                manual_override = 1, 
                updated_at = CURRENT_TIMESTAMP`,
            [interaction.guild.id, targetId]
        );
        await logAction('mark_safe', true, { newTrustScore: 80 });
        await interaction.message.edit({ components: [] });
        await interaction.editReply({ content: `✅ Marked user as safe (trust=80, manual_override=true). Future alerts suppressed until trust drops.` });
        bot.logger?.info(`[RiskAction] ${interaction.user.tag} marked ${targetId} as safe in ${interaction.guild.id}`);
        
    } else if (action === 'kick' && member) {
        try {
            await member.kick(`Risk action by ${interaction.user.tag}`);
            await logAction('kick', true);
            await interaction.message.edit({ components: [] });
            await interaction.editReply({ content: `✅ Kicked ${member.user.tag}.` });
            bot.logger?.info(`[RiskAction] ${interaction.user.tag} kicked ${member.user.tag} (${targetId}) in ${interaction.guild.id}`);
            
            // Broadcast to dashboard console
            if (typeof bot.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[KICK] ${member.user.tag} (${targetId}) by ${interaction.user.tag} (risk action)`);
            }
            // Log to forensics audit trail
            if (bot.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'kick',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: targetId, name: member.user.tag, type: 'user' },
                    reason: 'Risk action kick',
                    canReplay: true
                });
            }
        } catch (err) {
            await logAction('kick', false, { error: err.message });
            await interaction.editReply({ content: `❌ Failed to kick: ${err.message}` });
        }
        
    } else if (action === 'ban' && member) {
        try {
            await member.ban({ reason: `Risk action by ${interaction.user.tag}`, deleteMessageSeconds: 0 });
            await logAction('ban', true);
            await interaction.message.edit({ components: [] });
            await interaction.editReply({ content: `✅ Banned ${member.user.tag}.` });
            bot.logger?.info(`[RiskAction] ${interaction.user.tag} banned ${member.user.tag} (${targetId}) in ${interaction.guild.id}`);
            
            // Broadcast to dashboard console
            if (typeof bot.broadcastConsole === 'function') {
                bot.broadcastConsole(interaction.guild.id, `[BAN] ${member.user.tag} (${targetId}) by ${interaction.user.tag} (risk action)`);
            }
            // Log to forensics audit trail
            if (bot.forensicsManager) {
                await bot.forensicsManager.logAuditEvent({
                    guildId: interaction.guild.id,
                    eventType: 'ban',
                    eventCategory: 'moderation',
                    executor: { id: interaction.user.id, tag: interaction.user.tag },
                    target: { id: targetId, name: member.user.tag, type: 'user' },
                    reason: 'Risk action ban',
                    canReplay: true
                });
            }
        } catch (err) {
            await logAction('ban', false, { error: err.message });
            await interaction.editReply({ content: `❌ Failed to ban: ${err.message}` });
        }
        
    } else if (!member) {
        await interaction.editReply({ content: '❌ User not found (may have left the server).' });
    }
}

/**
 * Handle help category button clicks
 */
async function handleHelpCategoryButton(interaction, bot) {
    const category = interaction.customId.replace('help-category-', '');
    
    const helpCategories = {
        'moderation': {
            emoji: '🔨',
            color: 0xff6b6b,
            commands: [
                { name: '/kick', desc: 'Kick a user from the server' },
                { name: '/ban', desc: 'Ban a user from the server' },
                { name: '/timeout', desc: 'Timeout a user' },
                { name: '/warn', desc: 'Warn a user' },
                { name: '/purge', desc: 'Delete multiple messages' },
                { name: '/unban', desc: 'Unban a user' }
            ],
            description: 'Manage and moderate your community with powerful tools'
        },
        'security': {
            emoji: '🛡️',
            color: 0x00d4ff,
            commands: [
                { name: '/status', desc: 'View bot and security status' },
                { name: '/lockdown', desc: 'Lock/unlock channels' },
                { name: '/antispam', desc: 'Configure anti-spam settings' },
                { name: '/antiraid', desc: 'Configure anti-raid protection' },
                { name: '/antinuke', desc: 'Configure anti-nuke protection' }
            ],
            description: 'Advanced protection against raids, spam, and attacks'
        },
        'verification': {
            emoji: '✅',
            color: 0x51cf66,
            commands: [
                { name: '/verification', desc: 'Setup verification system' },
                { name: '/verify', desc: 'Manually verify a user' }
            ],
            description: 'Verify users with captcha and approval workflows'
        },
        'admin': {
            emoji: '⚙️',
            color: 0xffd43b,
            commands: [
                { name: '/setup', desc: 'Run the setup wizard' },
                { name: '/server backup', desc: 'Create a server backup' },
                { name: '/server restore', desc: 'Restore from backup' },
                { name: '/logs', desc: 'View server logs' },
                { name: '/owner', desc: 'Owner-only settings' }
            ],
            description: 'Configure and manage bot settings'
        },
        'leveling': {
            emoji: '📈',
            color: 0xa78bfa,
            commands: [
                { name: '/rank', desc: 'View your rank and XP' },
                { name: '/leaderboard', desc: 'View server leaderboard' },
                { name: '/setlevel', desc: 'Set a user\'s level (admin)' }
            ],
            description: 'XP system with ranks and level roles'
        },
        'utility': {
            emoji: '🔧',
            color: 0x1f2937,
            commands: [
                { name: '/help', desc: 'Show this help menu' },
                { name: '/ping', desc: 'Check bot latency' },
                { name: '/serverinfo', desc: 'View server information' },
                { name: '/userinfo', desc: 'View user information' }
            ],
            description: 'General utility and information commands'
        }
    };
    
    const catInfo = helpCategories[category];
    if (!catInfo) {
        return interaction.reply({ content: '❌ Unknown category', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
        .setTitle(`${catInfo.emoji} ${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
        .setDescription(catInfo.description)
        .setColor(catInfo.color)
        .setTimestamp();
    
    let commandList = '';
    for (const cmd of catInfo.commands) {
        commandList += `**${cmd.name}** - ${cmd.desc}\n`;
    }
    embed.addFields({ name: 'Commands', value: commandList || 'No commands available' });
    
    // Create ticket button
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`help-ticket-${category}`)
                .setLabel('Create Support Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫'),
            new ButtonBuilder()
                .setCustomId('help-back')
                .setLabel('Back to Categories')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('◀️')
        );
    
    await interaction.update({ embeds: [embed], components: [row] });
}

/**
 * Handle help ticket button - show modal to create ticket
 */
async function handleHelpTicketButton(interaction, bot) {
    const category = interaction.customId.replace('help-ticket-', '');
    
    const modal = new ModalBuilder()
        .setCustomId(`help-ticket-modal-${category}`)
        .setTitle(`🎫 Create Support Ticket`);
    
    const subjectInput = new TextInputBuilder()
        .setCustomId('help-subject')
        .setLabel('Subject')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Brief description of your issue')
        .setMinLength(5)
        .setMaxLength(100)
        .setRequired(true);
    
    const reasonInput = new TextInputBuilder()
        .setCustomId('help-reason')
        .setLabel('Category')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(category)
        .setValue(category.charAt(0).toUpperCase() + category.slice(1))
        .setRequired(true);
    
    const descriptionInput = new TextInputBuilder()
        .setCustomId('help-description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Please describe your issue in detail...')
        .setMinLength(10)
        .setMaxLength(2000)
        .setRequired(true);
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(subjectInput),
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(descriptionInput)
    );
    
    await interaction.showModal(modal);
}

/**
 * Handle help back button - return to main help menu
 */
async function handleHelpBackButton(interaction, bot) {
    const helpCategories = {
        'moderation': { emoji: '🔨', description: 'Manage and moderate your community' },
        'security': { emoji: '🛡️', description: 'Advanced protection features' },
        'verification': { emoji: '✅', description: 'User verification system' },
        'admin': { emoji: '⚙️', description: 'Bot configuration and settings' },
        'leveling': { emoji: '📈', description: 'XP and ranking system' },
        'utility': { emoji: '🔧', description: 'General utility commands' }
    };
    
    const embed = new EmbedBuilder()
        .setTitle('🛡️ DarkLock - Help Center')
        .setDescription('Select a category below to see available commands')
        .setColor(0x00d4ff)
        .setTimestamp();
    
    let categoryText = '';
    for (const [category, info] of Object.entries(helpCategories)) {
        categoryText += `${info.emoji} **${category.charAt(0).toUpperCase() + category.slice(1)}**: ${info.description}\n`;
    }
    embed.addFields({ name: 'Available Categories', value: categoryText });
    
    // Create category buttons
    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('help-category-moderation').setLabel('Moderation').setEmoji('🔨').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help-category-security').setLabel('Security').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help-category-verification').setLabel('Verification').setEmoji('✅').setStyle(ButtonStyle.Secondary)
        );
    
    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('help-category-admin').setLabel('Admin').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help-category-leveling').setLabel('Leveling').setEmoji('📈').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('help-category-utility').setLabel('Utility').setEmoji('🔧').setStyle(ButtonStyle.Secondary)
        );
    
    const row3 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Admin Panel')
                .setStyle(ButtonStyle.Link)
                .setURL(process.env.DASHBOARD_URL || 'https://discord-security-bot-uyx6.onrender.com/dashboard')
                .setEmoji('📊'),
            new ButtonBuilder()
                .setLabel('Support Server')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/r8dvnad9c9')
                .setEmoji('🤝')
        );
    
    await interaction.update({ embeds: [embed], components: [row1, row2, row3] });
}

/**
 * Handle help quick setup button - start setup wizard
 */
async function handleHelpQuickSetupButton(interaction, bot) {
    try {
        // Check if user has permissions
        const { PermissionFlagsBits } = require('discord.js');
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
            !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: '❌ You need Administrator or Manage Server permission to use setup wizard.',
                ephemeral: true
            });
        }

        // If setup wizard exists, use it - DO NOT defer first, let wizard handle it
        if (bot.setupWizard) {
            await bot.setupWizard.startSetup(interaction);
            return;
        }

        // Fallback: Show setup guide embed (no defer needed for simple reply)
        const { EmbedBuilder } = require('discord.js');
        const setupEmbed = new EmbedBuilder()
            .setTitle('🚀 Quick Setup Guide')
            .setDescription('Get started with DarkLock in a few simple steps!')
            .setColor('#00d4ff')
            .addFields(
                { 
                    name: '1️⃣ Start Setup Wizard', 
                    value: 'Use `/setup wizard start` to begin interactive setup', 
                    inline: false 
                },
                { 
                    name: '2️⃣ Configure Welcome Messages', 
                    value: 'Use `/setup welcome setup` to customize welcome messages', 
                    inline: false 
                },
                { 
                    name: '3️⃣ Enable Verification', 
                    value: 'Use `/setup onboarding enable` to protect against raids', 
                    inline: false 
                },
                { 
                    name: '4️⃣ Set Up Auto-Roles', 
                    value: 'Use `/setup roles add` to assign roles automatically', 
                    inline: false 
                },
                { 
                    name: '5️⃣ Configure Permissions', 
                    value: 'Use `/setup permissions` to control command access', 
                    inline: false 
                }
            )
            .setFooter({ text: 'Tip: Use /help for detailed command information' })
            .setTimestamp();

        await interaction.reply({ embeds: [setupEmbed], ephemeral: true });
    } catch (error) {
        bot.logger?.error('Error handling help quick setup button:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ An error occurred. Please try `/setup wizard start` manually.',
                ephemeral: true
            });
        }
    }
}

/**
 * Handle main verification button (verify_button)
 */
async function handleVerifyButton(interaction, bot) {
    try {
        const guildId = interaction.guild.id;
        const member = interaction.member;

        // Get guild config
        const config = await bot.database.get(
            `SELECT verified_role_id, unverified_role_id, verification_method FROM guild_configs WHERE guild_id = ?`,
            [guildId]
        );

        if (!config || !config.verified_role_id) {
            return interaction.reply({ content: '❌ Verification system is not properly configured.', ephemeral: true });
        }

        // Check if already verified
        if (member.roles.cache.has(config.verified_role_id)) {
            return interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
        }

        const method = (config.verification_method || 'button').toLowerCase();
        bot.logger?.info(`[Verification] Guild ${guildId} using method: ${method}`);

        // For 'button' or 'auto' method, verify directly
        if (method === 'button' || method === 'auto') {
            await member.roles.add(config.verified_role_id).catch(() => {});
            if (config.unverified_role_id) {
                await member.roles.remove(config.unverified_role_id).catch(() => {});
            }
            if (bot.userVerification && typeof bot.userVerification.markVerified === 'function') {
                await bot.userVerification.markVerified(member, 'button').catch(() => {});
            }
            return interaction.reply({ 
                content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                ephemeral: true 
            });
        } else if (method === 'captcha' || method === 'code') {
            // For captcha/code method, show modal to enter code or generate new one
            const pending = await bot.database.get(
                `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
                [guildId, member.id]
            );

            if (!pending) {
                // Generate new code
                const crypto = require('crypto');
                const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                let captchaCode = '';
                for (let i = 0; i < 6; i++) {
                    captchaCode += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                const codeHash = crypto.createHash('sha256').update(captchaCode.toLowerCase()).digest('hex');
                const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

                await bot.database.run(
                    `INSERT INTO verification_queue (guild_id, user_id, verification_type, verification_data, status, expires_at, attempts) 
                     VALUES (?, ?, 'captcha', ?, 'pending', ?, 0)`,
                    [guildId, member.id, JSON.stringify({ displayCode: captchaCode, codeHash }), expiresAt]
                );

                // Try to DM the code
                try {
                    await member.send({
                        embeds: [{
                            title: '🔐 Verification Code',
                            description: `Your verification code for **${interaction.guild.name}** is:\n\n**\`${captchaCode}\`**\n\nReturn to the server and click the Verify button again, then enter this code.\n\n*This code expires in 10 minutes.*`,
                            color: 0x00d4ff,
                            timestamp: new Date().toISOString()
                        }]
                    });
                    return interaction.reply({ 
                        content: '📬 **Check your DMs!**\n\nA verification code has been sent to you. Click the verify button again to enter the code.',
                        ephemeral: true 
                    });
                } catch (dmErr) {
                    return interaction.reply({ 
                        content: `📬 **Your Verification Code**\n\nYour code is: **\`${captchaCode}\`**\n\n*We couldn't DM you, so here's your code. Click verify again to enter it.*`,
                        ephemeral: true 
                    });
                }
            }

            // Check if expired
            if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
                await bot.database.run(`DELETE FROM verification_queue WHERE id = ?`, [pending.id]);
                return interaction.reply({ 
                    content: '⏰ Your previous code expired. Click verify again to get a new code.',
                    ephemeral: true 
                });
            }

            // Show modal to enter code
            const modal = new ModalBuilder()
                .setCustomId(`verify_modal_${guildId}_${member.id}`)
                .setTitle('🔐 Enter Verification Code');

            const codeInput = new TextInputBuilder()
                .setCustomId('verification_code')
                .setLabel('Enter the code from your DM')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter code...')
                .setRequired(true)
                .setMinLength(4)
                .setMaxLength(10);

            modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
            return interaction.showModal(modal);

        } else if (method === 'reaction' || method === 'emoji') {
            // For reaction method
            if (bot.verificationSystem && typeof bot.verificationSystem.emojiReactionVerification === 'function') {
                const result = await bot.verificationSystem.emojiReactionVerification(interaction.guild, member);
                if (result && result.success) {
                    return interaction.reply({ 
                        content: '📨 **Reaction Verification Started!**\n\nCheck your DMs and react with the correct emoji to complete verification.',
                        ephemeral: true 
                    });
                }
            }
            // Fallback: verify directly
            await member.roles.add(config.verified_role_id).catch(() => {});
            if (config.unverified_role_id) {
                await member.roles.remove(config.unverified_role_id).catch(() => {});
            }
            return interaction.reply({ 
                content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                ephemeral: true 
            });

        } else if (method === 'web') {
            // For web verification
            const dashboardUrl = process.env.DASHBOARD_URL || 'https://discord-security-bot-uyx6.onrender.com';
            const verifyUrl = `${dashboardUrl}/verify/${guildId}/${member.id}`;
            
            const { ButtonBuilder, ButtonStyle } = require('discord.js');
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('Open Verification Portal')
                        .setStyle(ButtonStyle.Link)
                        .setURL(verifyUrl)
                        .setEmoji('🔗')
                );
            
            return interaction.reply({ 
                content: `🌐 **Web Verification Required**\n\nClick the button below to complete your verification:`,
                components: [row],
                ephemeral: true 
            });
        } else {
            // Default fallback
            await member.roles.add(config.verified_role_id).catch(() => {});
            if (config.unverified_role_id) {
                await member.roles.remove(config.unverified_role_id).catch(() => {});
            }
            return interaction.reply({ 
                content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
                ephemeral: true 
            });
        }
    } catch (err) {
        bot.logger?.error('[InteractionCreate] verify_button error:', err);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: '❌ An error occurred during verification. Please contact staff.', ephemeral: true });
        }
    }
}

/**
 * Handle dynamic verification buttons (verify_user_*)
 */
async function handleDynamicVerifyButton(interaction, bot) {
    try {
        const parts = interaction.customId.split('_');
        if (parts.length < 4) {
            return interaction.reply({ content: 'Invalid button format.', ephemeral: true });
        }
        const guildId = parts[2];
        const targetUserId = parts[3];

        // Check pending verification
        const pending = await bot.database.get(
            `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
            [guildId, targetUserId]
        );

        if (!pending) {
            return interaction.reply({ content: '❌ No pending verification found. Please start a new verification.', ephemeral: true });
        }

        // Verify the user
        const guild = bot.client.guilds.cache.get(guildId);
        if (!guild) return interaction.reply({ content: 'Guild not found for verification.', ephemeral: true });
        
        const member = await guild.members.fetch(targetUserId).catch(() => null);
        if (!member) return interaction.reply({ content: 'You are no longer in the server.', ephemeral: true });
        
        const config = await bot.database.getGuildConfig(guildId);
        if (config?.verified_role_id) {
            await member.roles.add(config.verified_role_id).catch(() => {});
        }
        if (config?.unverified_role_id) {
            await member.roles.remove(config.unverified_role_id).catch(() => {});
        }
        
        if (bot.userVerification && typeof bot.userVerification.markVerified === 'function') {
            await bot.userVerification.markVerified(member, 'button').catch(() => {});
        }
        
        await bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
        return interaction.reply({ content: '✅ You are now verified. Welcome!', ephemeral: true });
    } catch (err) {
        bot.logger?.error('[InteractionCreate] Dynamic verify button error:', err);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: '❌ Verification failed. Please contact staff.', ephemeral: true });
        }
    }
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenu(interaction, bot) {
    // Channel access role selection
    if (interaction.customId.startsWith('channel_access_select_')) {
        const channelAccessHandler = require('../../events/channelAccessHandler');
        await channelAccessHandler.handleChannelAccessSelect(interaction, bot);
        return;
    }
    // Ticket category selection
    if (interaction.customId === 'ticket_category_select') {
        if (bot.enhancedTicketManager) {
            await bot.enhancedTicketManager.handleTicketButton(interaction);
        }
    }
    // Settings category selection
    else if (interaction.customId === 'settings_category_select') {
        if (bot.settingsManager) {
            await bot.settingsManager.handleSettingsInteraction(interaction);
        }
    }
    // Help category selection
    else if (interaction.customId === 'help-category-select') {
        const category = interaction.values[0];
        
        if (!bot.helpTicketSystem) {
            return await interaction.reply({ content: '❌ Help ticket system not available', ephemeral: true });
        }

        // Show modal for the selected category
        const modal = new ModalBuilder()
            .setCustomId(`help-ticket-modal-${category}`)
            .setTitle(`🆘 ${bot.helpTicketSystem.getCategoryLabel(category)}`);

        const subjectInput = new TextInputBuilder()
            .setCustomId('help-subject')
            .setLabel('Subject/Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Brief description of your issue')
            .setMinLength(5)
            .setMaxLength(100)
            .setRequired(true);

        const reasonInput = new TextInputBuilder()
            .setCustomId('help-reason')
            .setLabel('Reason')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Why do you need help with this?')
            .setMinLength(5)
            .setMaxLength(200)
            .setRequired(true);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('help-description')
            .setLabel('Detailed Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Please provide as much detail as possible...')
            .setMinLength(10)
            .setMaxLength(2000)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(subjectInput),
            new ActionRowBuilder().addComponents(reasonInput),
            new ActionRowBuilder().addComponents(descriptionInput)
        );

        await interaction.showModal(modal);
    }
}

/**
 * Handle Appeal button interactions
 */
async function handleAppealButton(interaction, bot) {
    if (!bot.appealSystem) {
        return interaction.reply({ content: '❌ Appeal system is not available.', ephemeral: true });
    }

    const customId = interaction.customId;

    // Submit appeal button (from DM)
    if (customId.startsWith('appeal_submit_')) {
        const guildId = customId.replace('appeal_submit_', '');
        
        // Check if they can submit
        const { allowed, reason } = await bot.appealSystem.canSubmitAppeal(guildId, interaction.user.id);
        if (!allowed) {
            return interaction.reply({ content: `❌ ${reason}`, ephemeral: true });
        }

        // Show modal
        const modal = new (require('discord.js').ModalBuilder)()
            .setCustomId(`appeal_modal_${guildId}`)
            .setTitle('Ban Appeal');

        const reasonInput = new (require('discord.js').TextInputBuilder)()
            .setCustomId('appeal_reason')
            .setLabel('Why should your ban be lifted?')
            .setStyle(require('discord.js').TextInputStyle.Paragraph)
            .setPlaceholder('Explain why you believe you should be unbanned...')
            .setRequired(true)
            .setMaxLength(1000);

        const additionalInput = new (require('discord.js').TextInputBuilder)()
            .setCustomId('additional_info')
            .setLabel('Additional information (optional)')
            .setStyle(require('discord.js').TextInputStyle.Paragraph)
            .setPlaceholder('Any other information you want to provide...')
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(
            new (require('discord.js').ActionRowBuilder)().addComponents(reasonInput),
            new (require('discord.js').ActionRowBuilder)().addComponents(additionalInput)
        );

        await interaction.showModal(modal);
        return;
    }

    // Approve appeal
    if (customId.startsWith('appeal_approve_')) {
        const appealId = parseInt(customId.replace('appeal_approve_', ''));
        
        if (!interaction.member.permissions.has(require('discord.js').PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ You need Ban Members permission.', ephemeral: true });
        }

        const result = await bot.appealSystem.approveAppeal(appealId, interaction.user.id);
        
        if (result.success) {
            await interaction.update({ 
                content: `✅ Appeal #${appealId} approved by ${interaction.user.tag}`,
                components: []
            });
        } else {
            await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
        return;
    }

    // Deny appeal
    if (customId.startsWith('appeal_deny_')) {
        const appealId = parseInt(customId.replace('appeal_deny_', ''));
        
        if (!interaction.member.permissions.has(require('discord.js').PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ You need Ban Members permission.', ephemeral: true });
        }

        const result = await bot.appealSystem.denyAppeal(appealId, interaction.user.id);
        
        if (result.success) {
            await interaction.update({ 
                content: `❌ Appeal #${appealId} denied by ${interaction.user.tag}`,
                components: []
            });
        } else {
            await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
        return;
    }

    // Request more info
    if (customId.startsWith('appeal_info_')) {
        const appealId = parseInt(customId.replace('appeal_info_', ''));
        await interaction.reply({ 
            content: `📝 Use \`/appeal view ${appealId}\` to see full details and contact the user if needed.`,
            ephemeral: true 
        });
        return;
    }
}

/**
 * Handle ModMail button interactions
 */
async function handleModMailButton(interaction, bot) {
    if (!bot.modmail) {
        return interaction.reply({ content: '❌ ModMail system is not available.', ephemeral: true });
    }

    const customId = interaction.customId;

    // Guild selection from DM
    if (customId.startsWith('modmail_select_')) {
        const guildId = customId.replace('modmail_select_', '');
        await bot.modmail.handleGuildSelection(interaction, guildId);
        return;
    }

    // Close ticket button
    if (customId.startsWith('modmail_close_')) {
        const ticketId = parseInt(customId.replace('modmail_close_', ''));
        await interaction.reply('🔒 Closing ticket...');
        await bot.modmail.closeTicket(ticketId, interaction.user.id);
        return;
    }

    // Claim ticket button
    if (customId.startsWith('modmail_claim_')) {
        const ticketId = parseInt(customId.replace('modmail_claim_', ''));
        const claimed = await bot.modmail.claimTicket(ticketId, interaction.user.id);
        
        if (claimed) {
            await interaction.reply(`✅ Ticket claimed by ${interaction.user.tag}`);
        } else {
            await interaction.reply({ content: '❌ Could not claim ticket.', ephemeral: true });
        }
        return;
    }
}

/**
 * Handle Quarantine button interactions
 */
async function handleQuarantineButton(interaction, bot) {
    if (!bot.quarantineSystem) {
        return interaction.reply({ content: '❌ Quarantine system is not available.', ephemeral: true });
    }

    const customId = interaction.customId;
    const { PermissionFlagsBits } = require('discord.js');

    // Check permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: '❌ You need Moderate Members permission.', ephemeral: true });
    }

    // Release from quarantine
    if (customId.startsWith('quarantine_release_')) {
        const userId = customId.replace('quarantine_release_', '');
        
        const result = await bot.quarantineSystem.releaseUser(interaction.guildId, userId, {
            moderatorId: interaction.user.id,
            notes: 'Released via review button'
        });

        if (result.success) {
            await interaction.update({
                content: `🔓 User <@${userId}> released by ${interaction.user.tag}`,
                components: []
            });
        } else {
            await interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
        }
        return;
    }

    // Kick quarantined user
    if (customId.startsWith('quarantine_kick_')) {
        const userId = customId.replace('quarantine_kick_', '');
        
        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return interaction.reply({ content: '❌ You need Kick Members permission.', ephemeral: true });
        }

        try {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            if (member) {
                await member.kick('Kicked from quarantine review');
            }
            
            await interaction.update({
                content: `👢 User <@${userId}> kicked by ${interaction.user.tag}`,
                components: []
            });
        } catch (error) {
            await interaction.reply({ content: `❌ Failed to kick: ${error.message}`, ephemeral: true });
        }
        return;
    }

    // Ban quarantined user
    if (customId.startsWith('quarantine_ban_')) {
        const userId = customId.replace('quarantine_ban_', '');
        
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ content: '❌ You need Ban Members permission.', ephemeral: true });
        }

        try {
            await interaction.guild.members.ban(userId, { reason: 'Banned from quarantine review', deleteMessageDays: 1 });
            
            await interaction.update({
                content: `🔨 User <@${userId}> banned by ${interaction.user.tag}`,
                components: []
            });
        } catch (error) {
            await interaction.reply({ content: `❌ Failed to ban: ${error.message}`, ephemeral: true });
        }
        return;
    }
}

/**
 * Handle autocomplete interactions
 */
async function handleAutocomplete(interaction, bot) {
    try {
        const command = bot.commands.get(interaction.commandName);
        
        if (!command || !command.autocomplete) {
            return await interaction.respond([]);
        }
        
        await command.autocomplete(interaction);
    } catch (error) {
        console.error(`Error handling autocomplete for ${interaction.commandName}:`, error);
        try {
            await interaction.respond([]);
        } catch (e) {
            // Ignore if we can't respond
        }
    }
}

/**
 * Handle modal submissions
 */
async function handleModalSubmit(interaction, bot) {
    if (interaction.customId === 'ticket_modal') {
        await bot.handleTicketSubmit(interaction);
    } else if (interaction.customId === 'ticket_create_modal') {
        if (bot.ticketSystem) {
            await bot.ticketSystem.handleModalSubmit(interaction);
        }
    } else if (interaction.customId === 'help-modal') {
        await bot.handleHelpModal(interaction);
    } else if (interaction.customId.startsWith('help-ticket-modal-')) {
        // Handle help ticket modal submission
        await bot.handleHelpTicketModal(interaction);
    } else if (interaction.customId.startsWith('appeal_modal_')) {
        // Handle appeal modal submission
        await handleAppealModalSubmit(interaction, bot);
    } else if (interaction.customId.startsWith('verify_modal_')) {
        // Handle verification code modal submission
        await handleVerifyModalSubmit(interaction, bot);
    }
}

/**
 * Handle verification modal submission (captcha code)
 */
async function handleVerifyModalSubmit(interaction, bot) {
    try {
        const parts = interaction.customId.split('_');
        const guildId = parts[2];
        const userId = parts[3];

        if (interaction.user.id !== userId) {
            return interaction.reply({ content: '❌ This verification is not for you.', ephemeral: true });
        }

        const enteredCode = interaction.fields.getTextInputValue('verification_code').trim().toUpperCase();
        
        // Get pending verification
        const pending = await bot.database.get(
            `SELECT * FROM verification_queue WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
            [guildId, userId]
        );

        if (!pending) {
            return interaction.reply({ content: '❌ No pending verification found. Please click verify button again.', ephemeral: true });
        }

        // Check if expired
        if (pending.expires_at && new Date(pending.expires_at).getTime() < Date.now()) {
            await bot.database.run(`DELETE FROM verification_queue WHERE id = ?`, [pending.id]);
            return interaction.reply({ content: '⏰ Your code expired. Please click verify button to get a new code.', ephemeral: true });
        }

        // Check attempts
        const attempts = (pending.attempts || 0) + 1;
        if (attempts >= 5) {
            await bot.database.run(`DELETE FROM verification_queue WHERE id = ?`, [pending.id]);
            return interaction.reply({ content: '❌ Too many attempts. Please click verify button to get a new code.', ephemeral: true });
        }

        // Parse verification data
        let data = {};
        try {
            data = JSON.parse(pending.verification_data || '{}');
        } catch (e) {}

        // Check code
        const crypto = require('crypto');
        const enteredHash = crypto.createHash('sha256').update(enteredCode.toLowerCase()).digest('hex');
        
        if (data.codeHash && enteredHash !== data.codeHash) {
            // Wrong code
            await bot.database.run(`UPDATE verification_queue SET attempts = ? WHERE id = ?`, [attempts, pending.id]);
            return interaction.reply({ 
                content: `❌ Incorrect code. You have ${5 - attempts} attempts remaining.`, 
                ephemeral: true 
            });
        }

        // Code correct! Verify the user
        const guild = bot.client.guilds.cache.get(guildId);
        if (!guild) {
            return interaction.reply({ content: '❌ Server not found.', ephemeral: true });
        }

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return interaction.reply({ content: '❌ You are no longer in the server.', ephemeral: true });
        }

        const config = await bot.database.get(
            `SELECT verified_role_id, unverified_role_id FROM guild_configs WHERE guild_id = ?`,
            [guildId]
        );

        if (config?.verified_role_id) {
            await member.roles.add(config.verified_role_id).catch(() => {});
        }
        if (config?.unverified_role_id) {
            await member.roles.remove(config.unverified_role_id).catch(() => {});
        }

        if (bot.userVerification && typeof bot.userVerification.markVerified === 'function') {
            await bot.userVerification.markVerified(member, 'captcha').catch(() => {});
        }

        await bot.database.run(`UPDATE verification_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [pending.id]);
        
        return interaction.reply({ 
            content: '✅ **Verification Complete!**\n\nYou now have access to the rest of the server. Welcome!', 
            ephemeral: true 
        });
    } catch (err) {
        bot.logger?.error('[InteractionCreate] verify_modal error:', err);
        if (!interaction.replied && !interaction.deferred) {
            return interaction.reply({ content: '❌ An error occurred. Please try again.', ephemeral: true });
        }
    }
}

/**
 * Handle appeal modal submission
 */
async function handleAppealModalSubmit(interaction, bot) {
    const guildId = interaction.customId.replace('appeal_modal_', '');
    
    const appealReason = interaction.fields.getTextInputValue('appeal_reason');
    const additionalInfo = interaction.fields.getTextInputValue('additional_info');

    const result = await bot.appealSystem.submitAppeal(guildId, interaction.user.id, {
        appealReason,
        additionalInfo,
        banReason: null // Will be fetched from ban record if available
    });

    if (result.success) {
        await interaction.reply({
            content: `✅ Your appeal has been submitted (Appeal #${result.appealId}). You will be notified when staff reviews it.`,
            ephemeral: true
        });
    } else {
        await interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true
        });
    }
}

