const crypto = require('crypto');

class HelpTicketSystem {
    constructor(database, logger) {
        this.database = database;
        this.logger = logger;
        this.initializeTables();
    }

    async initializeTables() {
        try {
            // Create help_tickets table
            await this.database.run(`
                CREATE TABLE IF NOT EXISTS help_tickets (
                    id TEXT PRIMARY KEY,
                    ticket_id TEXT UNIQUE NOT NULL,
                    user_id TEXT NOT NULL,
                    guild_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    description TEXT NOT NULL,
                    status TEXT DEFAULT 'open',
                    priority TEXT DEFAULT 'normal',
                    assigned_to TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    resolved_at DATETIME,
                    response TEXT
                )
            `);

            // Create help_ticket_messages table for tracking ticket messages
            await this.database.run(`
                CREATE TABLE IF NOT EXISTS help_ticket_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticket_id TEXT NOT NULL,
                    message_id TEXT,
                    user_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    is_admin INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(ticket_id) REFERENCES help_tickets(ticket_id)
                )
            `);

            this.logger?.info('Γ£à Help Ticket System tables initialized');
        } catch (error) {
            this.logger?.error('Failed to initialize help ticket tables:', error);
        }
    }

    async createTicket(userId, guildId, category, subject, description, priority = 'normal') {
        try {
            const ticketId = this.generateTicketId();
            const id = crypto.randomUUID();

            await this.database.run(
                `INSERT INTO help_tickets (id, ticket_id, user_id, guild_id, category, subject, description, priority)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, ticketId, userId, guildId, category, subject, description, priority]
            );

            this.logger?.info(`Help ticket created: ${ticketId}`);
            return { id, ticketId };
        } catch (error) {
            this.logger?.error('Failed to create help ticket:', error);
            return null;
        }
    }

    async getTicket(ticketId) {
        try {
            return await this.database.get(
                `SELECT * FROM help_tickets WHERE ticket_id = ?`,
                [ticketId]
            );
        } catch (error) {
            this.logger?.error('Failed to get ticket:', error);
            return null;
        }
    }

    async getTicketsByStatus(status, limit = 50) {
        try {
            return await this.database.all(
                `SELECT * FROM help_tickets WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
                [status, limit]
            );
        } catch (error) {
            this.logger?.error('Failed to get tickets by status:', error);
            return [];
        }
    }

    async getTicketsByCategory(category, limit = 50) {
        try {
            return await this.database.all(
                `SELECT * FROM help_tickets WHERE category = ? ORDER BY created_at DESC LIMIT ?`,
                [category, limit]
            );
        } catch (error) {
            this.logger?.error('Failed to get tickets by category:', error);
            return [];
        }
    }

    async getAllTickets(limit = 100) {
        try {
            return await this.database.all(
                `SELECT * FROM help_tickets ORDER BY created_at DESC LIMIT ?`,
                [limit]
            );
        } catch (error) {
            this.logger?.error('Failed to get all tickets:', error);
            return [];
        }
    }

    async updateTicketStatus(ticketId, status, response = null) {
        try {
            const query = response
                ? `UPDATE help_tickets SET status = ?, response = ?, updated_at = CURRENT_TIMESTAMP, resolved_at = CURRENT_TIMESTAMP WHERE ticket_id = ?`
                : `UPDATE help_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = ?`;

            const params = response ? [status, response, ticketId] : [status, ticketId];
            await this.database.run(query, params);

            this.logger?.info(`Ticket ${ticketId} status updated to ${status}`);
            return true;
        } catch (error) {
            this.logger?.error('Failed to update ticket status:', error);
            return false;
        }
    }

    async assignTicket(ticketId, adminId) {
        try {
            await this.database.run(
                `UPDATE help_tickets SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = ?`,
                [adminId, ticketId]
            );
            this.logger?.info(`Ticket ${ticketId} assigned to ${adminId}`);
            return true;
        } catch (error) {
            this.logger?.error('Failed to assign ticket:', error);
            return false;
        }
    }

