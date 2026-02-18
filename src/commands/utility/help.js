/**
 * /help Command - Clean rebuild
 *
 * Flow:
 *   /help               → main menu embed + category buttons
 *   category button     → update embed to show commands (interaction.update)
 *   Back button         → update embed back to main menu (interaction.update)
 *   "Open Ticket" btn   → showModal (NO defer before this!)
 *   modal submit        → deferReply → create ticket → editReply
 *
 * All custom IDs use the 'dl_help_' prefix so routing is unambiguous.
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

// ─── ID constants ─────────────────────────────────────────────────────────────
const PREFIX    = 'dl_help';
const ID_CAT    = 'dl_help_cat_';    // dl_help_cat_moderation
const ID_BACK   = 'dl_help_back';
const ID_TICKET = 'dl_help_ticket_'; // dl_help_ticket_moderation
const ID_MODAL  = 'dl_help_modal_';  // dl_help_modal_moderation

// ─── Category data ────────────────────────────────────────────────────────────
const CATEGORIES = {
    moderation: {
        emoji: '🔨',
        label: 'Moderation',
        color: 0xff6b6b,
        description: 'Manage and moderate your community',
        commands: [
            { name: '/kick',    desc: 'Kick a member from the server' },
            { name: '/ban',     desc: 'Ban a member from the server' },
            { name: '/unban',   desc: 'Unban a user by ID' },
            { name: '/timeout', desc: 'Timeout a member' },
            { name: '/warn',    desc: 'Issue a warning to a member' },
            { name: '/purge',   desc: 'Delete multiple messages at once' },
            { name: '/lock',    desc: 'Lock a channel' },
            { name: '/unlock',  desc: 'Unlock a channel' }
        ]
    },
    security: {
        emoji: '🛡️',
        label: 'Security',
        color: 0x00d4ff,
        description: 'Protection against raids, spam, and attacks',
        commands: [
            { name: '/automod',    desc: 'Configure automod settings' },
            { name: '/antinuke',   desc: 'Anti-nuke protection settings' },
            { name: '/security',   desc: 'View security dashboard' },
            { name: '/lockdown',   desc: 'Lock/unlock all channels' },
            { name: '/quarantine', desc: 'Quarantine a suspicious user' }
        ]
    },
    setup: {
        emoji: '⚙️',
        label: 'Setup',
        color: 0xffd43b,
        description: 'Server configuration and bot settings',
        commands: [
            { name: '/setup wizard',   desc: 'Interactive setup wizard' },
            { name: '/setup welcome',  desc: 'Configure welcome messages' },
            { name: '/setup goodbye',  desc: 'Configure goodbye messages' },
            { name: '/setup roles',    desc: 'Auto-role configuration' },
            { name: '/setup language', desc: 'Set the server language' }
        ]
    },
    utility: {
        emoji: '🔧',
        label: 'Utility',
        color: 0x5865f2,
        description: 'General information and utility commands',
        commands: [
            { name: '/help',        desc: 'This help menu' },
            { name: '/ping',        desc: 'Check bot latency' },
            { name: '/serverinfo',  desc: 'View server information' },
            { name: '/userinfo',    desc: 'View user information' },
            { name: '/rank',        desc: 'Check your XP rank' },
            { name: '/leaderboard', desc: 'View the XP leaderboard' }
        ]
    },
    leveling: {
        emoji: '📈',
        label: 'Leveling',
        color: 0xa78bfa,
        description: 'XP system with ranks and level roles',
        commands: [
            { name: '/rank',        desc: 'View your rank and XP' },
            { name: '/leaderboard', desc: 'View the server leaderboard' },
            { name: '/setlevel',    desc: "Set a user's level (admin)" }
        ]
    },
    tickets: {
        emoji: '🎫',
        label: 'Tickets',
        color: 0x51cf66,
        description: 'Support ticket system',
        commands: [
            { name: '/ticket create', desc: 'Create a support ticket' },
            { name: '/ticket close',  desc: 'Close a ticket' },
            { name: '/ticket add',    desc: 'Add a user to a ticket' }
        ]
    }
};

// ─── Embed builders ───────────────────────────────────────────────────────────
function buildMainEmbed(client) {
    const embed = new EmbedBuilder()
        .setTitle('🛡️ DarkLock — Help Center')
        .setDescription('Choose a category below to browse available commands.')
        .setColor(0x00d4ff)
        .setTimestamp();

    if (client?.user) {
        embed.setThumbnail(client.user.displayAvatarURL({ size: 256 }));
    }

    const list = Object.values(CATEGORIES)
        .map(c => `${c.emoji} **${c.label}** — ${c.description}`)
        .join('\n');

    embed.addFields({ name: 'Categories', value: list });
    embed.setFooter({ text: 'Click a button to explore commands' });
    return embed;
}

function buildCategoryEmbed(key) {
    const cat = CATEGORIES[key];
    if (!cat) return null;

    return new EmbedBuilder()
        .setTitle(`${cat.emoji} ${cat.label} Commands`)
        .setDescription(cat.description)
        .setColor(cat.color)
        .addFields({
            name: 'Commands',
            value: cat.commands.map(c => `**${c.name}** — ${c.desc}`).join('\n') || 'No commands listed.'
        })
        .setFooter({ text: 'Click "Back" to return to categories' })
        .setTimestamp();
}

// ─── Component builders ───────────────────────────────────────────────────────
function buildMainComponents() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_CAT}moderation`).setLabel('Moderation').setEmoji('🔨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}security`).setLabel('Security').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}setup`).setLabel('Setup').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_CAT}utility`).setLabel('Utility').setEmoji('🔧').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}leveling`).setLabel('Leveling').setEmoji('📈').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}tickets`).setLabel('Tickets').setEmoji('🎫').setStyle(ButtonStyle.Secondary)
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
}

function buildCategoryComponents(key) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(ID_BACK)
                .setLabel('Back')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${ID_TICKET}${key}`)
                .setLabel('Open a Support Ticket')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Primary)
        )
    ];
}

function buildTicketModal(key) {
    const cat = CATEGORIES[key] || { label: 'General' };

    const modal = new ModalBuilder()
        .setCustomId(`${ID_MODAL}${key}`)
        .setTitle('🎫 Open a Support Ticket');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('subject')
                .setLabel('Subject')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Brief description of your issue')
                .setMinLength(5)
                .setMaxLength(100)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('category')
                .setLabel('Category')
                .setStyle(TextInputStyle.Short)
                .setValue(cat.label)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('description')
                .setLabel('Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Describe your issue in detail...')
                .setMinLength(10)
                .setMaxLength(2000)
                .setRequired(true)
        )
    );

    return modal;
}

// ─── Command export ───────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with bot commands')
        .addStringOption(opt =>
            opt.setName('category')
                .setDescription('Jump directly to a category')
                .setRequired(false)
                .addChoices(
                    ...Object.entries(CATEGORIES).map(([key, cat]) => ({
                        name: `${cat.emoji} ${cat.label}`,
                        value: key
                    }))
                )
        ),

    // exported for the interaction handler
    PREFIX, ID_CAT, ID_BACK, ID_TICKET, ID_MODAL, CATEGORIES,
    buildMainEmbed, buildCategoryEmbed,
    buildMainComponents, buildCategoryComponents, buildTicketModal,

    async execute(interaction) {
        const key = interaction.options.getString('category');
        if (key && CATEGORIES[key]) {
            return interaction.reply({
                embeds: [buildCategoryEmbed(key)],
                components: buildCategoryComponents(key),
                ephemeral: true
            });
        }
        return interaction.reply({
            embeds: [buildMainEmbed(interaction.client)],
            components: buildMainComponents(),
            ephemeral: true
        });
    }
};
