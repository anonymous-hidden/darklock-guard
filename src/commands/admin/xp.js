const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('Manage the XP system (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set a user\'s XP')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to modify')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The XP amount to set')
                        .setRequired(true)
                        .setMinValue(0)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add XP to a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to add XP to')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The XP amount to add')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove XP from a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user to remove XP from')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('The XP amount to remove')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset all XP in the server'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('levelrole')
                .setDescription('Set a role reward for reaching a level')
                .addIntegerOption(option =>
                    option.setName('level')
                        .setDescription('The level required to get this role')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to give (leave empty to remove)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('levelroles')
                .setDescription('View all configured level roles'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable the XP system'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable the XP system')),

    async execute(interaction, bot) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'set':
                    await handleSetXP(interaction, bot);
                    break;
                case 'add':
                    await handleAddXP(interaction, bot);
                    break;
                case 'remove':
                    await handleRemoveXP(interaction, bot);
                    break;
                case 'reset':
                    await handleResetXP(interaction, bot);
                    break;
                case 'levelrole':
                    await handleLevelRole(interaction, bot);
                    break;
                case 'levelroles':
                    await handleViewLevelRoles(interaction, bot);
                    break;
                case 'enable':
                    await handleEnableXP(interaction, bot);
                    break;
                case 'disable':
                    await handleDisableXP(interaction, bot);
                    break;
            }
        } catch (error) {
            console.error('Error in XP command:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff6b6b')
                .setDescription('❌ An error occurred while executing this command.');
            
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ embeds: [errorEmbed] });
            } else {
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};

async function handleSetXP(interaction, bot) {
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    await bot.rankSystem.setUserXP(interaction.guild.id, user.id, amount);
    const stats = await bot.rankSystem.getUserStats(interaction.guild.id, user.id);

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#00d4ff')
            .setDescription(`✅ Set ${user}'s XP to **${amount.toLocaleString()}** (Level ${stats.level})`)
        ]
    });
}

async function handleAddXP(interaction, bot) {
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    const currentStats = await bot.rankSystem.getUserStats(interaction.guild.id, user.id);
    const newXP = currentStats.xp + amount;
    await bot.rankSystem.setUserXP(interaction.guild.id, user.id, newXP);
    const newStats = await bot.rankSystem.getUserStats(interaction.guild.id, user.id);

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#00ff88')
            .setDescription(`✅ Added **${amount.toLocaleString()}** XP to ${user}\n` +
                `New total: **${newXP.toLocaleString()}** XP (Level ${newStats.level})`)
        ]
    });
}

async function handleRemoveXP(interaction, bot) {
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    const currentStats = await bot.rankSystem.getUserStats(interaction.guild.id, user.id);
    const newXP = Math.max(0, currentStats.xp - amount);
    await bot.rankSystem.setUserXP(interaction.guild.id, user.id, newXP);
    const newStats = await bot.rankSystem.getUserStats(interaction.guild.id, user.id);

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#ff6b6b')
            .setDescription(`✅ Removed **${amount.toLocaleString()}** XP from ${user}\n` +
                `New total: **${newXP.toLocaleString()}** XP (Level ${newStats.level})`)
        ]
    });
}

async function handleResetXP(interaction, bot) {
    await interaction.deferReply();

    // Confirm reset
    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setColor('#ffaa00')
            .setTitle('⚠️ Confirm XP Reset')
            .setDescription('This will **permanently delete** all XP data for this server.\n\n' +
                'Type `CONFIRM` in the next 30 seconds to proceed.')
        ]
    });

    const filter = m => m.author.id === interaction.user.id && m.content.toUpperCase() === 'CONFIRM';
    try {
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
        collected.first().delete().catch(() => {});

        await bot.rankSystem.resetGuildXP(interaction.guild.id);

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#00ff88')
                .setDescription('✅ All XP data has been reset for this server.')
            ]
        });
    } catch (e) {
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor('#888')
                .setDescription('❌ XP reset cancelled (timed out).')
            ]
        });
    }
}

async function handleLevelRole(interaction, bot) {
    const level = interaction.options.getInteger('level');
    const role = interaction.options.getRole('role');

    if (role) {
        // Add or update level role
        await bot.database.run(
            `INSERT INTO level_roles (guild_id, level, role_id) VALUES (?, ?, ?)
             ON CONFLICT(guild_id, level) DO UPDATE SET role_id = ?`,
            [interaction.guild.id, level, role.id, role.id]
        );

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#00d4ff')
                .setDescription(`✅ Users will now receive ${role} when they reach **Level ${level}**`)
            ]
        });
    } else {
        // Remove level role
        await bot.database.run(
            'DELETE FROM level_roles WHERE guild_id = ? AND level = ?',
            [interaction.guild.id, level]
        );

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#888')
                .setDescription(`✅ Removed the role reward for **Level ${level}**`)
            ]
        });
    }
}

async function handleViewLevelRoles(interaction, bot) {
    const levelRoles = await bot.database.all(
        'SELECT * FROM level_roles WHERE guild_id = ? ORDER BY level ASC',
        [interaction.guild.id]
    );

    if (levelRoles.length === 0) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor('#888')
                .setTitle('📊 Level Roles')
                .setDescription('No level roles configured.\n\nUse `/xp levelrole` to add role rewards.')
            ]
        });
    }

    const roleList = levelRoles.map(lr => {
        const role = interaction.guild.roles.cache.get(lr.role_id);
        return `**Level ${lr.level}** → ${role || 'Deleted Role'}`;
    }).join('\n');

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle('📊 Level Roles')
            .setDescription(roleList)
            .setFooter({ text: 'Use /xp levelrole to modify' })
        ]
    });
}

async function handleEnableXP(interaction, bot) {
    await bot.database.run(
        `INSERT INTO guild_configs (guild_id, xp_enabled) VALUES (?, 1)
         ON CONFLICT(guild_id) DO UPDATE SET xp_enabled = 1`,
        [interaction.guild.id]
    );

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#00ff88')
            .setTitle('✅ XP System Enabled')
            .setDescription('Users will now earn XP for chatting.\n\n' +
                '**Settings:**\n' +
                '• XP per message: 15-25\n' +
                '• Cooldown: 60 seconds\n' +
                '• Voice XP: 10 per minute\n\n' +
                'Use `/rank` to view your rank card.\n' +
                'Use `/leaderboard` to see top members.')
        ]
    });
}

async function handleDisableXP(interaction, bot) {
    await bot.database.run(
        'UPDATE guild_configs SET xp_enabled = 0 WHERE guild_id = ?',
        [interaction.guild.id]
    );

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor('#ff6b6b')
            .setDescription('✅ XP system has been disabled. Users will no longer earn XP.\n\n' +
                '*Note: Existing XP data is preserved and can be restored by re-enabling.*')
        ]
    });
}
