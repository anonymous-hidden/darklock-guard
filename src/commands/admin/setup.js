/**
 * /setup - Unified Server Configuration Command
 * All server configuration happens through this single command
 * 
 * Structure:
 * /setup view - View all server configuration at once
 * /setup wizard [start|restart|cancel|status]
 * /setup onboarding [mode|verify-channel|verify-message|verify-test]
 * /setup welcome [setup|disable|customize|test|status]
 * /setup goodbye [setup|disable|customize|test|status]
 * /setup roles [add|remove|list]
 * /setup permissions [set-group|set-command|list|clear]
 * /setup language [set|current|list]
 */

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { wizardHandlers, onboardingHandlers, autoroleHandlers, permissionHandlers, welcomeHandlers, goodbyeHandlers } = require('../handlers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('🔧 Unified server configuration - All settings in one place')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        
        // ============ VIEW SUBCOMMAND (Top-level, not in a group) ============
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('📊 View all server configuration at once'))
        
        // ============ WIZARD SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('wizard')
            .setDescription('Interactive setup wizard')
            .addSubcommand(sub => sub
                .setName('start')
                .setDescription('Start the interactive setup wizard'))
            .addSubcommand(sub => sub
                .setName('restart')
                .setDescription('Restart the setup wizard from scratch'))
            .addSubcommand(sub => sub
                .setName('cancel')
                .setDescription('Cancel current wizard session'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('Check setup completion status')))
        
        // ============ WELCOME SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('welcome')
            .setDescription('Welcome messages for new members')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set up welcome messages')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Channel for welcome messages')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('message')
                    .setDescription('Welcome message (use {user}, {server}, {memberCount})')
                    .setRequired(false)))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable welcome messages'))
            .addSubcommand(sub => sub
                .setName('customize')
                .setDescription('Customize welcome message with embed')
                .addStringOption(opt => opt
                    .setName('message')
                    .setDescription('Welcome message')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('embed_title')
                    .setDescription('Embed title (optional)'))
                .addStringOption(opt => opt
                    .setName('embed_color')
                    .setDescription('Hex color (e.g., #00d4ff)'))
                .addStringOption(opt => opt
                    .setName('image_url')
                    .setDescription('Image URL for embed')))
            .addSubcommand(sub => sub
                .setName('test')
                .setDescription('Send a test welcome message'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View current welcome configuration')))
        
        // ============ GOODBYE SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('goodbye')
            .setDescription('Goodbye messages for leaving members')
            .addSubcommand(sub => sub
                .setName('setup')
                .setDescription('Set up goodbye messages')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Channel for goodbye messages')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('message')
                    .setDescription('Goodbye message (use {user}, {server}, {memberCount})')
                    .setRequired(false)))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable goodbye messages'))
            .addSubcommand(sub => sub
                .setName('customize')
                .setDescription('Customize goodbye message with embed')
                .addStringOption(opt => opt
                    .setName('message')
                    .setDescription('Goodbye message')
                    .setRequired(true))
                .addStringOption(opt => opt
                    .setName('embed_title')
                    .setDescription('Embed title (optional)'))
                .addStringOption(opt => opt
                    .setName('embed_color')
                    .setDescription('Hex color (e.g., #ff6b6b)'))
                .addStringOption(opt => opt
                    .setName('image_url')
                    .setDescription('Image URL for embed')))
            .addSubcommand(sub => sub
                .setName('test')
                .setDescription('Send a test goodbye message'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View current goodbye configuration')))
        
        // ============ ONBOARDING (Verification) SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('onboarding')
            .setDescription('Verification system settings')
            .addSubcommand(sub => sub
                .setName('enable')
                .setDescription('Enable verification mode'))
            .addSubcommand(sub => sub
                .setName('disable')
                .setDescription('Disable verification mode'))
            .addSubcommand(sub => sub
                .setName('status')
                .setDescription('View current verification status'))
            .addSubcommand(sub => sub
                .setName('channel')
                .setDescription('Set verification channel')
                .addChannelOption(opt => opt
                    .setName('channel')
                    .setDescription('Channel for verification')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)))
            .addSubcommand(sub => sub
                .setName('message')
                .setDescription('Set post-verification welcome message')
                .addStringOption(opt => opt
                    .setName('content')
                    .setDescription('Message to send after verification (use {user} and {server})')
                    .setRequired(true)))
            .addSubcommand(sub => sub
                .setName('test')
                .setDescription('Preview the verification message')))
        
        // ============ ROLES SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('roles')
            .setDescription('Auto-role configuration')
            .addSubcommand(sub => sub
                .setName('add')
                .setDescription('Add an auto-assigned role')
                .addRoleOption(opt => opt
                    .setName('role')
                    .setDescription('Role to auto-assign to new members')
                    .setRequired(true)))
            .addSubcommand(sub => sub
                .setName('remove')
                .setDescription('Remove an auto-assigned role')
                .addRoleOption(opt => opt
                    .setName('role')
                    .setDescription('Role to remove from auto-assignment')
                    .setRequired(true)))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List all auto-assigned roles')))
        
        // ============ PERMISSIONS SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('permissions')
            .setDescription('Command permission management')
            .addSubcommand(sub => sub
                .setName('set-group')
                .setDescription('Set roles allowed to use a command group')
                .addStringOption(opt => opt
                    .setName('group')
                    .setDescription('Command group')
                    .setRequired(true)
                    .addChoices(
                        { name: 'admin', value: 'admin' },
                        { name: 'security', value: 'security' },
                        { name: 'moderation', value: 'moderation' },
                        { name: 'utility', value: 'utility' },
                        { name: 'analytics', value: 'analytics' },
                        { name: 'tickets', value: 'tickets' }
                    ))
                .addRoleOption(opt => opt.setName('role1').setDescription('Allowed role 1').setRequired(true))
                .addRoleOption(opt => opt.setName('role2').setDescription('Allowed role 2'))
                .addRoleOption(opt => opt.setName('role3').setDescription('Allowed role 3'))
                .addRoleOption(opt => opt.setName('role4').setDescription('Allowed role 4'))
                .addRoleOption(opt => opt.setName('role5').setDescription('Allowed role 5')))
            .addSubcommand(sub => sub
                .setName('set-command')
                .setDescription('Set roles allowed to use a specific command')
                .addStringOption(opt => opt
                    .setName('command')
                    .setDescription('Command name (e.g., ban)')
                    .setRequired(true))
                .addRoleOption(opt => opt.setName('role1').setDescription('Allowed role 1').setRequired(true))
                .addRoleOption(opt => opt.setName('role2').setDescription('Allowed role 2'))
                .addRoleOption(opt => opt.setName('role3').setDescription('Allowed role 3'))
                .addRoleOption(opt => opt.setName('role4').setDescription('Allowed role 4'))
                .addRoleOption(opt => opt.setName('role5').setDescription('Allowed role 5')))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('View all permission rules'))
            .addSubcommand(sub => sub
                .setName('clear')
                .setDescription('Clear permission rules')
                .addStringOption(opt => opt
                    .setName('scope')
                    .setDescription('What to clear')
                    .addChoices(
                        { name: 'all', value: 'all' },
                        { name: 'group', value: 'group' },
                        { name: 'command', value: 'command' }
                    ))
                .addStringOption(opt => opt
                    .setName('name')
                    .setDescription('Group or command name (if clearing specific)'))))
        
        // ============ LANGUAGE SUBCOMMAND GROUP ============
        .addSubcommandGroup(group => group
            .setName('language')
            .setDescription('Server language settings')
            .addSubcommand(sub => sub
                .setName('set')
                .setDescription('Set the server language')
                .addStringOption(opt => opt
                    .setName('lang')
                    .setDescription('Language to use')
                    .setRequired(true)
                    .addChoices(
                        { name: '🇬🇧 English', value: 'en' },
                        { name: '🇪🇸 Español', value: 'es' },
                        { name: '🇩🇪 Deutsch', value: 'de' },
                        { name: '🇫🇷 Français', value: 'fr' },
                        { name: '🇧🇷 Português', value: 'pt' }
                    )))
            .addSubcommand(sub => sub
                .setName('current')
                .setDescription('View current server language'))
            .addSubcommand(sub => sub
                .setName('list')
                .setDescription('List all supported languages'))),

    async execute(interaction) {
        const bot = interaction.client.bot;
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        // ============ VIEW (Top-level subcommand) ============
        if (!group && sub === 'view') {
            return viewConfigDashboard(interaction, bot);
        }

        // ============ WIZARD ============
        if (group === 'wizard') {
            switch (sub) {
                case 'start':
                    return wizardHandlers.start(interaction, bot, false);
                case 'restart':
                    return wizardHandlers.start(interaction, bot, true);
                case 'cancel':
                    return wizardHandlers.cancel(interaction, bot);
                case 'status':
                    return wizardHandlers.status(interaction, bot);
            }
        }

        // ============ WELCOME ============
        if (group === 'welcome') {
            switch (sub) {
                case 'setup': {
                    const channel = interaction.options.getChannel('channel');
                    const message = interaction.options.getString('message');
                    return welcomeHandlers.setup(interaction, bot, channel, message);
                }
                case 'disable':
                    return welcomeHandlers.disable(interaction, bot);
                case 'customize': {
                    const message = interaction.options.getString('message');
                    const embedTitle = interaction.options.getString('embed_title');
                    const embedColor = interaction.options.getString('embed_color');
                    const imageUrl = interaction.options.getString('image_url');
                    return welcomeHandlers.customize(interaction, bot, message, embedTitle, embedColor, imageUrl);
                }
                case 'test':
                    return welcomeHandlers.test(interaction, bot);
                case 'status':
                    return welcomeHandlers.status(interaction, bot);
            }
        }

        // ============ GOODBYE ============
        if (group === 'goodbye') {
            switch (sub) {
                case 'setup': {
                    const channel = interaction.options.getChannel('channel');
                    const message = interaction.options.getString('message');
                    return goodbyeHandlers.setup(interaction, bot, channel, message);
                }
                case 'disable':
                    return goodbyeHandlers.disable(interaction, bot);
                case 'customize': {
                    const message = interaction.options.getString('message');
                    const embedTitle = interaction.options.getString('embed_title');
                    const embedColor = interaction.options.getString('embed_color');
                    const imageUrl = interaction.options.getString('image_url');
                    return goodbyeHandlers.customize(interaction, bot, message, embedTitle, embedColor, imageUrl);
                }
                case 'test':
                    return goodbyeHandlers.test(interaction, bot);
                case 'status':
                    return goodbyeHandlers.status(interaction, bot);
            }
        }

        // ============ ONBOARDING (Verification) ============
        if (group === 'onboarding') {
            switch (sub) {
                case 'enable':
                    return onboardingHandlers.setMode(interaction, bot, 'verify');
                case 'disable':
                    return onboardingHandlers.setMode(interaction, bot, 'disable');
                case 'status':
                    return onboardingHandlers.setMode(interaction, bot, 'view');
                case 'channel':
                    const channel = interaction.options.getChannel('channel');
                    return onboardingHandlers.setChannel(interaction, bot, channel);
                case 'message':
                    const content = interaction.options.getString('content');
                    return onboardingHandlers.setMessage(interaction, bot, content);
                case 'test':
                    return onboardingHandlers.testMessage(interaction, bot);
            }
        }

        // ============ ROLES ============
        if (group === 'roles') {
            const role = interaction.options.getRole('role');
            switch (sub) {
                case 'add':
                    return autoroleHandlers.add(interaction, bot, role);
                case 'remove':
                    return autoroleHandlers.remove(interaction, bot, role);
                case 'list':
                    return autoroleHandlers.list(interaction, bot);
            }
        }

        // ============ PERMISSIONS ============
        if (group === 'permissions') {
            await interaction.deferReply({ ephemeral: true });
            
            switch (sub) {
                case 'set-group': {
                    const groupName = interaction.options.getString('group');
                    const roles = ['role1','role2','role3','role4','role5']
                        .map(n => interaction.options.getRole(n))
                        .filter(Boolean);
                    return permissionHandlers.setGroup(interaction, bot, groupName, roles);
                }
                case 'set-command': {
                    const cmdName = interaction.options.getString('command');
                    const roles = ['role1','role2','role3','role4','role5']
                        .map(n => interaction.options.getRole(n))
                        .filter(Boolean);
                    return permissionHandlers.setCommand(interaction, bot, cmdName, roles);
                }
                case 'list':
                    return permissionHandlers.list(interaction, bot);
                case 'clear': {
                    const scope = interaction.options.getString('scope') || 'all';
                    const name = interaction.options.getString('name');
                    return permissionHandlers.clear(interaction, bot, scope, name);
                }
            }
        }

        // ============ LANGUAGE ============
        if (group === 'language') {
            const langSystem = bot.languageSystem;
            
            if (!langSystem) {
                return interaction.reply({ content: '❌ Language system is not initialized.', ephemeral: true });
            }
            
            switch (sub) {
                case 'set': {
                    const lang = interaction.options.getString('lang');
                    
                    // Use languageSystem to set language (updates both guild_language and guild_configs)
                    const result = await langSystem.setLanguage(interaction.guild.id, lang);
                    
                    if (!result.success) {
                        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
                    }
                    
                    // Also update guild_configs for consistency
                    await bot.database.run(
                        `UPDATE guild_configs SET language = ? WHERE guild_id = ?`,
                        [lang, interaction.guild.id]
                    );
                    
                    const name = langSystem.getLanguageName(lang);
                    const flag = langSystem.getLanguageFlag(lang);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🌐 Language Updated')
                        .setColor(0x00FF00)
                        .setDescription(`Server language set to ${flag} **${name}**\n\n✅ Bot messages will now use ${name}\n✅ Dashboard will display in ${name}`)
                        .setTimestamp();
                    
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                case 'current': {
                    const lang = await langSystem.getLanguage(interaction.guild.id);
                    const name = langSystem.getLanguageName(lang);
                    const flag = langSystem.getLanguageFlag(lang);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🌐 Current Language')
                        .setColor(0x5865F2)
                        .setDescription(`This server is using ${flag} **${name}** (\`${lang}\`)`);
                    
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
                case 'list': {
                    const languages = langSystem.getSupportedLanguages();
                    const langList = languages.map(l => `${l.flag} **${l.name}** (\`${l.code}\`)`).join('\n');
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🌐 Supported Languages')
                        .setColor(0x5865F2)
                        .setDescription(langList)
                        .setFooter({ text: 'Use /setup language set <code> to change language' });
                    
                    return interaction.reply({ embeds: [embed], ephemeral: true });
                }
            }
        }
    }
};

/**
 * View all server configuration in one dashboard
 */
async function viewConfigDashboard(interaction, bot) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const guildId = interaction.guild.id;
        const config = await bot.database.getGuildConfig(guildId);
        
        // Get automod settings
        const automodConfig = await bot.database.get(
            `SELECT * FROM automod_config WHERE guild_id = ?`,
            [guildId]
        ).catch(() => null);

        // Get auto-roles
        const autoRoles = await bot.database.all(
            `SELECT role_id FROM autoroles WHERE guild_id = ?`,
            [guildId]
        ).catch(() => []);

        // Get permission overrides count
        const permCount = await bot.database.get(
            `SELECT COUNT(*) as count FROM permission_overrides WHERE guild_id = ?`,
            [guildId]
        ).catch(() => ({ count: 0 }));

        // Get ticket config
        const ticketConfig = await bot.database.get(
            `SELECT * FROM ticket_config WHERE guild_id = ?`,
            [guildId]
        ).catch(() => null);

        // Build the embed
        const langNames = { en: '🇬🇧 English', es: '🇪🇸 Español', de: '🇩🇪 Deutsch', fr: '🇫🇷 Français', pt: '🇧🇷 Português' };
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Server Configuration Dashboard')
            .setDescription(`Configuration overview for **${interaction.guild.name}**`)
            .setColor('#5865F2')
            .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
            .setTimestamp();

        // Welcome/Goodbye Section
        const welcomeStatus = config.welcome_enabled 
            ? `✅ <#${config.welcome_channel}>` 
            : '❌ Disabled';
        const goodbyeStatus = config.goodbye_enabled 
            ? `✅ <#${config.goodbye_channel}>` 
            : '❌ Disabled';
        
        embed.addFields({
            name: '👋 Welcome & Goodbye',
            value: `**Welcome:** ${welcomeStatus}\n**Goodbye:** ${goodbyeStatus}`,
            inline: true
        });

        // Verification Section
        const verifyStatus = config.verification_mode === 'verify' 
            ? `✅ ${config.verify_channel ? `<#${config.verify_channel}>` : 'Channel not set'}` 
            : '❌ Disabled';
        
        embed.addFields({
            name: '✅ Verification',
            value: verifyStatus,
            inline: true
        });

        // Language
        embed.addFields({
            name: '🌐 Language',
            value: langNames[config.language || 'en'] || '🇬🇧 English',
            inline: true
        });

        // Auto-roles
        const rolesList = autoRoles.length > 0 
            ? autoRoles.slice(0, 5).map(r => `<@&${r.role_id}>`).join(', ') + (autoRoles.length > 5 ? ` +${autoRoles.length - 5} more` : '')
            : 'None configured';
        
        embed.addFields({
            name: '🎭 Auto-Roles',
            value: rolesList,
            inline: true
        });

        // Automod Section
        if (automodConfig) {
            const automodItems = [];
            if (automodConfig.anti_spam) automodItems.push('🛡️ Spam');
            if (automodConfig.anti_raid) automodItems.push('⚔️ Raid');
            if (automodConfig.anti_links) automodItems.push('🔗 Links');
            if (automodConfig.anti_phishing) automodItems.push('🎣 Phishing');
            if (automodConfig.anti_emoji) automodItems.push('😀 Emoji');
            
            embed.addFields({
                name: '🤖 Automod',
                value: automodItems.length > 0 ? automodItems.join(' | ') : '❌ All disabled',
                inline: true
            });
        } else {
            embed.addFields({
                name: '🤖 Automod',
                value: '❌ Not configured',
                inline: true
            });
        }

        // Permissions
        embed.addFields({
            name: '🔐 Permission Rules',
            value: `${permCount.count || 0} custom rules`,
            inline: true
        });

        // Tickets
        const ticketStatus = ticketConfig?.enabled 
            ? `✅ Staff: <@&${ticketConfig.staff_role}>` 
            : '❌ Not configured';
        
        embed.addFields({
            name: '🎫 Tickets',
            value: ticketStatus,
            inline: true
        });

        // Antinuke
        const antinukeConfig = await bot.database.get(
            `SELECT enabled FROM antinuke_config WHERE guild_id = ?`,
            [guildId]
        ).catch(() => null);
        
        embed.addFields({
            name: '🛡️ Anti-Nuke',
            value: antinukeConfig?.enabled ? '✅ Enabled' : '❌ Disabled',
            inline: true
        });

        // Quick Commands Footer
        embed.addFields({
            name: '⚡ Quick Commands',
            value: [
                '`/setup wizard start` - Interactive setup',
                '`/setup welcome setup` - Configure welcome',
                '`/automod status` - View automod details',
                '`/help category:setup` - Full setup guide'
            ].join('\n'),
            inline: false
        });

        return interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error in setup view:', error);
        return interaction.editReply({
            content: '❌ Failed to load configuration. Please try again.'
        });
    }
}
