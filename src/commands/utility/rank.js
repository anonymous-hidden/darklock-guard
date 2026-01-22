const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');

// Try to load canvas - it's optional for visual rank cards
let createCanvas, loadImage, registerFont;
let canvasAvailable = false;
try {
    const canvas = require('canvas');
    createCanvas = canvas.createCanvas;
    loadImage = canvas.loadImage;
    registerFont = canvas.registerFont;
    canvasAvailable = true;
    
    // Try to register custom font if available
    try {
        registerFont(path.join(__dirname, '../../assets/fonts/Poppins-Bold.ttf'), { family: 'Poppins', weight: 'bold' });
        registerFont(path.join(__dirname, '../../assets/fonts/Poppins-Regular.ttf'), { family: 'Poppins' });
    } catch (e) {
        // Font not available, will use default
    }
} catch (e) {
    console.warn('⚠️ Canvas module not available - rank cards will use text-only format');
    canvasAvailable = false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('View your XP rank card or another user\'s rank')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (defaults to yourself)')
                .setRequired(false)),

    async execute(interaction, bot) {
        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const guildId = interaction.guild.id;

            // Check if XP system is enabled
            const guildConfig = await bot.database.getGuildConfig(guildId);
            if (!guildConfig?.xp_enabled) {
                return interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#ff6b6b')
                        .setDescription('❌ XP system is not enabled on this server. An admin can enable it in the dashboard.')
                    ]
                });
            }

            // Get user stats from rank system
            const stats = await bot.rankSystem.getUserStats(guildId, targetUser.id);
            
            // Calculate progress to next level
            const currentLevelXP = bot.rankSystem.getXPForLevel(stats.level);
            const nextLevelXP = bot.rankSystem.getXPForLevel(stats.level + 1);
            const progressXP = stats.xp - currentLevelXP;
            const neededXP = nextLevelXP - currentLevelXP;
            const progressPercent = Math.min(100, Math.floor((progressXP / neededXP) * 100));

            // Try to generate rank card image, fall back to embed if canvas fails
            let response;
            try {
                const attachment = await generateRankCard(targetUser, stats, progressPercent, progressXP, neededXP);
                response = { files: [attachment] };
            } catch (canvasError) {
                // Fall back to embed if canvas generation fails
                console.error('Canvas generation failed, using embed fallback:', canvasError.message);
                const embed = createRankEmbed(targetUser, stats, progressPercent, progressXP, neededXP);
                response = { embeds: [embed] };
            }

            await interaction.editReply(response);

        } catch (error) {
            console.error('Error executing rank command:', error);
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#ff6b6b')
                    .setDescription('❌ An error occurred while fetching rank data.')
                ]
            });
        }
    }
};

/**
 * Generate a visual rank card using canvas
 */
