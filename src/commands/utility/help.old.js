const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

/**
 * Help command with updated categories for consolidated command structure
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with bot commands')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('View commands by category')
                .setRequired(false)
                .addChoices(
                    { name: '⚙️ Setup & Config', value: 'setup' },
                    { name: '⚠️ Admin Actions', value: 'admin' },
                    { name: '🛡️ Security & Automod', value: 'security' },
                    { name: '🔨 Moderation', value: 'moderation' },
                    { name: '📊 Utility & Info', value: 'utility' }
                ))
        .addStringOption(option =>
            option.setName('command')
                .setDescription('Get detailed help for a specific command')
                .setRequired(false)),

    async execute(interaction) {
        const category = interaction.options.getString('category');
        const commandName = interaction.options.getString('command');
        
        await interaction.deferReply({ ephemeral: true });

        if (commandName) {
            return this.showCommandHelp(interaction, commandName);
        }
        if (category) {
            return this.showCategoryHelp(interaction, category);
        }
        return this.showOverview(interaction);
    },

    async showOverview(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ DarkLock Help')
            .setDescription('Advanced Discord security and moderation')
            .setColor('#00d4ff')
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .addFields(
                { name: '⚙️ Setup & Config', value: '`/setup` - All server configuration\n• Wizard, welcome/goodbye, autoroles, permissions, language', inline: false },
                { name: '⚠️ Admin Actions', value: '`/admin` - Destructive operations\n• Lockdown, unlock, slowmode, nuke, audit', inline: false },
                { name: '🛡️ Security & Automod', value: '`/automod` - Automated protection\n`/security` - Dashboard\n`/antinuke` - Nuke prevention', inline: false },
                { name: '🔨 Moderation', value: '`/ban` `/kick` `/timeout` `/warn` `/purge`\n`/modnote` `/cases` `/quarantine`', inline: false },
                { name: '📊 Utility', value: '`/ticket` `/help` `/ping` `/userinfo` `/serverinfo`\n`/rank` `/leaderboard` `/analytics`', inline: false },
                { name: '💡 Tips', value: '• `/help category:setup` for category details\n• `/help command:ban` for specific help\n• `/setup wizard start` for first-time setup', inline: false }
            )
            .setFooter({ text: 'Use the menu below to explore categories' })
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('help_category_select')
            .setPlaceholder('Select a category for more details')
            .addOptions(
                { label: 'Setup & Config', value: 'setup', emoji: '⚙️', description: 'Server configuration commands' },
                { label: 'Admin Actions', value: 'admin', emoji: '⚠️', description: 'Destructive admin operations' },
                { label: 'Security', value: 'security', emoji: '🛡️', description: 'Automod and protection' },
                { label: 'Moderation', value: 'moderation', emoji: '🔨', description: 'Staff moderation tools' },
                { label: 'Utility', value: 'utility', emoji: '📊', description: 'Info and utility commands' }
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Dashboard')
                .setStyle(ButtonStyle.Link)
                .setURL(process.env.DASHBOARD_URL || 'https://discord-security-bot-uyx6.onrender.com')
                .setEmoji('🌐'),
            new ButtonBuilder()
                .setLabel('Quick Setup')
                .setStyle(ButtonStyle.Primary)
                .setCustomId('help_quick_setup')
                .setEmoji('🚀')
        );

        await interaction.editReply({ embeds: [embed], components: [row, buttonRow] });
    },

    async showCategoryHelp(interaction, category) {
        const guildId = interaction.guild.id;
        const bot = interaction.client;
        
        const categories = {
            setup: {
                title: '⚙️ Setup & Configuration',
                description: 'All server configuration through unified commands',
                commands: {
                    'setup wizard': 'Interactive setup wizard (start, restart, cancel, status)',
                    'setup welcome': 'Welcome messages (setup, disable, customize, test, status)',
                    'setup goodbye': 'Goodbye messages (setup, disable, customize, test, status)',
                    'setup onboarding': 'Verification system (enable, disable, channel, message)',
                    'setup roles': 'Auto-roles (add, remove, list)',
                    'setup permissions': 'Command permissions (set-group, set-command, list, clear)',
                    'setup language': 'Server language (set, current, list)'
                },
                color: '#5865F2'
            },
            admin: {
                title: '⚠️ Admin Actions',
                description: 'Destructive operations requiring administrator',
                commands: {
                    'admin lockdown': 'Lock ALL text channels for @everyone',
                    'admin unlock': 'Unlock ALL text channels for @everyone',
                    'admin slowmode': 'Set slowmode (seconds, scope: here/all)',
                    'admin nuke': 'Clone & delete current channel',
                    'admin audit': 'Audit permissions (type: overview/roles)'
                },
                color: '#ed4245'
            },
            security: {
                title: '🛡️ Security & Automod',
                description: 'Automated protection systems',
                commands: {
                    'automod status': 'View all automod settings',
                    'automod spam': 'Anti-spam protection (enable, disable, config)',
                    'automod raid': 'Raid detection (enable, disable, config)',
                    'automod links': 'Link filtering (enable, disable, config)',
                    'automod phishing': 'Phishing detection (enable, disable, config)',
                    'automod emoji': 'Emoji spam filter (enable, disable, config)',
                    'antinuke': 'Anti-nuke protection',
                    'security': 'Security dashboard',
                    'wordfilter': 'Custom word filtering'
                },
                color: '#57f287'
            },
            moderation: {
                title: '🔨 Moderation',
                description: 'Staff moderation tools',
                commands: {
                    'ban': 'Ban a member',
                    'unban': 'Unban a user',
                    'kick': 'Kick a member',
                    'timeout': 'Timeout a member',
                    'warn': 'Issue a warning',
                    'purge': 'Delete messages in bulk',
                    'modnote': 'Add moderator notes',
                    'cases': 'View moderation cases',
                    'quarantine': 'Quarantine suspicious users',
                    'lock': 'Lock current channel',
                    'unlock': 'Unlock current channel',
                    'slowmode': 'Set channel slowmode'
                },
                color: '#faa61a'
            },
            utility: {
                title: '📊 Utility & Info',
                description: 'Information and utility commands',
                commands: {
                    'ticket': 'Support ticket system',
                    'help': 'This help command',
                    'ping': 'Check bot latency',
                    'userinfo': 'View user information',
                    'serverinfo': 'View server information',
                    'rank': 'Check XP rank',
                    'leaderboard': 'View XP leaderboard',
                    'analytics': 'Server analytics',
                    'announce': 'Make announcements'
                },
                color: '#5865F2'
            }
        };

        const cat = categories[category];
        if (!cat) {
            const msg = bot.languageSystem?.t(guildId, 'errors.unknownCategory') || '❌ Unknown category';
            return interaction.editReply({ content: msg });
        }

        const commandList = Object.entries(cat.commands).map(([cmd, desc]) => `\`/${cmd}\` - ${desc}`).join('\n');
        const embed = new EmbedBuilder()
            .setTitle(cat.title)
            .setDescription(cat.description)
            .setColor(cat.color)
            .addFields({ name: 'Commands', value: commandList || 'No commands' })
            .setFooter({ text: 'Use /help command:<name> for specific help' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },

    async showCommandHelp(interaction, commandName) {
        const guildId = interaction.guild.id;
        const bot = interaction.client;
        const command = interaction.client.commands.get(commandName);
        
        if (!command) {
            const deprecatedMap = {
                'welcome': '/setup welcome',
                'goodbye': '/setup goodbye',
                'wizard': '/setup wizard',
                'autorole': '/setup roles',
                'onboarding': '/setup onboarding',
                'permissions': '/setup permissions',
                'language': '/setup language',
                'lockdown': '/admin lockdown',
                'unlockdown': '/admin unlock',
                'rolescan': '/admin audit type:roles',
                'anti-spam': '/automod spam',
                'anti-raid': '/automod raid',
                'anti-links': '/automod links',
                'anti-phishing': '/automod phishing',
                'emojispam': '/automod emoji'
            };

            if (deprecatedMap[commandName]) {
                return interaction.editReply({
                    content: `⚠️ **Command Moved**\n\`/${commandName}\` → \`${deprecatedMap[commandName]}\``
                });
            }
            const msg = bot.languageSystem?.t(guildId, 'errors.commandNotFound', { command: commandName }) || `❌ No command found: \`${commandName}\``;
            return interaction.editReply({ content: msg });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📖 /${command.data.name}`)
            .setDescription(command.data.description || 'No description')
            .setColor('#00d4ff')
            .setTimestamp();

        if (command.data.options?.length > 0) {
            const groups = command.data.options.filter(o => o.type === 2);
            const subs = command.data.options.filter(o => o.type === 1);
            const opts = command.data.options.filter(o => o.type !== 1 && o.type !== 2);

            if (groups.length > 0) {
                const groupList = groups.map(g => `**${g.name}**: ${g.options?.map(s => s.name).join(', ') || 'none'}`).join('\n');
                embed.addFields({ name: 'Subcommand Groups', value: groupList });
            }
            if (subs.length > 0) {
                const subList = subs.map(s => `\`${s.name}\` - ${s.description || 'No description'}`).join('\n');
                embed.addFields({ name: 'Subcommands', value: subList });
            }
            if (opts.length > 0) {
                const optList = opts.map(o => `\`${o.name}\` ${o.required ? '(required)' : '(optional)'} - ${o.description || ''}`).join('\n');
                embed.addFields({ name: 'Options', value: optList });
            }
        }

        if (command.deprecated) {
            embed.setColor('#faa61a');
            embed.addFields({ name: '⚠️ Deprecated', value: `Use \`${command.newCommand}\` instead.` });
        }

        await interaction.editReply({ embeds: [embed] });
    }
};
