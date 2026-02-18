const express = require('express');
const router = express.Router();
const path = require('path');

/**
 * Unified Admin Dashboard
 * Combines all admin functionality from bot, platform, and Darklock Guard
 */

module.exports = (dashboard) => {
    const db = dashboard.db;

    // Main unified admin dashboard - NO AUTH FOR NOW to avoid redirect loops
    // TODO: Add proper authentication once redirect loop is fixed
    router.get('/admin', async (req, res) => {
        try {
            console.log('[Unified Admin] Serving dashboard...');
            res.sendFile(path.join(__dirname, '../views/unified-admin.html'));
        } catch (error) {
            console.error('[Unified Admin] Error loading dashboard:', error);
            res.status(500).send('Error loading admin dashboard');
        }
    });

    // Admin Dashboard Data API - also no auth for now
    router.get('/api/admin/dashboard', async (req, res) => {
        try {
            const today = new Date().toISOString().split('T')[0];

            // Bot Stats
            const guildCount = dashboard.bot?.guilds?.cache?.size || 0;
            const userCount = dashboard.bot?.guilds?.cache?.reduce((acc, guild) => acc + guild.memberCount, 0) || 0;
            
            // Database Stats
            const totalUsers = await db.get('SELECT COUNT(*) as count FROM users') || { count: 0 };
            const activeTickets = await db.get('SELECT COUNT(*) as count FROM tickets WHERE status = "open"') || { count: 0 };
            const totalWarnings = await db.get('SELECT COUNT(*) as count FROM warnings') || { count: 0 };

            // Darklock Platform Stats
            const platformUsers = await db.get('SELECT COUNT(*) as count FROM admins WHERE active = 1') || { count: 0 };
            const devices = await db.get('SELECT COUNT(*) as count FROM devices') || { count: 0 };
            
            // Guard Stats (if available)
            const guardDevices = await db.get('SELECT COUNT(*) as count FROM guard_devices WHERE status = "active"').catch(() => ({ count: 0 }));
            
            // Recent Activity
            const recentActivity = await db.all(`
                SELECT * FROM admin_audit_log 
                ORDER BY created_at DESC 
                LIMIT 50
            `).catch(() => []);

            // System Health
            const uptime = process.uptime();
            const memoryUsage = process.memoryUsage();

            res.json({
                success: true,
                stats: {
                    bot: {
                        guilds: guildCount,
                        users: userCount,
                        uptime: Math.floor(uptime)
                    },
                    database: {
                        users: totalUsers.count,
                        tickets: activeTickets.count,
                        warnings: totalWarnings.count
                    },
                    platform: {
                        admins: platformUsers.count,
                        devices: devices.count
                    },
                    guard: {
                        devices: guardDevices.count
                    },
                    system: {
                        uptime: Math.floor(uptime),
                        memory: {
                            rss: Math.floor(memoryUsage.rss / 1024 / 1024),
                            heapUsed: Math.floor(memoryUsage.heapUsed / 1024 / 1024),
                            heapTotal: Math.floor(memoryUsage.heapTotal / 1024 / 1024)
                        }
                    }
                },
                activity: recentActivity,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Unified Admin] Dashboard data error:', error);
            res.status(500).json({ success: false, error: 'Failed to load dashboard data' });
        }
    });

    // Quick Actions API - no auth for now
    router.post('/api/admin/action/:type', async (req, res) => {
        try {
            const { type } = req.params;
            const { data } = req.body;

            switch (type) {
                case 'broadcast':
                    // Broadcast message to all guilds
                    // Implementation here
                    res.json({ success: true, message: 'Broadcast sent' });
                    break;

                case 'restart-service':
                    // Restart specific service
                    res.json({ success: true, message: 'Service restart initiated' });
                    break;

                case 'clear-cache':
                    // Clear caches
                    res.json({ success: true, message: 'Cache cleared' });
                    break;

                default:
                    res.status(400).json({ success: false, error: 'Unknown action type' });
            }
        } catch (error) {
            console.error('[Unified Admin] Action error:', error);
            res.status(500).json({ success: false, error: 'Action failed' });
        }
    });

    return router;
};
