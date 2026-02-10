/**
 * /help Command - REBUILT
 * 
 * This is a clean implementation that:
 * 1. Uses a SINGLE interaction flow with correct acknowledgements
 * 2. NO defer before showModal (Discord requirement)
 * 3. All buttons use interaction.update() for navigation
 * 4. Modal → ticket creation is handled in ONE place
 * 5. All custom IDs are prefixed to avoid conflicts
 * 
 * FLOW:
 * /help → embed with category buttons
 * button click → update embed to show category commands
 * "Create Ticket" button → showModal (NO defer!)
 * modal submit → deferReply → create ticket → editReply
 */

const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

// Help category definitions - single source of truth
const HELP_CATEGORIES = {
    moderation: {
        emoji: '🔨',
        label: 'Moderation',
        color: 0xff6b6b,
        description: 'Manage and moderate your community',
        commands: [
            { name: '/kick', desc: 'Kick a member from the server' },
            { name: '/ban', desc: 'Ban a member from the server' },
            { name: '/unban', desc: 'Unban a user by ID' },
            { name: '/timeout', desc: 'Timeout a member' },
            { name: '/warn', desc: 'Issue a warning to a member' },
            { name: '/purge', desc: 'Delete multiple messages' },
            { name: '/lock', desc: 'Lock a channel' },
            { name: '/unlock', desc: 'Unlock a channel' }
        ]
    },
    security: {
        emoji: '🛡️',
        label: 'Security',
        color: 0x00d4ff,
        description: 'Protection against raids, spam, and attacks',
        commands: [
            { name: '/automod', desc: 'Configure automod settings' },
            { name: '/antinuke', desc: 'Anti-nuke protection' },
            { name: '/security', desc: 'Security dashboard' },
            { name: '/quarantine', desc: 'Quarantine suspicious users' }
        ]
    },
    setup: {
        emoji: '⚙️',
        label: 'Setup',
        color: 0xffd43b,
        description: 'Server configuration and settings',
        commands: [
            { name: '/setup wizard', desc: 'Interactive setup wizard' },
            { name: '/setup welcome', desc: 'Configure welcome messages' },
            { name: '/setup goodbye', desc: 'Configure goodbye messages' },
            { name: '/setup roles', desc: 'Auto-role configuration' },
            { name: '/setup language', desc: 'Set server language' }
        ]
    },
    utility: {
        emoji: '🔧',
        label: 'Utility',
        color: 0x5865f2,
        description: 'Information and utility commands',
        commands: [
            { name: '/help', desc: 'This help menu' },
            { name: '/ping', desc: 'Check bot latency' },
            { name: '/serverinfo', desc: 'View server information' },
            { name: '/userinfo', desc: 'View user information' },
            { name: '/rank', desc: 'Check your XP rank' },
            { name: '/leaderboard', desc: 'View XP leaderboard' }
        ]
    },
    tickets: {
        emoji: '🎫',
        label: 'Tickets',
        color: 0x51cf66,
        description: 'Support ticket system',
        commands: [
            { name: '/ticket create', desc: 'Create a support ticket' },
            { name: '/ticket close', desc: 'Close a ticket' },
            { name: '/ticket add', desc: 'Add user to ticket' }
        ]
    }
};

