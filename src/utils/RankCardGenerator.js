/**
 * Rank Card Generator
 * Creates beautiful visual rank cards using Canvas with gradients and modern design
 */

const path = require('path');

// Gracefully handle missing canvas module
let createCanvas = null;
let loadImage = null;
let registerFont = null;

try {
    ({ createCanvas, loadImage, registerFont } = require('canvas'));
} catch (err) {
    console.warn('[RankCardGenerator] Canvas module not available, rank cards will use fallback');
}

const FALLBACK_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

class RankCardGenerator {
    constructor() {
        this.width = 934;
        this.height = 282;
        
        // Try to register custom fonts if available
        try {
            const fontsPath = path.join(__dirname, '../assets/fonts');
            registerFont(path.join(fontsPath, 'Roboto-Bold.ttf'), { family: 'Roboto', weight: 'bold' });
            registerFont(path.join(fontsPath, 'Roboto-Regular.ttf'), { family: 'Roboto', weight: 'normal' });
        } catch (error) {
            console.log('Custom fonts not found, using system defaults');
        }
    }

    /**
     * Generate a rank card for a user
     * @param {Object} stats - User stats (xp, level, total_messages, rank)
     * @param {GuildMember} member - Discord guild member
     * @returns {Buffer} PNG image buffer
     */
    async generateCard(stats, member) {
        // If canvas is not available, return fallback
        if (!createCanvas) {
            return Buffer.from(FALLBACK_PNG_BASE64, 'base64');
        }

        const canvas = createCanvas(this.width, this.height);
        const ctx = canvas.getContext('2d');

        // Use pre-calculated values from stats
        const progressXP = stats.xpProgress || 0;
        const requiredXP = stats.xpNeeded || 1;
        const progress = Math.max(0, Math.min(1, stats.progressPercent / 100 || 0));

        // Draw background with gradient
        await this.drawBackground(ctx, member);

        // Draw avatar with level border
        await this.drawAvatar(ctx, member, stats.level);

        // Draw username and discriminator
        this.drawUsername(ctx, member, stats);

        // Draw rank badge
        this.drawRank(ctx, stats.rank || 0);

        // Draw level display
        this.drawLevel(ctx, stats.level);

        // Draw XP progress bar
        this.drawProgressBar(ctx, progress, progressXP, requiredXP);

        // Draw footer
        this.drawFooter(ctx);

        return canvas.toBuffer('image/png');
    }