    async addTicketMessage(ticketId, userId, content, isAdmin = false) {
        try {
            await this.database.run(
                `INSERT INTO help_ticket_messages (ticket_id, user_id, content, is_admin)
                 VALUES (?, ?, ?, ?)`,
                [ticketId, userId, content, isAdmin ? 1 : 0]
            );
            return true;
        } catch (error) {
            this.logger?.error('Failed to add ticket message:', error);
            return false;
        }
    }

    async getTicketMessages(ticketId) {
        try {
            return await this.database.all(
                `SELECT * FROM help_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
                [ticketId]
            );
        } catch (error) {
            this.logger?.error('Failed to get ticket messages:', error);
            return [];
        }
    }

    async getTicketsByUser(userId, limit = 50) {
        try {
            return await this.database.all(
                `SELECT * FROM help_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
                [userId, limit]
            );
        } catch (error) {
            this.logger?.error('Failed to get user tickets:', error);
            return [];
        }
    }

    async getTicketStats(guildId) {
        try {
            const stats = await this.database.get(
                `SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
                    SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
                    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
                    SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
                 FROM help_tickets WHERE guild_id = ?`,
                [guildId]
            );
            return stats || { total: 0, open_count: 0, in_progress_count: 0, resolved_count: 0, closed_count: 0 };
        } catch (error) {
            this.logger?.error('Failed to get ticket stats:', error);
            return { total: 0, open_count: 0, in_progress_count: 0, resolved_count: 0, closed_count: 0 };
        }
    }

    async updateTicketPriority(ticketId, priority) {
        try {
            await this.database.run(
                `UPDATE help_tickets SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = ?`,
                [priority, ticketId]
            );
            this.logger?.info(`Ticket ${ticketId} priority updated to ${priority}`);
            return true;
        } catch (error) {
            this.logger?.error('Failed to update ticket priority:', error);
            return false;
        }
    }

    async addTicketNote(ticketId, adminId, note) {
        try {
            // Store notes as special admin messages
            await this.database.run(
                `INSERT INTO help_ticket_messages (ticket_id, user_id, content, is_admin)
                 VALUES (?, ?, ?, 2)`,
                [ticketId, adminId, `[INTERNAL NOTE] ${note}`]
            );
            this.logger?.info(`Note added to ticket ${ticketId}`);
            return true;
        } catch (error) {
            this.logger?.error('Failed to add ticket note:', error);
            return false;
        }
    }

    async deleteTicket(ticketId) {
        try {
            // Delete messages first
            await this.database.run(
                `DELETE FROM help_ticket_messages WHERE ticket_id = ?`,
                [ticketId]
            );
            // Delete ticket
            await this.database.run(
                `DELETE FROM help_tickets WHERE ticket_id = ?`,
                [ticketId]
            );
            this.logger?.info(`Ticket ${ticketId} deleted`);
            return true;
        } catch (error) {
            this.logger?.error('Failed to delete ticket:', error);
            return false;
        }
    }

    generateTicketId() {
        // Format: HELP-XXXXXX-YYYYMMDD
        const timestamp = new Date().toISOString().replace(/-/g, '').slice(0, 8);
        const random = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `HELP-${random}-${timestamp}`;
    }

    getCategoryEmoji(category) {
        const emojis = {
            'bug_report': '≡ƒÉ¢',
            'feature_request': '≡ƒÆí',
            'account_issue': '≡ƒæñ',
            'moderation_help': '≡ƒö¿',
            'security_help': '≡ƒ¢í∩╕Å',
            'general_question': 'Γ¥ô'
        };
        return emojis[category] || '≡ƒô¥';
    }

    getCategoryLabel(category) {
        const labels = {
            'bug_report': 'Bug Report',
            'feature_request': 'Feature Request',
            'account_issue': 'Account Issue',
            'moderation_help': 'Moderation Help',
            'security_help': 'Security Help',
            'general_question': 'General Question'
        };
        return labels[category] || 'Support';
    }
}

module.exports = HelpTicketSystem;