async function generateRankCard(user, stats, progressPercent, progressXP, neededXP) {
    // Check if canvas is available
    if (!canvasAvailable) {
        throw new Error('Canvas module not available');
    }
    
    const canvas = createCanvas(934, 282);
    const ctx = canvas.getContext('2d');

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(0.5, '#16213e');
    gradient.addColorStop(1, '#0f0f23');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add subtle pattern overlay
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let i = 0; i < canvas.width; i += 20) {
        for (let j = 0; j < canvas.height; j += 20) {
            if ((i + j) % 40 === 0) {
                ctx.fillRect(i, j, 10, 10);
            }
        }
    }

    // Glow effect behind avatar
    const glowGradient = ctx.createRadialGradient(141, 141, 50, 141, 141, 120);
    glowGradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
    glowGradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
    ctx.fillStyle = glowGradient;
    ctx.fillRect(0, 0, 282, 282);

    // Avatar circle background
    ctx.beginPath();
    ctx.arc(141, 141, 85, 0, Math.PI * 2);
    ctx.fillStyle = '#0f0f23';
    ctx.fill();

    // Avatar border
    ctx.beginPath();
    ctx.arc(141, 141, 88, 0, Math.PI * 2);
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Load and draw avatar
    try {
        const avatar = await loadImage(user.displayAvatarURL({ extension: 'png', size: 256 }));
        ctx.save();
        ctx.beginPath();
        ctx.arc(141, 141, 80, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, 61, 61, 160, 160);
        ctx.restore();
    } catch (e) {
        // Draw placeholder if avatar fails to load
        ctx.beginPath();
        ctx.arc(141, 141, 80, 0, Math.PI * 2);
        ctx.fillStyle = '#333';
        ctx.fill();
    }

    // Username
    ctx.font = 'bold 32px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    const username = user.username.length > 18 ? user.username.slice(0, 15) + '...' : user.username;
    ctx.fillText(username, 280, 70);

    // Rank badge
    ctx.font = 'bold 24px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#00d4ff';
    ctx.fillText(`#${stats.rank || '—'}`, 280, 110);

    // Level
    ctx.font = 'bold 20px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('LEVEL', 800, 60);
    ctx.font = 'bold 48px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#00d4ff';
    ctx.textAlign = 'right';
    ctx.fillText(stats.level.toString(), 900, 110);
    ctx.textAlign = 'left';

    // XP Text
    ctx.font = '18px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText(`${formatNumber(progressXP)} / ${formatNumber(neededXP)} XP`, 280, 145);

    // Total XP
    ctx.fillStyle = '#666';
    ctx.fillText(`Total: ${formatNumber(stats.xp)} XP`, 550, 145);

    // Messages count
    ctx.fillText(`Messages: ${formatNumber(stats.total_messages || 0)}`, 720, 145);

    // Progress bar background
    const barX = 280;
    const barY = 170;
    const barWidth = 600;
    const barHeight = 30;
    const barRadius = 15;

    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, barRadius);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Progress bar fill
    const progressWidth = Math.max(barRadius * 2, (progressPercent / 100) * barWidth);
    const progressGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    progressGradient.addColorStop(0, '#00d4ff');
    progressGradient.addColorStop(0.5, '#00ff88');
    progressGradient.addColorStop(1, '#00d4ff');

    ctx.beginPath();
    ctx.roundRect(barX, barY, progressWidth, barHeight, barRadius);
    ctx.fillStyle = progressGradient;
    ctx.fill();

    // Progress percentage text
    ctx.font = 'bold 16px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`${progressPercent}%`, barX + barWidth / 2, barY + 22);
    ctx.textAlign = 'left';

    // XP to next level hint
    ctx.font = '14px "Poppins", Arial, sans-serif';
    ctx.fillStyle = '#666';
    const xpRemaining = neededXP - progressXP;
    ctx.fillText(`${formatNumber(xpRemaining)} XP until Level ${stats.level + 1}`, 280, 225);

    // Border
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'rank-card.png' });
}

/**
 * Create a fallback embed if canvas isn't available
 */
function createRankEmbed(user, stats, progressPercent, progressXP, neededXP) {
    // Create visual progress bar with emojis
    const progressBar = createProgressBar(progressPercent);
    const xpRemaining = neededXP - progressXP;

    return new EmbedBuilder()
        .setColor('#00d4ff')
        .setAuthor({ name: `${user.username}'s Rank`, iconURL: user.displayAvatarURL() })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
            { name: '🏆 Rank', value: `#${stats.rank || '—'}`, inline: true },
            { name: '⭐ Level', value: `${stats.level}`, inline: true },
            { name: '✨ Total XP', value: formatNumber(stats.xp), inline: true },
            { name: '📊 Progress to Next Level', value: `${progressBar}\n${formatNumber(progressXP)} / ${formatNumber(neededXP)} XP (${progressPercent}%)` },
            { name: '💬 Messages', value: formatNumber(stats.total_messages || 0), inline: true },
            { name: '📈 XP Needed', value: formatNumber(xpRemaining), inline: true }
        )
        .setFooter({ text: 'Keep chatting to earn more XP!' })
        .setTimestamp();
}

/**
 * Create a text-based progress bar
 */
function createProgressBar(percent) {
    const filled = Math.floor(percent / 10);
    const empty = 10 - filled;
    return '🟦'.repeat(filled) + '⬛'.repeat(empty);
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
}
