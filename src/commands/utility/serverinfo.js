const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Get detailed information about the server'),

    async execute(interaction) {
        await interaction.deferReply();
        
        const guild = interaction.guild;
        
        const serverEmbed = new EmbedBuilder()
            .setTitle(`🏰 ${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
            .setColor('#00d4ff')
            .setTimestamp();

        // Basic server info
        serverEmbed.addFields(
            { name: 'Server ID', value: guild.id, inline: true },
            { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: false }
        );

        // Member info
        const totalMembers = guild.memberCount;
        const onlineMembers = guild.members.cache.filter(member => 
            member.presence?.status === 'online' || 
            member.presence?.status === 'idle' || 
            member.presence?.status === 'dnd'
        ).size;
        
        const botCount = guild.members.cache.filter(member => member.user.bot).size;
        const humanCount = totalMembers - botCount;

        serverEmbed.addFields(
            { name: 'Total Members', value: `${totalMembers.toLocaleString()}`, inline: true },
            { name: 'Online Members', value: `${onlineMembers.toLocaleString()}`, inline: true },
            { name: 'Humans/Bots', value: `${humanCount}/${botCount}`, inline: true }
        );

        // Channel info
        const textChannels = guild.channels.cache.filter(c => c.type === 0).size;
        const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
        const categories = guild.channels.cache.filter(c => c.type === 4).size;
        const totalChannels = textChannels + voiceChannels + categories;

        serverEmbed.addFields(
            { name: 'Total Channels', value: `${totalChannels}`, inline: true },
            { name: 'Text/Voice', value: `${textChannels}/${voiceChannels}`, inline: true },
            { name: 'Categories', value: `${categories}`, inline: true }
        );

        // Role info
        const totalRoles = guild.roles.cache.size - 1; // Exclude @everyone
        serverEmbed.addFields({ name: 'Roles', value: `${totalRoles}`, inline: true });

        // Boost info
        const boostLevel = guild.premiumTier;
        const boostCount = guild.premiumSubscriptionCount || 0;
        const boostEmojis = ['', '🚀', '🚀🚀', '🚀🚀🚀'];
        
        serverEmbed.addFields(
            { name: 'Boost Level', value: `${boostEmojis[boostLevel]} Level ${boostLevel}`, inline: true },
            { name: 'Boost Count', value: `${boostCount}`, inline: true }
        );

        // Verification level
        const verificationLevels = {
            0: '🔓 None',
            1: '📧 Low - Email verified',
            2: '⏱️ Medium - 5+ minutes old',
            3: '⭐ High - 10+ minutes in server', 
            4: '🔐 Very High - Phone verified'
        };
        
        serverEmbed.addFields({ 
            name: 'Verification Level', 
            value: verificationLevels[guild.verificationLevel] || 'Unknown', 
            inline: true 
        });

        // Content filter
        const contentFilter = {
            0: '🔓 Disabled',
            1: '⚠️ Members without roles',
            2: '🛡️ All members'
        };
        
        serverEmbed.addFields({ 
            name: 'Content Filter', 
            value: contentFilter[guild.explicitContentFilter] || 'Unknown', 
            inline: true 
        });

        // Features
        const features = [];
        if (guild.features.includes('COMMUNITY')) features.push('📢 Community');
        if (guild.features.includes('WELCOME_SCREEN_ENABLED')) features.push('👋 Welcome Screen');
        if (guild.features.includes('DISCOVERABLE')) features.push('🔍 Discoverable');
        if (guild.features.includes('PARTNERED')) features.push('🤝 Partnered');
        if (guild.features.includes('VERIFIED')) features.push('✅ Verified');
        if (guild.features.includes('VANITY_URL')) features.push('🔗 Custom Invite');
        if (guild.features.includes('INVITE_SPLASH')) features.push('🎨 Invite Splash');
        if (guild.features.includes('BANNER')) features.push('🏳️ Banner');
        if (guild.features.includes('ANIMATED_ICON')) features.push('🎭 Animated Icon');

        if (features.length > 0) {
            const featuresText = features.length > 6 
                ? features.slice(0, 6).join(', ') + ` and ${features.length - 6} more...`
                : features.join(', ');
            serverEmbed.addFields({ name: 'Features', value: featuresText, inline: false });
        }

        // Emoji info
        const totalEmojis = guild.emojis.cache.size;
        const animatedEmojis = guild.emojis.cache.filter(emoji => emoji.animated).size;
        const staticEmojis = totalEmojis - animatedEmojis;
        
        if (totalEmojis > 0) {
            serverEmbed.addFields({ 
                name: 'Emojis', 
                value: `${totalEmojis} (${staticEmojis} static, ${animatedEmojis} animated)`, 
                inline: true 
            });
        }

        // Sticker info
        if (guild.stickers.cache.size > 0) {
            serverEmbed.addFields({ name: 'Stickers', value: `${guild.stickers.cache.size}`, inline: true });
        }

        // Server age
        const serverAge = Date.now() - guild.createdTimestamp;
        const days = Math.floor(serverAge / (1000 * 60 * 60 * 24));
        const years = Math.floor(days / 365);
        
        let ageText = `${days} days old`;
        if (years > 0) {
            ageText = `${years} year${years > 1 ? 's' : ''} old`;
        }
        
        serverEmbed.addFields({ name: 'Server Age', value: ageText, inline: true });

        // Add banner if available
        if (guild.banner) {
            serverEmbed.setImage(guild.bannerURL({ dynamic: true, size: 1024 }));
        }

        await interaction.editReply({ embeds: [serverEmbed] });

        // Log command usage to dashboard
        try {
            const bot = interaction.client.bot;
            if (bot && bot.dashboardLogger) {
                await bot.dashboardLogger.logCommandUsage(
                    'serverinfo',
                    interaction.user.id,
                    interaction.user.username,
                    interaction.guild.id,
                    interaction.guild.name,
                    { 
                        memberCount: guild.memberCount,
                        boostLevel: guild.premiumTier,
                        boostCount: guild.premiumSubscriptionCount
                    }
                );
            }
        } catch (error) {
            // Silent fail - don't break command if logging fails
            console.error('Dashboard logging failed for serverinfo command:', error);
        }
    },
};