// Custom ID prefixes to avoid conflicts
const PREFIX = 'helpv2';
const BUTTON_CATEGORY = `${PREFIX}_cat_`;      // helpv2_cat_moderation
const BUTTON_BACK = `${PREFIX}_back`;          // helpv2_back
const BUTTON_TICKET = `${PREFIX}_ticket_`;     // helpv2_ticket_moderation
const MODAL_TICKET = `${PREFIX}_modal_`;       // helpv2_modal_moderation

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with bot commands')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Jump to a specific category')
                .setRequired(false)
                .addChoices(
                    ...Object.entries(HELP_CATEGORIES).map(([key, cat]) => ({
                        name: `${cat.emoji} ${cat.label}`,
                        value: key
                    }))
                )),

    // Export constants for the interaction handler
    PREFIX,
    BUTTON_CATEGORY,
    BUTTON_BACK,
    BUTTON_TICKET,
    MODAL_TICKET,
    HELP_CATEGORIES,

    async execute(interaction) {
        const category = interaction.options.getString('category');
        
        // If category specified, show that category directly
        if (category && HELP_CATEGORIES[category]) {
            const embed = this.buildCategoryEmbed(category);
            const components = this.buildCategoryComponents(category);
            return interaction.reply({ embeds: [embed], components, ephemeral: true });
        }
        
        // Show main help menu
        const embed = this.buildMainEmbed(interaction.client);
        const components = this.buildMainComponents();
        return interaction.reply({ embeds: [embed], components, ephemeral: true });
    },

    /**
     * Build the main help embed
     */
    buildMainEmbed(client) {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ DarkLock Help')
            .setDescription('Select a category below to see available commands')
            .setColor(0x00d4ff)
            .setTimestamp();

        if (client?.user) {
            embed.setThumbnail(client.user.displayAvatarURL({ size: 256 }));
        }

        // Add category overview
        const categoryList = Object.entries(HELP_CATEGORIES)
            .map(([_, cat]) => `${cat.emoji} **${cat.label}** - ${cat.description}`)
            .join('\n');

        embed.addFields({ name: 'Categories', value: categoryList });
        embed.setFooter({ text: 'Click a button below to explore commands' });

        return embed;
    },

    /**
     * Build main menu button components
     */
    buildMainComponents() {
        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${BUTTON_CATEGORY}moderation`)
                .setLabel('Moderation')
                .setEmoji('🔨')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${BUTTON_CATEGORY}security`)
                .setLabel('Security')
                .setEmoji('🛡️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${BUTTON_CATEGORY}setup`)
                .setLabel('Setup')
                .setEmoji('⚙️')
                .setStyle(ButtonStyle.Secondary)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${BUTTON_CATEGORY}utility`)
                .setLabel('Utility')
                .setEmoji('🔧')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${BUTTON_CATEGORY}tickets`)
                .setLabel('Tickets')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Secondary)
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Dashboard')
                .setStyle(ButtonStyle.Link)
                .setURL(process.env.DASHBOARD_URL || 'https://discord-security-bot-uyx6.onrender.com')
                .setEmoji('🌐'),
            new ButtonBuilder()
                .setLabel('Support Server')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/Vsq9PUTrgb')
                .setEmoji('🤝')
        );

        return [row1, row2, row3];
    },

    /**
     * Build category detail embed
     */
    buildCategoryEmbed(categoryKey) {
        const cat = HELP_CATEGORIES[categoryKey];
        if (!cat) return null;

        const embed = new EmbedBuilder()
            .setTitle(`${cat.emoji} ${cat.label} Commands`)
            .setDescription(cat.description)
            .setColor(cat.color)
            .setTimestamp();

        const commandList = cat.commands
            .map(cmd => `**${cmd.name}** - ${cmd.desc}`)
            .join('\n');

        embed.addFields({ name: 'Commands', value: commandList || 'No commands' });
        embed.setFooter({ text: 'Click "Back" to return to categories' });

        return embed;
    },

    /**
     * Build category page components
     */
    buildCategoryComponents(categoryKey) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(BUTTON_BACK)
                .setLabel('Back')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${BUTTON_TICKET}${categoryKey}`)
                .setLabel('Create Support Ticket')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Primary)
        );

        return [row];
    },

    /**
     * Build ticket modal
     */
    buildTicketModal(categoryKey) {
        const cat = HELP_CATEGORIES[categoryKey] || { label: 'General' };

        const modal = new ModalBuilder()
            .setCustomId(`${MODAL_TICKET}${categoryKey}`)
            .setTitle('🎫 Create Support Ticket');

        const subjectInput = new TextInputBuilder()
            .setCustomId('ticket_subject')
            .setLabel('Subject')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Brief description of your issue')
            .setMinLength(5)
            .setMaxLength(100)
            .setRequired(true);

        const categoryInput = new TextInputBuilder()
            .setCustomId('ticket_category')
            .setLabel('Category')
            .setStyle(TextInputStyle.Short)
            .setValue(cat.label)
            .setRequired(true);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('ticket_description')
            .setLabel('Description')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Please describe your issue in detail...')
            .setMinLength(20)
            .setMaxLength(2000)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(subjectInput),
            new ActionRowBuilder().addComponents(categoryInput),
            new ActionRowBuilder().addComponents(descriptionInput)
        );

        return modal;
    }
};
