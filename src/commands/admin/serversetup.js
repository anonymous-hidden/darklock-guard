const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serversetup')
        .setDescription('🏗️ Complete server setup with channels, roles, and categories')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('template')
                .setDescription('Server template type')
                .setRequired(true)
                .addChoices(
                    { name: '🎮 Gaming Community', value: 'gaming' },
                    { name: '💼 Business/Professional', value: 'business' },
                    { name: '🎓 Educational/Study', value: 'education' },
                    { name: '🎨 Creative/Art', value: 'creative' },
                    { name: '🌐 General Community', value: 'general' },
                    { name: '💻 Development Community', value: 'development' },
                    { name: '🏢 Large Community', value: 'large' }
                ))
        .addStringOption(option =>
            option.setName('roles')
                .setDescription('How to handle roles')
                .setRequired(false)
                .addChoices(
                    { name: '✅ Create template roles (default)', value: 'template' },
                    { name: '⏭️ Skip roles - I\'ll make my own', value: 'skip' },
                    { name: '🔧 Create only essential roles (Admin, Mod, Verified, Muted)', value: 'essential' }
                ))
        .addBooleanOption(option =>
            option.setName('keep_existing')
                .setDescription('Keep existing channels and roles? (default: false)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const template = interaction.options.getString('template');
        const keepExisting = interaction.options.getBoolean('keep_existing') || false;
        const rolesOption = interaction.options.getString('roles') || 'template';
        const guild = interaction.guild;

        // Pre-flight: strict permission requirement (reverted from partial fallback)
        const me = guild.members.me;
        const needed = [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageGuild];
        const missing = needed.filter(p => !me.permissions.has(p));
        if (missing.length) {
            return interaction.editReply({
                content: `❌ Missing permissions: ${missing.map(m => Object.keys(PermissionFlagsBits).find(k => PermissionFlagsBits[k] === m) || m).join(', ')}. Grant these (or Administrator) and retry.`
            });
        }
        if (!guild.available) {
            return interaction.editReply({ content: '❌ Guild not yet available. Please retry in a few seconds.' });
        }

        try {
            const setupEmbed = new EmbedBuilder()
                .setTitle('🏗️ Starting Server Setup...')
                .setDescription('This will take a few minutes. Please wait...')
                .setColor('#00d4ff');

            await interaction.editReply({ embeds: [setupEmbed] });

            console.log(`[ServerSetup] Starting setup for guild ${guild.name} with template ${template}`);

            if (!keepExisting) {
                await this.clearExistingChannels(guild);
            }

            // Step 1: Create roles (based on user preference)
            let roles = {};
            console.log(`[ServerSetup] Roles option: ${rolesOption}`);
            
            if (rolesOption === 'skip') {
                console.log('[ServerSetup] Skipping role creation - user will create their own');
                // Try to find existing essential roles for channel permissions
                roles.admin = guild.roles.cache.find(r => /admin/i.test(r.name));
                roles.moderator = guild.roles.cache.find(r => /mod/i.test(r.name));
                roles.helper = guild.roles.cache.find(r => /helper|support/i.test(r.name));
                roles.verified = guild.roles.cache.find(r => /verified/i.test(r.name));
                roles.muted = guild.roles.cache.find(r => /muted/i.test(r.name));
            } else if (rolesOption === 'essential') {
                console.log('[ServerSetup] Creating essential roles only...');
                roles = await this.createRoles(guild, template, keepExisting, true);
            } else {
                console.log('[ServerSetup] Creating full template roles...');
                roles = await this.createRoles(guild, template, keepExisting, false);
            }
            console.log(`[ServerSetup] ${rolesOption === 'skip' ? 'Found' : 'Created'} ${Object.keys(roles).filter(k => roles[k]).length} roles`);
            
            // Step 2: Create categories and channels
            console.log('[ServerSetup] Creating channels...');
            const channels = await this.createChannels(guild, template, roles, keepExisting);
            console.log(`[ServerSetup] Created ${channels.categories.length} categories, ${channels.text.length} text channels, ${channels.voice.length} voice channels`);

            // Post default rules & create ticket channel after channels stage
            await this.postDefaultRules(guild);
            await this.ensureTicketChannel(guild);
            
            // Step 3: Set up permissions
            console.log('[ServerSetup] Setting up permissions...');
            await this.setupPermissions(guild, roles, channels);

            // Prepare success or warning embed
            const createdRolesCount = Object.keys(roles).filter(k => roles[k]).length;
            const rolesLabel = rolesOption === 'skip' ? 'Skipped (user preference)' : 
                               rolesOption === 'essential' ? `${createdRolesCount} (essential only)` : 
                               createdRolesCount.toString();
            
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Server Setup Finished')
                .setColor(channels.categories.length === 0 ? '#ffa200' : '#51cf66')
                .setDescription(channels.categories.length === 0
                    ? 'Setup completed, but no new channels were created. Check bot permissions or use keep_existing=false to force creation.'
                    : `Successfully processed your **${this.getTemplateName(template)}** template.`)
                .addFields(
                    { name: '📁 Categories Created', value: channels.categories.length.toString(), inline: true },
                    { name: '💬 Text Channels', value: channels.text.length.toString(), inline: true },
                    { name: '🔊 Voice Channels', value: channels.voice.length.toString(), inline: true },
                    { name: '👥 Roles', value: rolesLabel, inline: true },
                    { name: '🎭 Template', value: this.getTemplateName(template), inline: true }
                )
                .setFooter({ text: rolesOption === 'skip' ? 'Remember to create your own roles!' : 'If counts are zero, verify permissions & role hierarchy.' })
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            // Log the setup
            const bot = interaction.client.bot;
            if (bot && bot.database) {
                try {
                    await bot.database.run(`
                        INSERT INTO server_setups (guild_id, template, setup_by, created_at)
                        VALUES (?, ?, ?, ?)
                    `, [guild.id, template, interaction.user.id, new Date().toISOString()]);
                } catch (dbError) {
                    console.error('[ServerSetup] Failed to log setup to database:', dbError.message);
                }
            }

        } catch (error) {
            console.error('[ServerSetup] Setup error:', error);
            console.error('[ServerSetup] Error stack:', error.stack);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Setup Error')
                .setDescription(`An error occurred during setup: ${error.message}`)
                .setColor('#ff4757')
                .addFields(
                    { name: '❌ Error Details', value: error.message.substring(0, 1000), inline: false },
                    { name: '💡 Tip', value: 'Make sure the bot has Administrator permissions and is placed high in the role hierarchy.', inline: false }
                )
                .setFooter({ text: 'Check the bot console for detailed logs' });

            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch (replyError) {
                console.error('[ServerSetup] Failed to send error reply:', replyError);
            }
        }
    },

    async clearExistingChannels(guild) {
        const channels = Array.from(guild.channels.cache.values());
        console.log(`[ServerSetup] Deleting ${channels.length} existing channels before applying template...`);
        for (const channel of channels) {
            if (!channel.deletable) continue;
            try {
                await channel.delete('Server setup reset (keep_existing=false)');
                await new Promise(res => setTimeout(res, 750)); // rate-limit friendly
            } catch (err) {
                console.error(`[ServerSetup] Failed to delete ${channel.name}: ${err.message}`);
            }
        }
    },

    async createRoles(guild, template, keepExisting, essentialOnly = false) {
        const roles = {};
        let roleTemplates = this.getRoleTemplates(template);

        // If essentialOnly, filter to just the essential roles
        if (essentialOnly) {
            const essentialKeys = ['admin', 'moderator', 'helper', 'verified', 'member', 'muted', 'bot'];
            roleTemplates = roleTemplates.filter(r => essentialKeys.includes(r.key));
        }

        console.log(`[ServerSetup] Role templates to create: ${roleTemplates.length}${essentialOnly ? ' (essential only)' : ''}`);

        for (const roleData of roleTemplates) {
            try {
                // Check if role already exists
                const existing = guild.roles.cache.find(r => r.name === roleData.name);
                if (existing && keepExisting) {
                    roles[roleData.key] = existing;
                    continue;
                }

                const role = await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    permissions: roleData.permissions,
                    hoist: roleData.hoist || false,
                    mentionable: roleData.mentionable || false,
                    reason: 'Server setup by DarkLock'
                }).catch(err => {
                    console.error(`[ServerSetup] Failed to create role ${roleData.name}: ${err.message}`);
                    return null;
                });
                if (!role) continue;

                roles[roleData.key] = role;
                
                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`[ServerSetup] Error creating role ${roleData.name}:`, error.message);
                console.error(`[ServerSetup] Full error:`, error);
            }
        }

        console.log(`[ServerSetup] Successfully created ${Object.keys(roles).length} roles`);
        return roles;
    },

    async createChannels(guild, template, roles, keepExisting) {
        const channels = { categories: [], text: [], voice: [] };
        const channelTemplates = this.getChannelTemplates(template);

        console.log(`[ServerSetup] Channel templates to create: ${channelTemplates.length} categories`);

        for (const categoryData of channelTemplates) {
            try {
                // Reuse existing category if keepExisting
                const existingCategory = keepExisting ? guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === categoryData.name) : null;
                let category;
                if (existingCategory) {
                    category = existingCategory;
                } else {
                    category = await guild.channels.create({
                        name: categoryData.name,
                        type: ChannelType.GuildCategory,
                        reason: 'Server setup by DarkLock',
                        permissionOverwrites: this.getCategoryPermissions(categoryData, roles, guild)
                    }).catch(err => {
                        console.error(`[ServerSetup] Failed to create category ${categoryData.name}: ${err.message}`);
                        return null;
                    });
                }
                if (!category) continue;

                channels.categories.push(category);
                await new Promise(resolve => setTimeout(resolve, 500));

                // Create text channels in category
                if (categoryData.textChannels) {
                    for (const channelData of categoryData.textChannels) {
                        const sanitizedName = this.sanitizeChannelName(channelData.name);
                        if (keepExisting) {
                            const existingText = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.name === sanitizedName && ch.parentId === category.id);
                            if (existingText) {
                                channels.text.push(existingText);
                                continue;
                            }
                        }
                        const channel = await guild.channels.create({
                            name: sanitizedName,
                            type: ChannelType.GuildText,
                            parent: category.id,
                            topic: channelData.topic || '',
                            reason: 'Server setup by DarkLock',
                            permissionOverwrites: channelData.permissions ? 
                                this.getChannelPermissions(channelData, roles, guild) : []
                        }).catch(err => {
                            console.error(`[ServerSetup] Failed to create text channel ${channelData.name}: ${err.message}`);
                            return null;
                        });
                        if (!channel) continue;

                        channels.text.push(channel);
                        
                        // Send welcome message if specified
                        if (channelData.welcomeMessage) {
                            await channel.send(channelData.welcomeMessage);
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }

                // Create voice channels in category
                if (categoryData.voiceChannels) {
                    for (const channelData of categoryData.voiceChannels) {
                        const sanitizedName = this.sanitizeChannelName(channelData.name);
                        if (keepExisting) {
                            const existingVoice = guild.channels.cache.find(ch => ch.type === ChannelType.GuildVoice && ch.name === sanitizedName && ch.parentId === category.id);
                            if (existingVoice) {
                                channels.voice.push(existingVoice);
                                continue;
                            }
                        }
                        const channel = await guild.channels.create({
                            name: sanitizedName,
                            type: ChannelType.GuildVoice,
                            parent: category.id,
                            userLimit: channelData.userLimit || 0,
                            reason: 'Server setup by DarkLock',
                            permissionOverwrites: channelData.permissions ? 
                                this.getChannelPermissions(channelData, roles, guild) : []
                        }).catch(err => {
                            console.error(`[ServerSetup] Failed to create voice channel ${channelData.name}: ${err.message}`);
                            return null;
                        });
                        if (!channel) continue;

                        channels.voice.push(channel);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }

            } catch (error) {
                console.error(`[ServerSetup] Error creating category ${categoryData.name}:`, error.message);
                console.error(`[ServerSetup] Full error:`, error);
            }
        }

        console.log(`[ServerSetup] Created total: ${channels.categories.length} categories, ${channels.text.length} text, ${channels.voice.length} voice`);
        return channels;
    },

    async setupPermissions(guild, roles, channels) {
        // Verification integration: ensure Unverified role exists and is restricted
        let unverifiedRole = guild.roles.cache.find(r => /unverified/i.test(r.name));
        if (!unverifiedRole) {
            try {
                unverifiedRole = await guild.roles.create({
                    name: 'Unverified',
                    color: '#808080',
                    permissions: [],
                    reason: 'Server setup: base unverified role'
                });
            } catch (e) {
                console.error('[ServerSetup] Failed to create Unverified role:', e.message);
            }
        }

        // Persist unverified role id into guild config if database available
        try {
            const bot = guild.client?.bot;
            if (bot?.database && unverifiedRole) {
                await bot.database.updateGuildConfig(guild.id, { unverified_role_id: unverifiedRole.id });
            }
        } catch (e) {
            console.error('[ServerSetup] Failed to store unverified role id:', e.message);
        }

        // Determine rules channel (allow visibility) and create verification channel if missing
        const rulesChannel = guild.channels.cache.find(ch => ch.type === 0 && /rules|rule/i.test(ch.name));
        let verificationChannel = guild.channels.cache.find(ch => ch.type === 0 && /verify|verification/i.test(ch.name));
        if (!verificationChannel) {
            try {
                verificationChannel = await guild.channels.create({
                    name: 'verification',
                    type: 0,
                    reason: 'Server setup: verification channel'
                });
                // Instructional embed
                try {
                    const { EmbedBuilder } = require('discord.js');
                    const instruction = new EmbedBuilder()
                        .setTitle('🔐 Verification Required')
                        .setDescription('New members receive a code via DM or here if DMs are closed. Enter the code in this channel to gain access.\n\nIf you see nothing, ask staff to resend your challenge.')
                        .addFields(
                            { name: 'Time Limit', value: 'Challenges expire after configured timeout.' },
                            { name: 'Attempts', value: 'Limited attempts. Wrong codes reduce remaining tries.' }
                        )
                        .setColor('#00d4ff')
                        .setTimestamp();
                    await verificationChannel.send({ embeds: [instruction] }).catch(() => {});
                } catch {}
            } catch (e) {
                console.error('[ServerSetup] Failed to create verification channel:', e.message);
            }
        }

        // Hide all text channels from Unverified except rules + verification
        if (unverifiedRole) {
            const textChannels = guild.channels.cache.filter(ch => ch.type === 0);
            for (const [, ch] of textChannels) {
                // Skip rules + verification
                if (rulesChannel && ch.id === rulesChannel.id) continue;
                if (verificationChannel && ch.id === verificationChannel.id) continue;
                try {
                    await ch.permissionOverwrites.edit(unverifiedRole.id, { ViewChannel: false, SendMessages: false });
                } catch (e) {
                    // log but continue
                    console.warn(`[ServerSetup] Failed overwrite on ${ch.name}: ${e.message}`);
                }
            }
            // Allow unverified in verification channel
            if (verificationChannel) {
                try {
                    await verificationChannel.permissionOverwrites.edit(unverifiedRole.id, { ViewChannel: true, SendMessages: true });
                } catch {}
            }
            // Verified role denies viewing verification channel
            if (roles.verified && verificationChannel) {
                try { await verificationChannel.permissionOverwrites.edit(roles.verified.id, { ViewChannel: false }); } catch {}
            }
        }

        // Persist verified role id when available
        try {
            const bot = guild.client?.bot;
            if (bot?.database && roles.verified) {
                await bot.database.updateGuildConfig(guild.id, { verified_role_id: roles.verified.id });
            }
        } catch (e) {
            console.error('[ServerSetup] Failed to store verified role id:', e.message);
        }

        return true;
    },

    getRoleTemplates(template) {
        const baseRoles = [
            {
                key: 'admin',
                name: '👑 Administrator',
                color: '#e74c3c',
                permissions: [PermissionFlagsBits.Administrator],
                hoist: true,
                mentionable: true
            },
            {
                key: 'moderator',
                name: '🛡️ Moderator',
                color: '#3498db',
                permissions: [
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.ManageThreads,
                    PermissionFlagsBits.KickMembers,
                    PermissionFlagsBits.BanMembers,
                    PermissionFlagsBits.ModerateMembers,
                    PermissionFlagsBits.ViewAuditLog
                ],
                hoist: true,
                mentionable: true
            },
            {
                key: 'helper',
                name: '💚 Helper',
                color: '#2ecc71',
                permissions: [
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.ManageThreads
                ],
                hoist: true,
                mentionable: true
            },
            {
                key: 'verified',
                name: '✅ Verified',
                color: '#1abc9c',
                permissions: [],
                hoist: false,
                mentionable: false
            },
            {
                key: 'member',
                name: '👤 Member',
                color: '#95a5a6',
                permissions: [],
                hoist: false,
                mentionable: false
            },
            {
                key: 'muted',
                name: '🔇 Muted',
                color: '#7f8c8d',
                permissions: [],
                hoist: false,
                mentionable: false
            },
            {
                key: 'bot',
                name: '🤖 Bot',
                color: '#9b59b6',
                permissions: [],
                hoist: true,
                mentionable: false
            }
        ];

        // Template-specific roles
        const templateRoles = {
            gaming: [
                { key: 'vip', name: '⭐ VIP', color: '#f1c40f', permissions: [], hoist: true, mentionable: true },
                { key: 'streamer', name: '📺 Streamer', color: '#9b59b6', permissions: [], hoist: true, mentionable: true },
                { key: 'gamer', name: '🎮 Gamer', color: '#e67e22', permissions: [], hoist: false, mentionable: false }
            ],
            business: [
                { key: 'executive', name: '💼 Executive', color: '#34495e', permissions: [], hoist: true, mentionable: true },
                { key: 'manager', name: '📊 Manager', color: '#16a085', permissions: [], hoist: true, mentionable: true },
                { key: 'team_lead', name: '👔 Team Lead', color: '#27ae60', permissions: [], hoist: false, mentionable: true }
            ],
            education: [
                { key: 'teacher', name: '👨‍🏫 Teacher', color: '#e74c3c', permissions: [], hoist: true, mentionable: true },
                { key: 'teaching_assistant', name: '📚 TA', color: '#3498db', permissions: [], hoist: true, mentionable: true },
                { key: 'student', name: '🎓 Student', color: '#2ecc71', permissions: [], hoist: false, mentionable: false }
            ],
            creative: [
                { key: 'artist', name: '🎨 Artist', color: '#e74c3c', permissions: [], hoist: true, mentionable: true },
                { key: 'designer', name: '✨ Designer', color: '#9b59b6', permissions: [], hoist: true, mentionable: true },
                { key: 'creator', name: '🖌️ Creator', color: '#f39c12', permissions: [], hoist: false, mentionable: false }
            ],
            // Development community (programming/tech focused - previously 'large')
            development: [
                { key: 'owner', name: '👑 Owner', color: '#FFD700', permissions: [PermissionFlagsBits.Administrator], hoist: true, mentionable: true },
                { key: 'senior_mod', name: '🛡️ Senior Moderator', color: '#e74c3c', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ManageNicknames], hoist: true, mentionable: true },
                { key: 'developer', name: '💻 Developer', color: '#3498db', permissions: [], hoist: true, mentionable: true },
                { key: 'support', name: '💚 Support Team', color: '#2ecc71', permissions: [PermissionFlagsBits.ManageMessages], hoist: true, mentionable: true },
                { key: 'beta_tester', name: '🧪 Beta Tester', color: '#9b59b6', permissions: [], hoist: true, mentionable: false },
                { key: 'contributor', name: '⭐ Contributor', color: '#f1c40f', permissions: [], hoist: true, mentionable: false },
                { key: 'booster', name: '💎 Server Booster', color: '#FF73FA', permissions: [], hoist: true, mentionable: false },
                { key: 'quarantine', name: '🔒 Quarantine', color: '#7f8c8d', permissions: [], hoist: false, mentionable: false }
            ],
            // Large community (social/community focused without dev stuff)
            large: [
                { key: 'owner', name: '👑 Owner', color: '#FFD700', permissions: [PermissionFlagsBits.Administrator], hoist: true, mentionable: true },
                { key: 'senior_mod', name: '🛡️ Senior Moderator', color: '#e74c3c', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ViewAuditLog, PermissionFlagsBits.ManageNicknames], hoist: true, mentionable: true },
                { key: 'trial_mod', name: '🛡️ Trial Moderator', color: '#e67e22', permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads], hoist: true, mentionable: true },
                { key: 'vip', name: '⭐ VIP', color: '#f1c40f', permissions: [], hoist: true, mentionable: true },
                { key: 'events_team', name: '🎉 Events Team', color: '#9b59b6', permissions: [], hoist: true, mentionable: true },
                { key: 'booster', name: '💎 Server Booster', color: '#FF73FA', permissions: [], hoist: true, mentionable: false },
                { key: 'active', name: '💬 Active Member', color: '#2ecc71', permissions: [], hoist: false, mentionable: false },
                { key: 'quarantine', name: '🔒 Quarantine', color: '#7f8c8d', permissions: [], hoist: false, mentionable: false }
            ],
            general: []
        };

        return [...baseRoles, ...(templateRoles[template] || [])];
    },

    getChannelTemplates(template) {
        const templates = {
            gaming: [
                {
                    name: '📢 INFORMATION',
                    textChannels: [
                        { name: '📋rules', topic: 'Server rules and guidelines', welcomeMessage: '📋 **Please read the rules before participating!**' },
                        { name: '📣announcements', topic: 'Important server announcements' },
                        { name: '📰news', topic: 'Gaming news and updates' },
                        { name: '🆕welcome', topic: 'Welcome new members!' }
                    ]
                },
                {
                    name: '💬 GENERAL',
                    textChannels: [
                        { name: '💬general-chat', topic: 'General discussion' },
                        { name: '🎮game-chat', topic: 'Talk about games' },
                        { name: '🤖bot-commands', topic: 'Use bot commands here' },
                        { name: '📷media-sharing', topic: 'Share images, videos, and memes' },
                        { name: '🎵music', topic: 'Music bot commands' }
                    ]
                },
                {
                    name: '🎮 GAMING',
                    textChannels: [
                        { name: '🎯looking-for-group', topic: 'Find teammates!' },
                        { name: '🏆tournaments', topic: 'Tournament information' },
                        { name: '📊leaderboards', topic: 'Server leaderboards' },
                        { name: '🎁giveaways', topic: 'Giveaways and events' }
                    ],
                    voiceChannels: [
                        { name: '🔊 General Voice', userLimit: 0 },
                        { name: '🎮 Gaming 1', userLimit: 10 },
                        { name: '🎮 Gaming 2', userLimit: 10 },
                        { name: '🎮 Gaming 3', userLimit: 10 },
                        { name: '🎥 Streaming', userLimit: 5 },
                        { name: '🔇 AFK', userLimit: 0 }
                    ]
                },
                {
                    name: '🛠️ MODERATION',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '🛡️mod-chat', topic: 'Moderator discussion', permissions: { admin: true, moderator: true } },
                        { name: '📊mod-logs', topic: 'Moderation logs', permissions: { admin: true, moderator: true } },
                        { name: '🚨reports', topic: 'User reports', permissions: { admin: true, moderator: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Staff Room', userLimit: 10, permissions: { admin: true, moderator: true } }
                    ]
                }
            ],
            business: [
                {
                    name: '📢 ANNOUNCEMENTS',
                    textChannels: [
                        { name: '📋company-info', topic: 'Company information and policies' },
                        { name: '📣announcements', topic: 'Company-wide announcements' },
                        { name: '🎉events', topic: 'Company events and meetings' }
                    ]
                },
                {
                    name: '💼 GENERAL',
                    textChannels: [
                        { name: '💬general', topic: 'General discussion' },
                        { name: '☕watercooler', topic: 'Casual conversation' },
                        { name: '🤖bot-commands', topic: 'Bot commands' }
                    ]
                },
                {
                    name: '👥 DEPARTMENTS',
                    textChannels: [
                        { name: '💻development', topic: 'Development team' },
                        { name: '🎨design', topic: 'Design team' },
                        { name: '📊marketing', topic: 'Marketing team' },
                        { name: '💰sales', topic: 'Sales team' },
                        { name: '📞support', topic: 'Customer support' }
                    ],
                    voiceChannels: [
                        { name: '📞 Meeting Room 1', userLimit: 25 },
                        { name: '📞 Meeting Room 2', userLimit: 25 },
                        { name: '🔊 Team Call', userLimit: 10 }
                    ]
                },
                {
                    name: '🔒 MANAGEMENT',
                    permissions: { admin: true, executive: true },
                    textChannels: [
                        { name: '👔executive-chat', topic: 'Executive discussion', permissions: { admin: true, executive: true } },
                        { name: '📊analytics', topic: 'Business analytics', permissions: { admin: true, executive: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Executive Room', userLimit: 10, permissions: { admin: true, executive: true } }
                    ]
                }
            ],
            education: [
                {
                    name: '📢 INFORMATION',
                    textChannels: [
                        { name: '📋syllabus', topic: 'Course syllabus and information' },
                        { name: '📣announcements', topic: 'Important announcements' },
                        { name: '🆕welcome', topic: 'Welcome students!' }
                    ]
                },
                {
                    name: '💬 GENERAL',
                    textChannels: [
                        { name: '💬general', topic: 'General discussion' },
                        { name: '❓questions', topic: 'Ask questions here' },
                        { name: '🤖bot-commands', topic: 'Bot commands' }
                    ]
                },
                {
                    name: '📚 CLASSES',
                    textChannels: [
                        { name: '📖class-1', topic: 'Class discussions' },
                        { name: '📖class-2', topic: 'Class discussions' },
                        { name: '📖class-3', topic: 'Class discussions' },
                        { name: '📝homework', topic: 'Homework submissions' },
                        { name: '📊resources', topic: 'Learning resources' }
                    ],
                    voiceChannels: [
                        { name: '🎓 Lecture Hall', userLimit: 50 },
                        { name: '👥 Study Group 1', userLimit: 10 },
                        { name: '👥 Study Group 2', userLimit: 10 },
                        { name: '🔇 Silent Study', userLimit: 10 }
                    ]
                },
                {
                    name: '👨‍🏫 STAFF',
                    permissions: { admin: true, teacher: true },
                    textChannels: [
                        { name: '👔teacher-lounge', topic: 'Teacher discussion', permissions: { admin: true, teacher: true } },
                        { name: '📊grades', topic: 'Grade management', permissions: { admin: true, teacher: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Staff Room', userLimit: 10, permissions: { admin: true, teacher: true } }
                    ]
                }
            ],
            creative: [
                {
                    name: '📢 INFORMATION',
                    textChannels: [
                        { name: '📋info', topic: 'Community information' },
                        { name: '📣announcements', topic: 'Important announcements' },
                        { name: '🎨showcase', topic: 'Showcase your work!' }
                    ]
                },
                {
                    name: '💬 COMMUNITY',
                    textChannels: [
                        { name: '💬general', topic: 'General discussion' },
                        { name: '💡inspiration', topic: 'Share inspiration' },
                        { name: '🤖bot-commands', topic: 'Bot commands' },
                        { name: '🎨art-chat', topic: 'Discuss art and creativity' }
                    ]
                },
                {
                    name: '🎨 CREATION',
                    textChannels: [
                        { name: '🖼️art', topic: 'Share your art' },
                        { name: '📸photography', topic: 'Share photos' },
                        { name: '✍️writing', topic: 'Share your writing' },
                        { name: '🎵music', topic: 'Share your music' },
                        { name: '🎬video', topic: 'Share videos' },
                        { name: '💬feedback', topic: 'Get feedback on your work' }
                    ],
                    voiceChannels: [
                        { name: '🎨 Art Studio', userLimit: 10 },
                        { name: '🎵 Music Studio', userLimit: 10 },
                        { name: '🔊 General Voice', userLimit: 0 }
                    ]
                },
                {
                    name: '🛠️ STAFF',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '🛡️staff-chat', topic: 'Staff discussion', permissions: { admin: true, moderator: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Staff Room', userLimit: 10, permissions: { admin: true, moderator: true } }
                    ]
                }
            ],
            general: [
                {
                    name: '📢 INFORMATION',
                    textChannels: [
                        { name: '📋rules', topic: 'Server rules', welcomeMessage: '📋 **Welcome! Please read the rules.**' },
                        { name: '📣announcements', topic: 'Server announcements' },
                        { name: '🆕welcome', topic: 'Welcome new members!' }
                    ]
                },
                {
                    name: '💬 GENERAL',
                    textChannels: [
                        { name: '💬general', topic: 'General chat' },
                        { name: '🤖bot-commands', topic: 'Bot commands' },
                        { name: '📷media', topic: 'Share media' },
                        { name: '🎮gaming', topic: 'Gaming discussion' }
                    ],
                    voiceChannels: [
                        { name: '🔊 General Voice', userLimit: 0 },
                        { name: '🎮 Gaming', userLimit: 10 },
                        { name: '🔇 AFK', userLimit: 0 }
                    ]
                },
                {
                    name: '🛠️ MODERATION',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '🛡️mod-chat', topic: 'Moderator chat', permissions: { admin: true, moderator: true } },
                        { name: '📊logs', topic: 'Server logs', permissions: { admin: true, moderator: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Staff Room', userLimit: 10, permissions: { admin: true, moderator: true } }
                    ]
                }
            ],
            // Development community (programming/tech focused - previously 'large')
            development: [
                // INFORMATION (Read-Only)
                {
                    name: '📢 INFORMATION',
                    textChannels: [
                        { name: '📋rules', topic: 'Server rules and guidelines - Read carefully!' },
                        { name: '📣announcements', topic: 'Important server announcements' },
                        { name: '🔄updates', topic: 'Changelog and patch notes' },
                        { name: '🚦status', topic: 'Outages, maintenance, and incidents' },
                        { name: '❓faq', topic: 'Frequently asked questions' },
                        { name: '🗺️roadmap', topic: 'Planned features and updates' },
                        { name: '⚠️known-issues', topic: 'Known bugs and issues' }
                    ]
                },
                // ONBOARDING
                {
                    name: '👋 ONBOARDING',
                    textChannels: [
                        { name: '🆕welcome', topic: 'Welcome new members!' },
                        { name: '🔐verification', topic: 'Verify your account here' },
                        { name: '🚀start-here', topic: 'Links, guides, and expectations' },
                        { name: '🎭roles', topic: 'Self-assignable roles' },
                        { name: '📖server-info', topic: 'Server information and stats' }
                    ]
                },
                // SUPPORT
                {
                    name: '🎫 SUPPORT',
                    textChannels: [
                        { name: '📋support-info', topic: 'How to get help' },
                        { name: '🎫tickets', topic: 'Open a support ticket here' },
                        { name: '🐛bug-reports', topic: 'Report bugs and issues' },
                        { name: '💡feature-requests', topic: 'Suggest new features' },
                        { name: '⚙️setup-help', topic: 'Get help with setup' },
                        { name: '🤖bot-commands', topic: 'Test bot commands here' }
                    ]
                },
                // COMMUNITY
                {
                    name: '💬 COMMUNITY',
                    textChannels: [
                        { name: '💬general', topic: 'General discussion' },
                        { name: '👋introductions', topic: 'Introduce yourself!' },
                        { name: '📷media', topic: 'Share images and videos' },
                        { name: '💭off-topic', topic: 'Off-topic chat' }
                    ]
                },
                // DEVELOPMENT / ADVANCED
                {
                    name: '💻 DEVELOPMENT',
                    textChannels: [
                        { name: '📢dev-updates', topic: 'Development updates and news' },
                        { name: '🔗api-updates', topic: 'API changes and documentation' },
                        { name: '🔒security-notices', topic: 'Security announcements' },
                        { name: '🧪beta-testing', topic: 'Beta testing discussion' },
                        { name: '📝feedback-review', topic: 'Review user feedback' },
                        { name: '💻dev-chat', topic: 'Developer discussion' },
                        { name: '🤝collaborations', topic: 'Find collaboration partners' }
                    ]
                },
                // VOICE
                {
                    name: '🔊 VOICE',
                    voiceChannels: [
                        { name: '🔊 General Voice', userLimit: 0 },
                        { name: '💻 Dev Call 1', userLimit: 10 },
                        { name: '💻 Dev Call 2', userLimit: 10 },
                        { name: '🔇 AFK', userLimit: 0 }
                    ]
                },
                // MODERATION (Staff Only)
                {
                    name: '🛡️ MODERATION',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '💬mod-chat', topic: 'Moderator discussion', permissions: { admin: true, moderator: true } },
                        { name: '👔staff-chat', topic: 'All staff discussion', permissions: { admin: true, moderator: true, helper: true } },
                        { name: '📝logs', topic: 'Moderation logs', permissions: { admin: true, moderator: true } },
                        { name: '🚨reports', topic: 'User reports', permissions: { admin: true, moderator: true } },
                        { name: '📄ticket-transcripts', topic: 'Saved ticket transcripts', permissions: { admin: true, moderator: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Staff Voice', userLimit: 15, permissions: { admin: true, moderator: true } }
                    ]
                },
                // AUTOMATION / BOT OUTPUT (Staff-Controlled)
                {
                    name: '🤖 AUTOMATION',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '👋join-leave-logs', topic: 'Member join and leave logs', permissions: { admin: true, moderator: true } },
                        { name: '🚨security-alerts', topic: 'Security event alerts', permissions: { admin: true, moderator: true } },
                        { name: '📜audit-log', topic: 'Discord audit log feed', permissions: { admin: true, moderator: true } },
                        { name: '🎫ticket-logs', topic: 'Ticket activity logs', permissions: { admin: true, moderator: true } }
                    ]
                }
            ],
            // Large community (social/community focused without dev stuff)
            large: [
                // INFORMATION (Read-Only)
                {
                    name: '📢 INFORMATION',
                    textChannels: [
                        { name: '📋rules', topic: 'Server rules and guidelines - Read carefully!' },
                        { name: '📣announcements', topic: 'Important server announcements' },
                        { name: '🆕welcome', topic: 'Welcome new members!' },
                        { name: '❓faq', topic: 'Frequently asked questions' },
                        { name: '🎭roles', topic: 'Self-assignable roles' }
                    ]
                },
                // COMMUNITY
                {
                    name: '💬 COMMUNITY',
                    textChannels: [
                        { name: '💬general', topic: 'General discussion' },
                        { name: '👋introductions', topic: 'Introduce yourself!' },
                        { name: '📷media', topic: 'Share images and videos' },
                        { name: '🎮gaming', topic: 'Gaming discussion' },
                        { name: '💭off-topic', topic: 'Off-topic chat' },
                        { name: '😂memes', topic: 'Memes and fun content' },
                        { name: '🤖bot-commands', topic: 'Bot commands here' }
                    ]
                },
                // EVENTS & ACTIVITIES
                {
                    name: '🎉 EVENTS',
                    textChannels: [
                        { name: '📅events', topic: 'Upcoming events and activities' },
                        { name: '🎁giveaways', topic: 'Giveaways and contests' },
                        { name: '🗳️polls', topic: 'Community polls and votes' },
                        { name: '🏆leaderboards', topic: 'Server rankings and stats' }
                    ]
                },
                // INTERESTS
                {
                    name: '🌟 INTERESTS',
                    textChannels: [
                        { name: '🎵music', topic: 'Music discussion and sharing' },
                        { name: '🎬movies-shows', topic: 'Movies and TV shows' },
                        { name: '📚books-reading', topic: 'Books and reading' },
                        { name: '🎨art-creative', topic: 'Art and creative works' },
                        { name: '⚽sports', topic: 'Sports discussion' }
                    ]
                },
                // VOICE
                {
                    name: '🔊 VOICE',
                    voiceChannels: [
                        { name: '🔊 General Voice', userLimit: 0 },
                        { name: '🎮 Gaming 1', userLimit: 10 },
                        { name: '🎮 Gaming 2', userLimit: 10 },
                        { name: '💬 Chill Zone', userLimit: 25 },
                        { name: '🎵 Music', userLimit: 10 },
                        { name: '🔇 AFK', userLimit: 0 }
                    ]
                },
                // MODERATION (Staff Only)
                {
                    name: '🛡️ MODERATION',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '💬mod-chat', topic: 'Moderator discussion', permissions: { admin: true, moderator: true } },
                        { name: '👔staff-chat', topic: 'All staff discussion', permissions: { admin: true, moderator: true } },
                        { name: '📝logs', topic: 'Moderation logs', permissions: { admin: true, moderator: true } },
                        { name: '🚨reports', topic: 'User reports', permissions: { admin: true, moderator: true } },
                        { name: '📩appeals', topic: 'Ban appeal reviews', permissions: { admin: true, moderator: true } }
                    ],
                    voiceChannels: [
                        { name: '🔒 Staff Voice', userLimit: 15, permissions: { admin: true, moderator: true } }
                    ]
                },
                // AUTOMATION / BOT OUTPUT (Staff-Controlled)
                {
                    name: '🤖 AUTOMATION',
                    permissions: { admin: true, moderator: true },
                    textChannels: [
                        { name: '👋join-leave-logs', topic: 'Member join and leave logs', permissions: { admin: true, moderator: true } },
                        { name: '🚨security-alerts', topic: 'Security event alerts', permissions: { admin: true, moderator: true } },
                        { name: '📜audit-log', topic: 'Discord audit log feed', permissions: { admin: true, moderator: true } }
                    ]
                }
            ]
        };

        return templates[template] || templates.general;
    },

    getCategoryPermissions(categoryData, roles, guild) {
        const permissions = [];

        // Restricted category
        if (categoryData.permissions) {
            permissions.push({ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] });

            if (categoryData.permissions.admin && roles.admin) {
                permissions.push({
                    id: roles.admin.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                });
            }

            if (categoryData.permissions.moderator && roles.moderator) {
                permissions.push({
                    id: roles.moderator.id,
                    allow: [PermissionFlagsBits.ViewChannel]
                });
            }
        }

        return permissions;
    },

    getChannelPermissions(channelData, roles, guild) {
        const permissions = [];

        if (channelData.permissions) {
            permissions.push({
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            });

            if (channelData.permissions.admin && roles.admin) {
                permissions.push({
                    id: roles.admin.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]
                });
            }

            if (channelData.permissions.moderator && roles.moderator) {
                permissions.push({
                    id: roles.moderator.id,
                    allow: [PermissionFlagsBits.ViewChannel]
                });
            }

            if (channelData.permissions.helper && roles.helper) {
                permissions.push({
                    id: roles.helper.id,
                    allow: [PermissionFlagsBits.ViewChannel]
                });
            }

            if (channelData.permissions.support && roles.support) {
                permissions.push({
                    id: roles.support.id,
                    allow: [PermissionFlagsBits.ViewChannel]
                });
            }

            if (channelData.permissions.developer && roles.developer) {
                permissions.push({
                    id: roles.developer.id,
                    allow: [PermissionFlagsBits.ViewChannel]
                });
            }
        }

        return permissions;
    },

    getTemplateName(template) {
        const names = {
            gaming: '🎮 Gaming Community',
            business: '💼 Business/Professional',
            education: '🎓 Educational/Study',
            creative: '🎨 Creative/Art',
            general: '🌐 General Community',
            development: '💻 Development Community',
            large: '🏢 Large Community'
        };
        return names[template] || 'General';
    },

    sanitizeChannelName(name) {
        if (!name) return 'channel';
        // Conservative sanitization: keep letters, numbers, hyphen, underscore; drop other chars
        return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\p{L}\p{N}_-]/gu, '-')
            .replace(/--+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 95) || 'channel';
    },

    async postDefaultRules(guild) {
        try {
            const rulesChannel = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && /rules/i.test(ch.name));
            if (!rulesChannel) return; // No rules channel created/found
            const existing = await rulesChannel.messages.fetch({ limit: 5 }).catch(() => null);
            if (existing && existing.size > 0) return; // Avoid duplicating if content already exists
            const embed = new EmbedBuilder()
                .setTitle('📋 Server Rules')
                .setDescription('Please read and follow these rules to keep the community safe and enjoyable.')
                .addFields(
                    { name: '1. Be Respectful', value: 'Treat everyone with respect. Harassment, hate speech, and discrimination are prohibited.' },
                    { name: '2. No Spam', value: 'Avoid excessive messaging, emojis, CAPS, or repeated content.' },
                    { name: '3. Safe Content', value: 'No NSFW, pirated, or malicious content/links.' },
                    { name: '4. Follow Discord TOS', value: 'All members must comply with Discord Terms of Service & Community Guidelines.' },
                    { name: '5. Use Channels Properly', value: 'Stay on-topic; post in the correct channels.' },
                    { name: '6. No Self-Promotion (Unless Allowed)', value: 'Ask staff before advertising.' },
                    { name: '7. Respect Staff Decisions', value: 'Staff actions are final; appeal politely if needed.' }
                )
                .setFooter({ text: 'By participating you agree to follow these rules.' })
                .setColor('#5865F2');
            await rulesChannel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[ServerSetup] Failed to post default rules:', err.message);
        }
    },

    async ensureTicketChannel(guild) {
        try {
            // Try to locate an existing support/ticket channel
            let ticketChannel = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && /(ticket|support)/i.test(ch.name));
            if (!ticketChannel) {
                // Find or create a suitable category (prefer moderation/staff/information)
                const preferredCategory = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && /(moderation|staff|information|support)/i.test(c.name));
                ticketChannel = await guild.channels.create({
                    name: 'tickets',
                    type: ChannelType.GuildText,
                    parent: preferredCategory?.id,
                    topic: 'Open a support ticket for assistance',
                    reason: 'Server setup: ticket support channel'
                }).catch(err => {
                    console.error('[ServerSetup] Failed to create ticket channel:', err.message);
                    return null;
                });
            }
            if (!ticketChannel) return;

            // Deploy ticket panel if EnhancedTicketManager categories exist
            const bot = guild.client?.bot;
            if (bot && bot.enhancedTicketManager) {
                const categories = await bot.enhancedTicketManager.getCategories(guild.id);
                if (categories && categories.length > 0) {
                    // Avoid duplicate panel: check recent messages for select menu
                    const recent = await ticketChannel.messages.fetch({ limit: 10 }).catch(() => null);
                    const hasPanel = recent && recent.some(m => m.components?.some(row => row.components?.some(c => c.customId === 'ticket_category_select')));
                    if (!hasPanel) {
                        await bot.enhancedTicketManager.createTicketPanel(ticketChannel, 'Select a category below to create a support ticket.');
                    }
                } else {
                    // If no categories, seed a basic message
                    const infoEmbed = new EmbedBuilder()
                        .setTitle('🎫 Support Tickets')
                        .setDescription('Ticket system is not fully configured yet. Staff can add categories to enable the interactive panel.')
                        .setColor('#00d4ff');
                    await ticketChannel.send({ embeds: [infoEmbed] });
                }
            }
        } catch (err) {
            console.error('[ServerSetup] Failed to ensure ticket channel:', err.message);
        }
    }
};
