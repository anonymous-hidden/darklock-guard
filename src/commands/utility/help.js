/**
 * /help command.
 *
 * Flow:
 *   /help               - main menu embed + category buttons
 *   category button     - update embed to show commands (interaction.update)
 *   Back button         - update embed back to main menu (interaction.update)
 *   Open-ticket button  - showModal
 *   modal submit        - deferReply -> create ticket -> editReply
 *
 * Custom IDs use the 'dl_help_' prefix so routing is unambiguous.
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

const PREFIX    = 'dl_help';
const ID_CAT    = 'dl_help_cat_';
const ID_BACK   = 'dl_help_back';
const ID_TICKET = 'dl_help_ticket_';
const ID_MODAL  = 'dl_help_modal_';

const CATEGORIES = {
    moderation: {
        label: 'Moderation',
        color: 0xff6b6b,
        description: 'Manage and moderate your community',
        commands: [
            { name: '/kick',    desc: 'Kick a member from the server' },
            { name: '/ban',     desc: 'Ban a member from the server' },
            { name: '/unban',   desc: 'Unban a user by ID' },
            { name: '/timeout', desc: 'Timeout a member' },
            { name: '/warn',    desc: 'Issue a warning to a member' },
            { name: '/warnings', desc: 'View a member\'s warnings' },
            { name: '/purge',   desc: 'Delete multiple messages at once' },
            { name: '/slowmode', desc: 'Set channel slowmode' },
            { name: '/lock',    desc: 'Lock a channel' },
            { name: '/unlock',  desc: 'Unlock a channel' },
            { name: '/mute',    desc: 'Mute a member' },
            { name: '/unmute',  desc: 'Unmute a member' }
        ]
    },
    security: {
        label: 'Security',
        color: 0x00d4ff,
        description: 'Protection against raids, spam, phishing, and nukes',
        commands: [
            { name: '/automod',      desc: 'Configure automod rules' },
            { name: '/antinuke',     desc: 'Anti-nuke protection settings' },
            { name: '/antiraid',     desc: 'Anti-raid protection settings' },
            { name: '/antiphishing', desc: 'Anti-phishing link protection' },
            { name: '/antispam',     desc: 'Anti-spam throttles' },
            { name: '/security',     desc: 'Open the security dashboard' },
            { name: '/lockdown',     desc: 'Lock or unlock all channels' },
            { name: '/quarantine',   desc: 'Quarantine a suspicious user' },
            { name: '/verification', desc: 'Configure member verification' },
            { name: '/wordfilter',   desc: 'Manage the word filter' }
        ]
    },
    setup: {
        label: 'Setup',
        color: 0xffd43b,
        description: 'Server configuration and bot setup',
        commands: [
            { name: '/wizard',          desc: 'Interactive setup wizard' },
            { name: '/setup welcome',   desc: 'Configure welcome messages' },
            { name: '/setup goodbye',   desc: 'Configure goodbye messages' },
            { name: '/setup roles',     desc: 'Configure auto-role assignment' },
            { name: '/setup logs',      desc: 'Pick the log channel' },
            { name: '/setup language',  desc: 'Set the server language' },
            { name: '/serversetup',     desc: 'Create a full server structure' },
            { name: '/reactionrole',    desc: 'Create a reaction role panel' },
            { name: '/autorole',        desc: 'Configure roles given on join' }
        ]
    },
    utility: {
        label: 'Utility',
        color: 0x5865f2,
        description: 'General information and utility commands',
        commands: [
            { name: '/help',        desc: 'Show this help menu' },
            { name: '/ping',        desc: 'Check bot latency' },
            { name: '/serverinfo',  desc: 'View server information' },
            { name: '/userinfo',    desc: 'View user information' },
            { name: '/roleinfo',    desc: 'View role information' },
            { name: '/avatar',      desc: 'Show a user\'s avatar' },
            { name: '/remind',      desc: 'Set a reminder' },
            { name: '/poll',        desc: 'Create a poll' },
            { name: '/status',      desc: 'Bot uptime and status' }
        ]
    },
    leveling: {
        label: 'Leveling',
        color: 0xa78bfa,
        description: 'XP, ranks, and level roles',
        commands: [
            { name: '/rank',        desc: 'View your rank and XP' },
            { name: '/leaderboard', desc: 'View the server leaderboard' },
            { name: '/setlevel',    desc: 'Set a user\'s level (admin)' },
            { name: '/xp add',      desc: 'Grant XP to a user (admin)' },
            { name: '/xp remove',   desc: 'Remove XP from a user (admin)' },
            { name: '/rewards',     desc: 'View level-up role rewards' }
        ]
    },
    tickets: {
        label: 'Tickets',
        color: 0x51cf66,
        description: 'Support ticket system',
        commands: [
            { name: '/ticket create', desc: 'Create a support ticket' },
            { name: '/ticket close',  desc: 'Close a ticket' },
            { name: '/ticket add',    desc: 'Add a user to a ticket' },
            { name: '/ticket remove', desc: 'Remove a user from a ticket' },
            { name: '/ticket claim',  desc: 'Claim a ticket as staff' }
        ]
    }
};

function buildMainEmbed(client) {
    const embed = new EmbedBuilder()
        .setTitle('DarkLock - Help Center')
        .setDescription('Choose a category below to browse available commands.')
        .setColor(0x00d4ff)
        .setTimestamp();

    if (client?.user) {
        embed.setThumbnail(client.user.displayAvatarURL({ size: 256 }));
    }

    const list = Object.values(CATEGORIES)
        .map(c => `**${c.label}** - ${c.description}`)
        .join('\n');

    embed.addFields({ name: 'Categories', value: list });
    embed.setFooter({ text: 'Click a button to explore commands' });
    return embed;
}

function buildCategoryEmbed(key) {
    const cat = CATEGORIES[key];
    if (!cat) return null;

    return new EmbedBuilder()
        .setTitle(`${cat.label} Commands`)
        .setDescription(cat.description)
        .setColor(cat.color)
        .addFields({
            name: 'Commands',
            value: cat.commands.map(c => `**${c.name}** - ${c.desc}`).join('\n') || 'No commands listed.'
        })
        .setFooter({ text: 'Click Back to return to categories' })
        .setTimestamp();
}

function buildMainComponents() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_CAT}moderation`).setLabel('Moderation').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}security`).setLabel('Security').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}setup`).setLabel('Setup').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_CAT}utility`).setLabel('Utility').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}leveling`).setLabel('Leveling').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID_CAT}tickets`).setLabel('Tickets').setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(process.env.DASHBOARD_URL || 'https://darklock.xyz/dashboard'),
        new ButtonBuilder()
            .setLabel('Support Server')
            .setStyle(ButtonStyle.Link)
            .setURL('https://discord.gg/Vsq9PUTrgb')
    );

    return [row1, row2, row3];
}

function buildCategoryComponents(key) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(ID_BACK)
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${ID_TICKET}${key}`)
                .setLabel('Open a Support Ticket')
                .setStyle(ButtonStyle.Primary)
        )
    ];
}

function buildTicketModal(key) {
    const cat = CATEGORIES[key] || { label: 'General' };

    const modal = new ModalBuilder()
        .setCustomId(`${ID_MODAL}${key}`)
        .setTitle('Open a Support Ticket');

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
                        name: cat.label,
                        value: key
                    }))
                )
        ),

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
