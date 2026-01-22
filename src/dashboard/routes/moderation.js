/**
 * Moderation Routes
 * Handles user management, warnings, bans, and moderation logs
 */

const express = require('express');
const { t } = require('../../../locale');

class ModerationRoutes {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.bot = dashboard.bot;
        this.router = express.Router();
        
        this.setupRoutes();
    }

    setupRoutes() {
        const auth = this.dashboard.middleware.authenticateToken.bind(this.dashboard.middleware);
        const guildAccess = this.dashboard.middleware.requireGuildAccess.bind(this.dashboard.middleware);

        // Warnings
        this.router.get('/:guildId/warnings', auth, guildAccess, this.getWarnings.bind(this));
        this.router.get('/:guildId/warnings/:userId', auth, guildAccess, this.getUserWarnings.bind(this));
        this.router.post('/:guildId/warnings', auth, guildAccess, this.addWarning.bind(this));
        this.router.delete('/:guildId/warnings/:warningId', auth, guildAccess, this.removeWarning.bind(this));
        
        // Bans
        this.router.get('/:guildId/bans', auth, guildAccess, this.getBans.bind(this));
        this.router.post('/:guildId/bans', auth, guildAccess, this.addBan.bind(this));
        this.router.delete('/:guildId/bans/:userId', auth, guildAccess, this.removeBan.bind(this));
        
        // Mod logs
        this.router.get('/:guildId/logs', auth, guildAccess, this.getModLogs.bind(this));
        
        // User lookup
        this.router.get('/:guildId/users/:userId', auth, guildAccess, this.getUserInfo.bind(this));
        this.router.get('/:guildId/users/:userId/history', auth, guildAccess, this.getUserHistory.bind(this));
        
        // Verification queue
        this.router.get('/:guildId/verification/queue', auth, guildAccess, this.getVerificationQueue.bind(this));
        this.router.post('/:guildId/verification/:userId/approve', auth, guildAccess, this.approveVerification.bind(this));
        this.router.post('/:guildId/verification/:userId/deny', auth, guildAccess, this.denyVerification.bind(this));
        
        // Strikes
        this.router.get('/:guildId/strikes/:userId', auth, guildAccess, this.getUserStrikes.bind(this));
        this.router.post('/:guildId/strikes', auth, guildAccess, this.addStrike.bind(this));
        this.router.delete('/:guildId/strikes/:strikeId', auth, guildAccess, this.removeStrike.bind(this));
    }

    /**
     * Get all warnings for a guild
     */
    async getWarnings(req, res) {
        try {
            const { guildId } = req.params;
            const { page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            const warnings = await this.bot.database.all(`
                SELECT w.*, u.username as user_username, m.username as mod_username
                FROM warnings w
                LEFT JOIN user_records u ON w.guild_id = u.guild_id AND w.user_id = u.user_id
                LEFT JOIN user_records m ON w.guild_id = m.guild_id AND w.moderator_id = m.user_id
                WHERE w.guild_id = ?
                ORDER BY w.created_at DESC
                LIMIT ? OFFSET ?
            `, [guildId, parseInt(limit), offset]);

            const countResult = await this.bot.database.get(
                'SELECT COUNT(*) as total FROM warnings WHERE guild_id = ?',
                [guildId]
            );

            res.json({
                warnings: warnings || [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult?.total || 0,
                    pages: Math.ceil((countResult?.total || 0) / parseInt(limit))
                }
            });
        } catch (error) {
            this.bot.logger?.error('Error getting warnings:', error);
            res.status(500).json({ error: 'Failed to get warnings' });
        }
    }

    /**
     * Get warnings for a specific user
     */
    async getUserWarnings(req, res) {
        try {
            const { guildId, userId } = req.params;

            const warnings = await this.bot.database.all(`
                SELECT * FROM warnings 
                WHERE guild_id = ? AND user_id = ?
                ORDER BY created_at DESC
            `, [guildId, userId]);

            res.json({ warnings: warnings || [] });
        } catch (error) {
            this.bot.logger?.error('Error getting user warnings:', error);
            res.status(500).json({ error: 'Failed to get user warnings' });
        }
    }

    /**
     * Add a warning
     */
    async addWarning(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason } = req.body;
            const lang = req.guildAccess?.config?.language || 'en';

            if (!userId) {
                return res.status(400).json({ error: t(lang, 'errors.moderation.user_required') || 'User ID required' });
            }

            await this.bot.database.run(`
                INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [guildId, userId, req.user.userId, reason || 'No reason provided']);

            // Log the action
            await this.logModAction(guildId, 'warning', userId, req.user.userId, reason);

            res.json({ success: true, message: t(lang, 'moderation.warn.success') || 'Warning added' });
        } catch (error) {
            this.bot.logger?.error('Error adding warning:', error);
            res.status(500).json({ error: 'Failed to add warning' });
        }
    }

    /**
     * Remove a warning
     */
    async removeWarning(req, res) {
        try {
            const { guildId, warningId } = req.params;

            await this.bot.database.run(
                'DELETE FROM warnings WHERE id = ? AND guild_id = ?',
                [warningId, guildId]
            );

            res.json({ success: true, message: 'Warning removed' });
        } catch (error) {
            this.bot.logger?.error('Error removing warning:', error);
            res.status(500).json({ error: 'Failed to remove warning' });
        }
    }

    /**
     * Get ban list
     */
    async getBans(req, res) {
        try {
            const { guildId } = req.params;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const bans = await guild.bans.fetch();
            const banList = bans.map(ban => ({
                id: ban.user.id,
                username: ban.user.username,
                discriminator: ban.user.discriminator,
                avatar: ban.user.displayAvatarURL({ size: 64 }),
                reason: ban.reason
            }));

            res.json({ bans: banList });
        } catch (error) {
            this.bot.logger?.error('Error getting bans:', error);
            res.status(500).json({ error: 'Failed to get bans' });
        }
    }

    /**
     * Add a ban
     */
    async addBan(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason, deleteMessageDays = 0 } = req.body;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            if (!userId) {
                return res.status(400).json({ error: 'User ID required' });
            }

            await guild.members.ban(userId, {
                reason: reason || `Dashboard ban by ${req.user.username}`,
                deleteMessageDays: Math.min(7, Math.max(0, parseInt(deleteMessageDays)))
            });

            await this.logModAction(guildId, 'ban', userId, req.user.userId, reason);

            res.json({ success: true, message: 'User banned' });
        } catch (error) {
            this.bot.logger?.error('Error banning user:', error);
            res.status(500).json({ error: 'Failed to ban user' });
        }
    }

    /**
     * Remove a ban (unban)
     */
    async removeBan(req, res) {
        try {
            const { guildId, userId } = req.params;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            await guild.members.unban(userId, `Dashboard unban by ${req.user.username}`);
            await this.logModAction(guildId, 'unban', userId, req.user.userId, 'Dashboard unban');

            res.json({ success: true, message: 'User unbanned' });
        } catch (error) {
            this.bot.logger?.error('Error unbanning user:', error);
            res.status(500).json({ error: 'Failed to unban user' });
        }
    }

    /**
     * Get moderation logs
     */
    async getModLogs(req, res) {
        try {
            const { guildId } = req.params;
            const { page = 1, limit = 50, type } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let query = `
                SELECT * FROM mod_logs 
                WHERE guild_id = ?
            `;
            const params = [guildId];

            if (type) {
                query += ' AND action_type = ?';
                params.push(type);
            }

            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), offset);

            const logs = await this.bot.database.all(query, params);
            
            const countResult = await this.bot.database.get(
                'SELECT COUNT(*) as total FROM mod_logs WHERE guild_id = ?',
                [guildId]
            );

            res.json({
                logs: logs || [],
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult?.total || 0
                }
            });
        } catch (error) {
            this.bot.logger?.error('Error getting mod logs:', error);
            res.status(500).json({ error: 'Failed to get mod logs' });
        }
    }

    /**
     * Get user info
     */
    async getUserInfo(req, res) {
        try {
            const { guildId, userId } = req.params;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            // Try to get member from cache or fetch
            let member = guild.members.cache.get(userId);
            if (!member) {
                try {
                    member = await guild.members.fetch(userId);
                } catch {
                    // User might not be in guild
                }
            }

            // Get user record from database
            const userRecord = await this.bot.database.get(
                'SELECT * FROM user_records WHERE guild_id = ? AND user_id = ?',
                [guildId, userId]
            );

            // Get warning count
            const warningCount = await this.bot.database.get(
                'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND user_id = ?',
                [guildId, userId]
            );

            const response = {
                id: userId,
                username: member?.user?.username || userRecord?.username || 'Unknown',
                discriminator: member?.user?.discriminator || userRecord?.discriminator,
                avatar: member?.user?.displayAvatarURL({ size: 256 }) || userRecord?.avatar_url,
                joinedAt: member?.joinedAt,
                createdAt: member?.user?.createdAt,
                roles: member?.roles?.cache?.map(r => ({ id: r.id, name: r.name, color: r.hexColor })) || [],
                inGuild: !!member,
                verificationStatus: userRecord?.verification_status || 'unknown',
                trustScore: userRecord?.trust_score || 50,
                warningCount: warningCount?.count || 0,
                notes: userRecord?.notes
            };

            res.json(response);
        } catch (error) {
            this.bot.logger?.error('Error getting user info:', error);
            res.status(500).json({ error: 'Failed to get user info' });
        }
    }

    /**
     * Get user moderation history
     */
    async getUserHistory(req, res) {
        try {
            const { guildId, userId } = req.params;

            const [warnings, modActions, strikes] = await Promise.all([
                this.bot.database.all(
                    'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
                    [guildId, userId]
                ),
                this.bot.database.all(
                    'SELECT * FROM mod_logs WHERE guild_id = ? AND target_id = ? ORDER BY created_at DESC LIMIT 50',
                    [guildId, userId]
                ),
                this.bot.database.all(
                    'SELECT * FROM user_strikes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
                    [guildId, userId]
                ).catch(() => [])
            ]);

            res.json({
                warnings: warnings || [],
                modActions: modActions || [],
                strikes: strikes || []
            });
        } catch (error) {
            this.bot.logger?.error('Error getting user history:', error);
            res.status(500).json({ error: 'Failed to get user history' });
        }
    }

    /**
     * Get verification queue
     */
    async getVerificationQueue(req, res) {
        try {
            const { guildId } = req.params;

            const queue = await this.bot.database.all(`
                SELECT * FROM verification_queue 
                WHERE guild_id = ? AND status IN ('pending', 'awaiting_approval')
                ORDER BY created_at ASC
            `, [guildId]);

            res.json({ queue: queue || [] });
        } catch (error) {
            this.bot.logger?.error('Error getting verification queue:', error);
            res.status(500).json({ error: 'Failed to get verification queue' });
        }
    }

    /**
     * Approve verification
     */
    async approveVerification(req, res) {
        try {
            const { guildId, userId } = req.params;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                return res.status(404).json({ error: 'Member not found' });
            }

            // Mark as verified
            if (this.bot.userVerification) {
                await this.bot.userVerification.markVerified(member, 'dashboard_approval');
            }

            // Update queue status
            await this.bot.database.run(`
                UPDATE verification_queue 
                SET status = 'approved', completed_at = CURRENT_TIMESTAMP 
                WHERE guild_id = ? AND user_id = ? AND status IN ('pending', 'awaiting_approval')
            `, [guildId, userId]);

            res.json({ success: true, message: 'Verification approved' });
        } catch (error) {
            this.bot.logger?.error('Error approving verification:', error);
            res.status(500).json({ error: 'Failed to approve verification' });
        }
    }

    /**
     * Deny verification
     */
    async denyVerification(req, res) {
        try {
            const { guildId, userId } = req.params;
            const { reason, kick = false } = req.body;
            const guild = this.bot.client.guilds.cache.get(guildId);

            if (!guild) {
                return res.status(404).json({ error: 'Guild not found' });
            }

            // Update queue status
            await this.bot.database.run(`
                UPDATE verification_queue 
                SET status = 'denied', completed_at = CURRENT_TIMESTAMP 
                WHERE guild_id = ? AND user_id = ? AND status IN ('pending', 'awaiting_approval')
            `, [guildId, userId]);

            // Optionally kick the user
            if (kick) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await member.kick(reason || 'Verification denied');
                }
            }

            res.json({ success: true, message: 'Verification denied' });
        } catch (error) {
            this.bot.logger?.error('Error denying verification:', error);
            res.status(500).json({ error: 'Failed to deny verification' });
        }
    }

    /**
     * Get user strikes
     */
    async getUserStrikes(req, res) {
        try {
            const { guildId, userId } = req.params;

            const strikes = await this.bot.database.all(`
                SELECT * FROM user_strikes 
                WHERE guild_id = ? AND user_id = ?
                ORDER BY created_at DESC
            `, [guildId, userId]);

            const totalPoints = strikes?.reduce((sum, s) => sum + (s.points || 1), 0) || 0;

            res.json({ 
                strikes: strikes || [],
                totalPoints
            });
        } catch (error) {
            this.bot.logger?.error('Error getting strikes:', error);
            res.status(500).json({ error: 'Failed to get strikes' });
        }
    }

    /**
     * Add a strike
     */
    async addStrike(req, res) {
        try {
            const { guildId } = req.params;
            const { userId, reason, points = 1 } = req.body;

            if (!userId) {
                return res.status(400).json({ error: 'User ID required' });
            }

            await this.bot.database.run(`
                INSERT INTO user_strikes (guild_id, user_id, moderator_id, reason, points, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [guildId, userId, req.user.userId, reason || 'No reason provided', points]);

            res.json({ success: true, message: 'Strike added' });
        } catch (error) {
            this.bot.logger?.error('Error adding strike:', error);
            res.status(500).json({ error: 'Failed to add strike' });
        }
    }

    /**
     * Remove a strike
     */
    async removeStrike(req, res) {
        try {
            const { guildId, strikeId } = req.params;

            await this.bot.database.run(
                'DELETE FROM user_strikes WHERE id = ? AND guild_id = ?',
                [strikeId, guildId]
            );

            res.json({ success: true, message: 'Strike removed' });
        } catch (error) {
            this.bot.logger?.error('Error removing strike:', error);
            res.status(500).json({ error: 'Failed to remove strike' });
        }
    }

    /**
     * Log a moderation action
     */
    async logModAction(guildId, actionType, targetId, moderatorId, reason) {
        try {
            await this.bot.database.run(`
                INSERT INTO mod_logs (guild_id, action_type, target_id, moderator_id, reason, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [guildId, actionType, targetId, moderatorId, reason]);
        } catch (error) {
            this.bot.logger?.warn('Failed to log mod action:', error);
        }
    }

    getRouter() {
        return this.router;
    }
}

module.exports = ModerationRoutes;
