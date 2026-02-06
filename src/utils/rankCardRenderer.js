/**
 * Arcane-Style Rank Card Renderer
 * Production-ready image generator for Discord XP rank cards
 * Modern dark design with smooth gradients and rounded edges
 */

const { createCanvas, loadImage } = require('canvas');

class RankCardRenderer {
    constructor() {
        // Canvas dimensions
        this.width = 1024;
        this.height = 256;
        
        // Avatar configuration
        this.avatarSize = 160;
        this.avatarX = 120;
        this.avatarY = this.height / 2;
        
        // Card styling
        this.borderRadius = 24;
        
        // Color palette (Arcane-inspired)
        this.colors = {
            background: '#0a0e1a',
            cardDark: '#151a2e',
            cardOverlay: '#1a1f36',
            accent: '#3b82f6',
            accentBright: '#60a5fa',
            accentGlow: 'rgba(59, 130, 246, 0.4)',
            text: '#ffffff',
            textMuted: '#9ca3af',
            textDim: '#6b7280',
            progressBg: '#1e293b',
            progressFill: '#3b82f6',
            progressFillEnd: '#60a5fa'
        };
    }

    /**
     * Generate rank card image buffer
     * @param {Object} data - User rank data
     * @param {string} data.username - Discord username
     * @param {string} data.avatarURL - Discord avatar URL
     * @param {number} data.level - User level
     * @param {number} data.rank - User rank position
     * @param {number} data.currentXP - Current XP in level
     * @param {number} data.requiredXP - XP required for next level
     * @returns {Promise<Buffer>} PNG image buffer
     */
    async generateCard(data) {
        const {
            username,
            avatarURL,
            level = 0,
            rank = 0,
            currentXP = 0,
            requiredXP = 100
        } = data;

        // Create canvas
        const canvas = createCanvas(this.width, this.height);
        const ctx = canvas.getContext('2d');

        // Enable high-quality rendering
        ctx.quality = 'best';
        ctx.patternQuality = 'best';
        ctx.textDrawingMode = 'glyph';

        // Draw all components
        this.drawBackground(ctx);
        this.drawDecorations(ctx);
        await this.drawAvatar(ctx, avatarURL);
        this.drawUsername(ctx, username);
        this.drawStats(ctx, level, rank);
        
        const progress = requiredXP > 0 ? currentXP / requiredXP : 0;
        this.drawXPInfo(ctx, currentXP, requiredXP, progress);
        this.drawProgressBar(ctx, progress);

        return canvas.toBuffer('image/png');
    }

    /**
     * Draw dark gradient background with rounded card
     */
    drawBackground(ctx) {
        // Outer background
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.width, this.height);

        // Main card with rounded corners
        ctx.fillStyle = this.colors.cardDark;
        this.roundRect(ctx, 20, 20, this.width - 40, this.height - 40, this.borderRadius);
        ctx.fill();

