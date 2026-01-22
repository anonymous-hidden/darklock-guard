/**
 * Ticket Routes
 * Handles all ticket management API endpoints
 */

const express = require('express');
const router = express.Router();

module.exports = function(dashboard) {
    const { bot, db, authMiddleware, requireGuildAccess, checkPermission, validateCSRF } = dashboard;
    const t = bot.i18n?.t?.bind(bot.i18n) || ((key) => key);

    /**
     * GET /api/guilds/:guildId/tickets
     * Get all tickets for a guild
     */
    router.get('/guilds/:guildId/tickets', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { status, page = 1, limit = 50 } = req.query;

            let query = 'SELECT * FROM tickets WHERE guild_id = ?';
            const params = [guildId];

            if (status && status !== 'all') {
                query += ' AND status = ?';
                params.push(status);
            }

            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

            const tickets = await db.allAsync(query, params);

            // Get total count for pagination
            const countResult = await db.getAsync(
                'SELECT COUNT(*) as count FROM tickets WHERE guild_id = ?',
                [guildId]
            );

            res.json({
                tickets,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: countResult?.count || 0,
                    pages: Math.ceil((countResult?.count || 0) / parseInt(limit))
                }
            });
        } catch (error) {
            bot.logger?.error('Error fetching tickets:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/tickets/:ticketId
     * Get a specific ticket
     */
    router.get('/guilds/:guildId/tickets/:ticketId', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Get ticket messages/history
            const messages = await db.allAsync(
                'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC',
                [ticketId]
            );

            res.json({ ticket, messages });
        } catch (error) {
            bot.logger?.error('Error fetching ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * PATCH /api/guilds/:guildId/tickets/:ticketId
     * Update a ticket (status, assignee, etc.)
     */
    router.patch('/guilds/:guildId/tickets/:ticketId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { status, assignee, priority, category, notes } = req.body;

            // Verify ticket exists
            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Build update query
            const updates = [];
            const params = [];

            if (status !== undefined) {
                updates.push('status = ?');
                params.push(status);
            }
            if (assignee !== undefined) {
                updates.push('assignee_id = ?');
                params.push(assignee);
            }
            if (priority !== undefined) {
                updates.push('priority = ?');
                params.push(priority);
            }
            if (category !== undefined) {
                updates.push('category = ?');
                params.push(category);
            }
            if (notes !== undefined) {
                updates.push('notes = ?');
                params.push(notes);
            }

            if (updates.length === 0) {
                return res.status(400).json({ error: t('dashboard.errors.noChanges') });
            }

            updates.push('updated_at = ?');
            params.push(new Date().toISOString());

            params.push(ticketId, guildId);

            await db.runAsync(
                `UPDATE tickets SET ${updates.join(', ')} WHERE id = ? AND guild_id = ?`,
                params
            );

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_UPDATE', {
                ticketId,
                changes: req.body
            });

            res.json({ success: true, message: t('dashboard.tickets.updated') });
        } catch (error) {
            bot.logger?.error('Error updating ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/close
     * Close a ticket
     */
    router.post('/guilds/:guildId/tickets/:ticketId/close', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { reason, generateTranscript = true } = req.body;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            if (ticket.status === 'closed') {
                return res.status(400).json({ error: t('dashboard.tickets.alreadyClosed') });
            }

            // Generate transcript if requested
            let transcriptUrl = null;
            if (generateTranscript) {
                transcriptUrl = await dashboard.generateTicketTranscript(ticketId, guildId);
            }

            // Close the ticket
            await db.runAsync(
                `UPDATE tickets SET 
                    status = 'closed', 
                    closed_at = ?, 
                    closed_by = ?, 
                    close_reason = ?,
                    transcript_url = ?
                WHERE id = ? AND guild_id = ?`,
                [
                    new Date().toISOString(),
                    req.user.userId,
                    reason || null,
                    transcriptUrl,
                    ticketId,
                    guildId
                ]
            );

            // Close the Discord channel if it exists
            if (ticket.channel_id) {
                try {
                    const guild = bot.guilds.cache.get(guildId);
                    const channel = guild?.channels.cache.get(ticket.channel_id);
                    if (channel) {
                        await channel.delete(`Ticket closed by ${req.user.username}`);
                    }
                } catch (err) {
                    bot.logger?.warn('Could not delete ticket channel:', err.message);
                }
            }

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_CLOSE', {
                ticketId,
                reason
            });

            res.json({ 
                success: true, 
                message: t('dashboard.tickets.closed'),
                transcriptUrl
            });
        } catch (error) {
            bot.logger?.error('Error closing ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/reopen
     * Reopen a closed ticket
     */
    router.post('/guilds/:guildId/tickets/:ticketId/reopen', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            if (ticket.status !== 'closed') {
                return res.status(400).json({ error: t('dashboard.tickets.notClosed') });
            }

            await db.runAsync(
                `UPDATE tickets SET 
                    status = 'open', 
                    reopened_at = ?,
                    reopened_by = ?
                WHERE id = ? AND guild_id = ?`,
                [new Date().toISOString(), req.user.userId, ticketId, guildId]
            );

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_REOPEN', { ticketId });

            res.json({ success: true, message: t('dashboard.tickets.reopened') });
        } catch (error) {
            bot.logger?.error('Error reopening ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * DELETE /api/guilds/:guildId/tickets/:ticketId
     * Delete a ticket permanently
     */
    router.delete('/guilds/:guildId/tickets/:ticketId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;

            // Require admin permission for deletion
            if (!checkPermission(req.guildAccess?.permissions, 'ADMINISTRATOR')) {
                return res.status(403).json({ error: t('dashboard.errors.insufficientPermissions') });
            }

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Delete ticket messages first
            await db.runAsync('DELETE FROM ticket_messages WHERE ticket_id = ?', [ticketId]);

            // Delete the ticket
            await db.runAsync('DELETE FROM tickets WHERE id = ?', [ticketId]);

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_DELETE', { ticketId });

            res.json({ success: true, message: t('dashboard.tickets.deleted') });
        } catch (error) {
            bot.logger?.error('Error deleting ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.deleteFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/tickets/stats
     * Get ticket statistics
     */
    router.get('/guilds/:guildId/tickets/stats', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { period = '30d' } = req.query;

            // Calculate date range
            const now = new Date();
            let startDate = new Date();
            switch (period) {
                case '7d':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case '30d':
                    startDate.setDate(now.getDate() - 30);
                    break;
                case '90d':
                    startDate.setDate(now.getDate() - 90);
                    break;
                default:
                    startDate.setDate(now.getDate() - 30);
            }

            const stats = await db.getAsync(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
                    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
                FROM tickets 
                WHERE guild_id = ? AND created_at >= ?
            `, [guildId, startDate.toISOString()]);

            // Average resolution time
            const avgResolution = await db.getAsync(`
                SELECT AVG(
                    (julianday(closed_at) - julianday(created_at)) * 24 * 60
                ) as avg_minutes
                FROM tickets 
                WHERE guild_id = ? 
                AND status = 'closed' 
                AND closed_at IS NOT NULL
                AND created_at >= ?
            `, [guildId, startDate.toISOString()]);

            // Tickets by category
            const byCategory = await db.allAsync(`
                SELECT category, COUNT(*) as count
                FROM tickets
                WHERE guild_id = ? AND created_at >= ?
                GROUP BY category
                ORDER BY count DESC
            `, [guildId, startDate.toISOString()]);

            res.json({
                ...stats,
                avgResolutionMinutes: avgResolution?.avg_minutes || null,
                byCategory,
                period
            });
        } catch (error) {
            bot.logger?.error('Error fetching ticket stats:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * GET /api/guilds/:guildId/ticket-settings
     * Get ticket system settings
     */
    router.get('/guilds/:guildId/ticket-settings', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;

            const settings = await db.getAsync(
                'SELECT * FROM ticket_settings WHERE guild_id = ?',
                [guildId]
            );

            // Get ticket categories
            const categories = await db.allAsync(
                'SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY sort_order',
                [guildId]
            );

            res.json({
                settings: settings || {
                    enabled: false,
                    category_id: null,
                    support_role_id: null,
                    log_channel_id: null,
                    ticket_limit: 1,
                    auto_close_hours: null,
                    transcript_channel_id: null
                },
                categories
            });
        } catch (error) {
            bot.logger?.error('Error fetching ticket settings:', error);
            res.status(500).json({ error: t('dashboard.errors.fetchFailed') });
        }
    });

    /**
     * PUT /api/guilds/:guildId/ticket-settings
     * Update ticket system settings
     */
    router.put('/guilds/:guildId/ticket-settings', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { 
                enabled,
                category_id,
                support_role_id,
                log_channel_id,
                ticket_limit,
                auto_close_hours,
                transcript_channel_id,
                welcome_message,
                close_confirmation
            } = req.body;

            // Upsert settings
            await db.runAsync(`
                INSERT INTO ticket_settings (
                    guild_id, enabled, category_id, support_role_id, log_channel_id,
                    ticket_limit, auto_close_hours, transcript_channel_id,
                    welcome_message, close_confirmation, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET
                    enabled = excluded.enabled,
                    category_id = excluded.category_id,
                    support_role_id = excluded.support_role_id,
                    log_channel_id = excluded.log_channel_id,
                    ticket_limit = excluded.ticket_limit,
                    auto_close_hours = excluded.auto_close_hours,
                    transcript_channel_id = excluded.transcript_channel_id,
                    welcome_message = excluded.welcome_message,
                    close_confirmation = excluded.close_confirmation,
                    updated_at = excluded.updated_at
            `, [
                guildId,
                enabled ? 1 : 0,
                category_id || null,
                support_role_id || null,
                log_channel_id || null,
                ticket_limit || 1,
                auto_close_hours || null,
                transcript_channel_id || null,
                welcome_message || null,
                close_confirmation ? 1 : 0,
                new Date().toISOString()
            ]);

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_SETTINGS_UPDATE', req.body);

            res.json({ success: true, message: t('dashboard.settings.saved') });
        } catch (error) {
            bot.logger?.error('Error updating ticket settings:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/ticket-categories
     * Create a new ticket category
     */
    router.post('/guilds/:guildId/ticket-categories', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { name, description, emoji, support_roles, auto_assign } = req.body;

            if (!name) {
                return res.status(400).json({ error: t('dashboard.errors.nameRequired') });
            }

            // Get next sort order
            const lastCategory = await db.getAsync(
                'SELECT MAX(sort_order) as max_order FROM ticket_categories WHERE guild_id = ?',
                [guildId]
            );

            const result = await db.runAsync(`
                INSERT INTO ticket_categories (
                    guild_id, name, description, emoji, support_roles, auto_assign, sort_order, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                name,
                description || null,
                emoji || '🎫',
                JSON.stringify(support_roles || []),
                auto_assign || null,
                (lastCategory?.max_order || 0) + 1,
                new Date().toISOString()
            ]);

            res.json({ 
                success: true, 
                categoryId: result.lastID,
                message: t('dashboard.tickets.categoryCreated')
            });
        } catch (error) {
            bot.logger?.error('Error creating ticket category:', error);
            res.status(500).json({ error: t('dashboard.errors.createFailed') });
        }
    });

    /**
     * DELETE /api/guilds/:guildId/ticket-categories/:categoryId
     * Delete a ticket category
     */
    router.delete('/guilds/:guildId/ticket-categories/:categoryId', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, categoryId } = req.params;

            await db.runAsync(
                'DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?',
                [categoryId, guildId]
            );

            res.json({ success: true, message: t('dashboard.tickets.categoryDeleted') });
        } catch (error) {
            bot.logger?.error('Error deleting ticket category:', error);
            res.status(500).json({ error: t('dashboard.errors.deleteFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/message
     * Send a DM to the ticket creator
     */
    router.post('/guilds/:guildId/tickets/:ticketId/message', authMiddleware, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { message } = req.body;

            if (!message || message.trim().length === 0) {
                return res.status(400).json({ error: 'Message is required' });
            }

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Try to DM the user
            try {
                const user = await bot.users.fetch(ticket.user_id);
                const guild = bot.guilds.cache.get(guildId);
                
                await user.send({
                    embeds: [{
                        title: `📩 Message from ${guild?.name || 'Server'} Support`,
                        description: message,
                        color: 0x5865F2,
                        fields: [
                            { name: 'Ticket', value: `#${ticket.id}`, inline: true },
                            { name: 'Subject', value: ticket.subject || 'N/A', inline: true }
                        ],
                        footer: { text: `Sent by staff member` },
                        timestamp: new Date().toISOString()
                    }]
                });

                // Log the message in ticket_messages
                await db.runAsync(`
                    INSERT INTO ticket_messages (ticket_id, user_id, content, is_staff, created_at)
                    VALUES (?, ?, ?, 1, ?)
                `, [ticketId, req.user.userId, message, new Date().toISOString()]);

                // Log the action
                await dashboard.logAction(guildId, req.user.userId, 'TICKET_DM_SENT', {
                    ticketId,
                    userId: ticket.user_id
                });

                res.json({ success: true, message: 'DM sent successfully' });
            } catch (dmError) {
                bot.logger?.warn('Failed to DM ticket user:', dmError.message);
                res.status(400).json({ error: 'Could not send DM - user may have DMs disabled' });
            }
        } catch (error) {
            bot.logger?.error('Error sending ticket message:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/assign
     * Assign a ticket to a staff member
     */
    router.post('/guilds/:guildId/tickets/:ticketId/assign', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { assigneeId } = req.body;

            const ticket = await db.getAsync(
                'SELECT * FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            await db.runAsync(
                `UPDATE tickets SET assignee_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?`,
                [assigneeId || req.user.userId, new Date().toISOString(), ticketId]
            );

            // Log the action
            await dashboard.logAction(guildId, req.user.userId, 'TICKET_ASSIGNED', {
                ticketId,
                assigneeId: assigneeId || req.user.userId
            });

            res.json({ success: true, message: 'Ticket assigned successfully' });
        } catch (error) {
            bot.logger?.error('Error assigning ticket:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/priority
     * Set ticket priority
     */
    router.post('/guilds/:guildId/tickets/:ticketId/priority', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { priority } = req.body;

            if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
                return res.status(400).json({ error: 'Invalid priority level' });
            }

            await db.runAsync(
                `UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ? AND guild_id = ?`,
                [priority, new Date().toISOString(), ticketId, guildId]
            );

            res.json({ success: true, message: 'Priority updated' });
        } catch (error) {
            bot.logger?.error('Error updating priority:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    /**
     * POST /api/guilds/:guildId/tickets/:ticketId/note
     * Add internal note to ticket
     */
    router.post('/guilds/:guildId/tickets/:ticketId/note', authMiddleware, validateCSRF, requireGuildAccess, async (req, res) => {
        try {
            const { guildId, ticketId } = req.params;
            const { note } = req.body;

            if (!note || note.trim().length === 0) {
                return res.status(400).json({ error: 'Note is required' });
            }

            const ticket = await db.getAsync(
                'SELECT notes FROM tickets WHERE id = ? AND guild_id = ?',
                [ticketId, guildId]
            );

            if (!ticket) {
                return res.status(404).json({ error: t('dashboard.errors.notFound') });
            }

            // Append note with timestamp
            const existingNotes = ticket.notes ? JSON.parse(ticket.notes) : [];
            existingNotes.push({
                author: req.user.userId,
                authorName: req.user.username,
                content: note,
                timestamp: new Date().toISOString()
            });

            await db.runAsync(
                `UPDATE tickets SET notes = ?, updated_at = ? WHERE id = ? AND guild_id = ?`,
                [JSON.stringify(existingNotes), new Date().toISOString(), ticketId, guildId]
            );

            res.json({ success: true, message: 'Note added' });
        } catch (error) {
            bot.logger?.error('Error adding note:', error);
            res.status(500).json({ error: t('dashboard.errors.updateFailed') });
        }
    });

    return router;
};
