const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('selfrole')
        .setDescription('Manage self-assignable roles')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a self-assignable role')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to make self-assignable')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('emoji')
                        .setDescription('Emoji for this role (optional)')
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Description for this role')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a self-assignable role')
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to remove from self-assignable list')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all self-assignable roles'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('Create a reaction role panel')
                .addStringOption(option =>
                    option
                        .setName('title')
                        .setDescription('Title for the role panel')
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Description for the panel')
                        .setRequired(false))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'add':
                    await this.handleAdd(interaction);
                    break;
                case 'remove':
                    await this.handleRemove(interaction);
                    break;
                case 'list':
                    await this.handleList(interaction);
                    break;
                case 'panel':
                    await this.handlePanel(interaction);
                    break;
            }
        } catch (error) {
            console.error('Error in selfrole command:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#ef4444')
                .setTitle('❌ Error')
                .setDescription('An error occurred while processing the selfrole command.')
                .setTimestamp();

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },

    async handleAdd(interaction) {
        const role = interaction.options.getRole('role');
        const emoji = interaction.options.getString('emoji') || '🎭';
        const description = interaction.options.getString('description') || `Get the ${role.name} role`;

        // Check if role is @everyone or managed
        if (role.id === interaction.guild.id) {
            return interaction.reply({
                content: '❌ You cannot make @everyone a self-assignable role!',
                ephemeral: true
            });
        }

        if (role.managed) {
            return interaction.reply({
                content: '❌ This role is managed by an integration and cannot be self-assigned!',
                ephemeral: true
            });
        }

        // Check if bot can manage this role
        if (role.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.reply({
                content: '❌ I cannot manage this role as it is higher than or equal to my highest role!',
                ephemeral: true
            });
        }

        // Add to database
        try {
            await interaction.client.database.run(`
                INSERT INTO self_roles (guild_id, role_id, emoji, description)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(guild_id, role_id) DO UPDATE SET
                    emoji = excluded.emoji,
                    description = excluded.description
            `, [interaction.guild.id, role.id, emoji, description]);

            const embed = new EmbedBuilder()
                .setColor('#00d4ff')
                .setTitle('✅ Self-Role Added')
                .setDescription(`${emoji} ${role} is now self-assignable!`)
                .addFields(
                    { name: 'Role', value: role.toString(), inline: true },
                    { name: 'Emoji', value: emoji, inline: true },
                    { name: 'Description', value: description, inline: false }
                )
                .setFooter({ text: 'Use /selfrole panel to create a role selection panel' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error adding self-role:', error);
            return interaction.reply({
                content: '❌ Failed to add self-role. Please try again.',
                ephemeral: true
            });
        }
    },

    async handleRemove(interaction) {
        const role = interaction.options.getRole('role');

        const result = await interaction.client.database.run(`
            DELETE FROM self_roles WHERE guild_id = ? AND role_id = ?
        `, [interaction.guild.id, role.id]);

        if (result.changes === 0) {
            return interaction.reply({
                content: '❌ This role is not in the self-assignable list!',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#f59e0b')
            .setTitle('🗑️ Self-Role Removed')
            .setDescription(`${role} is no longer self-assignable.`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },

    async handleList(interaction) {
        const roles = await interaction.client.database.all(`
            SELECT role_id, emoji, description FROM self_roles WHERE guild_id = ?
        `, [interaction.guild.id]);

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('📋 Self-Assignable Roles')
            .setTimestamp();

        if (roles.length === 0) {
            embed.setDescription('No self-assignable roles configured yet!\nUse `/selfrole add` to add roles.');
        } else {
            const roleList = roles.map(r => {
                const role = interaction.guild.roles.cache.get(r.role_id);
                if (!role) return null;
                return `${r.emoji} ${role} - ${r.description}`;
            }).filter(Boolean).join('\n');

            embed.setDescription(roleList || 'No valid roles found.');
            embed.setFooter({ text: `${roles.length} self-assignable role(s)` });
        }

        await interaction.reply({ embeds: [embed] });
    },

    async handlePanel(interaction) {
        await interaction.deferReply();

        const title = interaction.options.getString('title') || '🎭 Self-Assignable Roles';
        const description = interaction.options.getString('description') || 
            'Click the buttons below to get or remove roles!';

        const roles = await interaction.client.database.all(`
            SELECT role_id, emoji, description FROM self_roles WHERE guild_id = ? LIMIT 25
        `, [interaction.guild.id]);

        if (roles.length === 0) {
            return interaction.editReply({
                content: '❌ No self-assignable roles configured! Use `/selfrole add` first.'
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle(title)
            .setDescription(description)
            .setTimestamp();

        // Add role list to embed
        const roleList = roles.map(r => {
            const role = interaction.guild.roles.cache.get(r.role_id);
            if (!role) return null;
            return `${r.emoji} **${role.name}** - ${r.description}`;
        }).filter(Boolean).join('\n');

        embed.addFields({ name: 'Available Roles', value: roleList });

        // Create buttons (max 5 per row, max 5 rows = 25 buttons)
        const rows = [];
        for (let i = 0; i < Math.min(roles.length, 25); i += 5) {
            const row = new ActionRowBuilder();
            const roleSlice = roles.slice(i, i + 5);
            
            for (const roleData of roleSlice) {
                const role = interaction.guild.roles.cache.get(roleData.role_id);
                if (!role) continue;

                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`selfrole_${role.id}`)
                        .setLabel(role.name)
                        .setEmoji(roleData.emoji)
                        .setStyle(ButtonStyle.Primary)
                );
            }

            if (row.components.length > 0) {
                rows.push(row);
            }
        }

        const message = await interaction.editReply({
            embeds: [embed],
            components: rows
        });

        // Store panel info in database
        await interaction.client.database.run(`
            INSERT INTO reaction_role_messages (guild_id, channel_id, message_id, title, description)
            VALUES (?, ?, ?, ?, ?)
        `, [interaction.guild.id, interaction.channel.id, message.id, title, description]);

        console.log(`Self-role panel created in ${interaction.guild.name}`);
    }
};