        // Gradient overlay for depth
        const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.08)');
        gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.05)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.08)');
        
        ctx.fillStyle = gradient;
        this.roundRect(ctx, 20, 20, this.width - 40, this.height - 40, this.borderRadius);
        ctx.fill();
    }

    /**
     * Draw decorative floating circles
     */
    drawDecorations(ctx) {
        const circles = [
            { x: 850, y: 60, radius: 45, opacity: 0.035 },
            { x: 920, y: 190, radius: 70, opacity: 0.025 },
            { x: 770, y: 140, radius: 35, opacity: 0.045 }
        ];

        circles.forEach(circle => {
            ctx.fillStyle = `rgba(59, 130, 246, ${circle.opacity})`;
            ctx.beginPath();
            ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    /**
     * Draw user avatar with glow effect
     */
    async drawAvatar(ctx, avatarURL) {
        try {
            const avatar = await loadImage(avatarURL);
            const radius = this.avatarSize / 2;

            // Outer glow ring
            ctx.save();
            ctx.shadowColor = this.colors.accentGlow;
            ctx.shadowBlur = 24;
            ctx.fillStyle = this.colors.accent;
            ctx.beginPath();
            ctx.arc(this.avatarX, this.avatarY, radius + 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Avatar circle (clipped)
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.avatarX, this.avatarY, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            
            ctx.drawImage(
                avatar,
                this.avatarX - radius,
                this.avatarY - radius,
                this.avatarSize,
                this.avatarSize
            );
            ctx.restore();

        } catch (error) {
            console.error('[RankCard] Failed to load avatar:', error.message);
            
            // Fallback: draw colored circle
            ctx.fillStyle = this.colors.accent;
            ctx.beginPath();
            ctx.arc(this.avatarX, this.avatarY, this.avatarSize / 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Add user initial
            ctx.fillStyle = this.colors.text;
            ctx.font = 'bold 64px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', this.avatarX, this.avatarY);
        }
    }

    /**
     * Draw username text
     */
    drawUsername(ctx, username) {
        const maxWidth = 420;
        let displayName = username;
        
        // Truncate if too long
        ctx.font = 'bold 38px Arial, sans-serif';
        let textWidth = ctx.measureText(displayName).width;
        
        while (textWidth > maxWidth && displayName.length > 3) {
            displayName = displayName.substring(0, displayName.length - 1);
            textWidth = ctx.measureText(displayName + '...').width;
        }
        
        if (displayName !== username) {
            displayName += '...';
        }

        ctx.fillStyle = this.colors.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayName, 250, 88);
    }

    /**
     * Draw level and rank stats (top-right)
     */
    drawStats(ctx, level, rank) {
        // Level
        const levelX = 860;
        const levelY = 75;

        // Label
        ctx.font = '16px Arial';
        ctx.fillStyle = this.colors.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText('LEVEL', levelX, levelY);

        // Value
        ctx.font = 'bold 46px Arial';
        ctx.fillStyle = this.colors.accentBright;
        ctx.fillText(String(level), levelX, levelY + 42);

        // Rank
        const rankX = 980;
        const rankY = 75;

        // Label
        ctx.font = '16px Arial';
        ctx.fillStyle = this.colors.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText('RANK', rankX, rankY);

        // Value
        ctx.font = 'bold 46px Arial';
        ctx.fillStyle = this.colors.accentBright;
        ctx.fillText(`#${rank}`, rankX, rankY + 42);
    }

    /**
     * Draw XP information above progress bar
     */
    drawXPInfo(ctx, currentXP, requiredXP, progress) {
        const progressPercent = Math.round(progress * 100);
        
        ctx.font = '19px Arial';
        ctx.fillStyle = this.colors.textMuted;
        ctx.textAlign = 'right';
        
        const xpText = `${this.formatNumber(currentXP)} / ${this.formatNumber(requiredXP)} XP`;
        ctx.fillText(xpText, 980, 168);
    }

    /**
     * Draw smooth gradient progress bar
     */
    drawProgressBar(ctx, progress) {
        const barX = 250;
        const barY = 182;
        const barWidth = 730;
        const barHeight = 32;
        const barRadius = 16;

        // Background bar
        ctx.fillStyle = this.colors.progressBg;
        this.roundRect(ctx, barX, barY, barWidth, barHeight, barRadius);
        ctx.fill();

        // Progress fill
        if (progress > 0) {
            const fillWidth = Math.max(barRadius * 2, barWidth * Math.min(progress, 1));
            
            // Create gradient fill
            const gradient = ctx.createLinearGradient(barX, 0, barX + fillWidth, 0);
            gradient.addColorStop(0, this.colors.progressFill);
            gradient.addColorStop(1, this.colors.progressFillEnd);
            
            ctx.fillStyle = gradient;
            this.roundRect(ctx, barX, barY, fillWidth, barHeight, barRadius);
            ctx.fill();

            // Glow effect on progress bar
            ctx.save();
            ctx.shadowColor = this.colors.accentGlow;
            ctx.shadowBlur = 18;
            this.roundRect(ctx, barX, barY, fillWidth, barHeight, barRadius);
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * Draw rounded rectangle path
     */
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

    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
}

// Export singleton instance
module.exports = new RankCardRenderer();