    async drawBackground(ctx, member) {
        // Dark navy background like the image
        ctx.fillStyle = '#0a1628';
        ctx.fillRect(0, 0, this.width, this.height);

        // Cyan border glow
        ctx.save();
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 20;
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        this.roundRect(ctx, 10, 10, this.width - 20, this.height - 20, 15);
        ctx.stroke();
        ctx.restore();

        // Inner border
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, 15, 15, this.width - 30, this.height - 30, 12);
        ctx.stroke();
    }

    async drawAvatar(ctx, member, level) {
        const avatarSize = 180;
        const avatarX = 40;
        const avatarY = 60;

        try {
            // Load avatar
            const avatar = await loadImage(
                member.user.displayAvatarURL({ extension: 'png', size: 256 })
            );

            // Draw cyan glowing ring
            ctx.save();
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 15;
            ctx.strokeStyle = '#00d4ff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // Clip and draw avatar
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();

        } catch (error) {
            console.error('Failed to load avatar:', error);
            // Draw placeholder
            ctx.fillStyle = '#1e3a5f';
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawUsername(ctx, member, stats) {
        const startX = 250;
        const startY = 65;

        // Username
        ctx.font = 'bold 36px "Segoe UI", Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        const username = member.user.username;
        const maxWidth = 420;
        ctx.fillText(username, startX, startY, maxWidth);

        // Rank medal badge
        const medal = stats.rank === 1 ? '🥇' : stats.rank === 2 ? '🥈' : stats.rank === 3 ? '🥉' : null;
        if (medal) {
            ctx.font = '32px "Segoe UI", Arial';
            ctx.fillText(medal, startX + ctx.measureText(username).width + 15, startY);
        }

        // User ID
        ctx.font = '15px "Segoe UI", Arial';
        ctx.fillStyle = '#8899aa';
        ctx.fillText(`ID: ${member.user.id}`, startX, startY + 50);

        // Member Since with Top % badge
        ctx.font = '13px "Segoe UI", Arial';
        ctx.fillStyle = '#6b7a8c';
        const joinedDate = member.joinedAt ? new Date(member.joinedAt).toLocaleDateString('en-US', { 
            month: 'short', 
            year: 'numeric' 
        }) : 'Unknown';
        ctx.fillText(`MEMBER SINCE ${joinedDate}`, startX, startY + 75);
        
        // Top % badge
        if (stats.topPercent <= 10) {
            ctx.font = 'bold 12px "Segoe UI", Arial';
            ctx.fillStyle = '#00d4ff';
            const topText = `TOP ${stats.topPercent}%`;
            ctx.fillText(topText, startX, startY + 95);
        }
        
        // Streak indicator
        if (stats.streak >= 2) {
            ctx.font = '12px "Segoe UI", Arial';
            ctx.fillStyle = '#ffaa00';
            ctx.fillText(`🔥 ${stats.streak} day streak`, startX + 180, startY + 95);
        }
    }

    drawRank(ctx, rank) {
        const boxWidth = 120;
        const boxHeight = 100;
        const x = this.width - boxWidth - 30;
        const y = (this.height - boxHeight) / 2;

        // Cyan glowing border
        ctx.save();
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, boxWidth, boxHeight, 8);
        ctx.stroke();
        ctx.restore();

        // Semi-transparent background
        ctx.fillStyle = 'rgba(10, 22, 40, 0.6)';
        ctx.beginPath();
        ctx.roundRect(x, y, boxWidth, boxHeight, 8);
        ctx.fill();

        // Label
        ctx.font = 'bold 13px "Segoe UI", Arial';
        ctx.fillStyle = '#8899aa';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('RANK', x + boxWidth / 2, y + 25);

        // Rank value
        ctx.font = 'bold 32px "Segoe UI", Arial';
        ctx.fillStyle = '#00d4ff';
        ctx.fillText(`#${rank}`, x + boxWidth / 2, y + 50);
    }

    drawLevel(ctx, level) {
        const boxWidth = 120;
        const boxHeight = 100;
        const x = this.width - boxWidth * 2 - 60;
        const y = (this.height - boxHeight) / 2;

        // Cyan glowing border
        ctx.save();
        ctx.shadowColor = '#00d4ff';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, boxWidth, boxHeight, 8);
        ctx.stroke();
        ctx.restore();

        // Semi-transparent background
        ctx.fillStyle = 'rgba(10, 22, 40, 0.6)';
        ctx.beginPath();
        ctx.roundRect(x, y, boxWidth, boxHeight, 8);
        ctx.fill();

        // Label
        ctx.font = 'bold 13px "Segoe UI", Arial';
        ctx.fillStyle = '#8899aa';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('LEVEL', x + boxWidth / 2, y + 25);

        // Level value
        ctx.font = 'bold 32px "Segoe UI", Arial';
        ctx.fillStyle = '#00d4ff';
        ctx.fillText(level.toString(), x + boxWidth / 2, y + 50);
    }

    drawProgressBar(ctx, progress, currentXP, requiredXP) {
        const barX = 250;
        const barY = 190;
        const barWidth = 410;
        const barHeight = 28;
        const barRadius = 14;

        // Background bar
        ctx.fillStyle = 'rgba(20, 30, 48, 0.8)';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth, barHeight, barRadius);
        ctx.fill();

        // Progress fill with cyan glow
        const fillWidth = Math.max(barWidth * progress, 10);
        if (fillWidth > 0) {
            ctx.save();
            ctx.shadowColor = '#00d4ff';
            ctx.shadowBlur = 12;
            
            ctx.fillStyle = '#00d4ff';
            ctx.beginPath();
            ctx.roundRect(barX, barY, fillWidth, barHeight, barRadius);
            ctx.fill();
            ctx.restore();
        }

        // Cyan border
        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth, barHeight, barRadius);
        ctx.stroke();

        // XP text
        ctx.font = '14px "Segoe UI", Arial';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const xpText = `${this.formatNumber(currentXP)} / ${this.formatNumber(requiredXP)} XP`;
        ctx.fillText(xpText, barX + barWidth / 2, barY + barHeight / 2);
    }

    drawStats(ctx, stats) {
        // Security stats panel - placeholder for now
        // This method is not used in the cybersecurity theme
        // Stats are shown in a separate panel (to be implemented if needed)
    }

    drawFooter(ctx) {
        const text = 'POWERED BY GUARDIANBOT SECURITY';
        const y = this.height - 8;

        ctx.font = '9px "Segoe UI", Arial';
        ctx.fillStyle = '#4a5a6a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, this.width / 2, y);
    }

    // Helper methods
    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    adjustColorBrightness(hex, percent) {
        // Convert hex to RGB
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, Math.min(255, (num >> 16) + percent));
        const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + percent));
        const b = Math.max(0, Math.min(255, (num & 0x0000FF) + percent));
        
        return `rgb(${r}, ${g}, ${b})`;
    }

    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    getXPForLevel(level) {
        // SECURITY FIX (MEDIUM 19): Use canonical formula from levelFormula module
        // Previously used level² × 100, now matches rest of codebase: (level/0.1)²
        const { xpForLevel } = require('./levelFormula');
        return xpForLevel(level);
    }
}

module.exports = RankCardGenerator;
