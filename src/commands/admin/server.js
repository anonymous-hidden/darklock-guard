const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { getDeprecationNotice } = require('../handlers');

// DEPRECATED: Use /admin instead
module.exports = {
    deprecated: true,
    newCommand: '/admin',
    data: new SlashCommandBuilder()
        .setName('server')
        .setDescription('⚠️ MOVED → Use /admin instead')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sc => sc
            .setName('lockdown')
            .setDescription('Lock all text channels for @everyone')
        )
        .addSubcommand(sc => sc
            .setName('unlock')
            .setDescription('Unlock all text channels for @everyone')
        )
        .addSubcommand(sc => sc
            .setName('slowmode')
            .setDescription('Set slowmode on channels')
            .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode delay in seconds (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
            .addStringOption(o => o.setName('scope').setDescription('Apply to a scope').setRequired(false)
                .addChoices({ name: 'here', value: 'here' }, { name: 'all', value: 'all' }))
        )
        .addSubcommand(sc => sc
            .setName('nuke')
            .setDescription('Clone and delete this channel to clear all messages')
        )
        .addSubcommand(sc => sc
            .setName('audit-perms')
            .setDescription('Audit dangerous permissions on roles and channels')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        switch (sub) {
            case 'lockdown':
                return this.lockdown(interaction);
            case 'unlock':
                return this.unlock(interaction);
            case 'slowmode':
                return this.slowmode(interaction);
            case 'nuke':
                return this.nuke(interaction);
            case 'audit-perms':
                return this.audit(interaction);
        }
    },

    async lockdown(interaction) {
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

    async unlock(interaction) {
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

    async slowmode(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const seconds = interaction.options.getInteger('seconds');
        const scope = interaction.options.getString('scope') || 'here';
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

    async nuke(interaction) {
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
            return interaction.editReply({ content: '✅ Channel nuked.' });
        } catch (e) {
            return interaction.editReply({ content: '❌ Failed to nuke channel. Check my permissions.' });
        }
    },

    async audit(interaction) {
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
