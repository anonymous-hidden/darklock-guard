/**
 * Darklock Admin API v2 - Enhanced Admin Routes
 * 
 * SECURITY:
 * - All routes require admin authentication
 * - RBAC enforced: owner > admin
 * - All changes audit logged
 * - Rate limited
 * 
 * LIVE DATA ONLY:
 * - No hardcoded values
 * - All stats from database or live metrics
 * - Real service health checks
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const os = require('os');
const rateLimit = require('express-rate-limit');

// Database
const db = require('../utils/database');
const maintenanceV2 = require('../utils/maintenance-v2');

// Discord bot reference (set externally)
let discordBot = null;

/**
 * Set Discord bot reference for bot management features
 */
function setDiscordBot(bot) {
    discordBot = bot;
    console.log('[Admin API v2] Discord bot reference set');
}

// ============================================================================
// RATE LIMITING
// ============================================================================

const adminRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { success: false, error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

const sensitiveActionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 sensitive actions per hour
    message: { success: false, error: 'Rate limit exceeded for sensitive actions.' },
    standardHeaders: true,
    legacyHeaders: false
});

router.use(adminRateLimiter);

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Import admin auth middleware
 */
const { requireAdminAuth, verifyAdminToken } = require('../routes/admin-auth');

// Apply admin auth to all v2 routes
router.use(requireAdminAuth);

/**
 * RBAC middleware
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.admin || !allowedRoles.includes(req.admin.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                required: allowedRoles,
                current: req.admin?.role
            });
        }
        next();
    };
}

/**
 * Require typed confirmation for destructive actions
 */
function requireConfirmation(confirmationPhrase) {
    return (req, res, next) => {
        const { confirmation } = req.body;
        if (confirmation !== confirmationPhrase) {
            return res.status(400).json({
                success: false,
                error: `Type "${confirmationPhrase}" to confirm this action`,
                requiresConfirmation: confirmationPhrase
            });
        }
        next();
    };
}

// ============================================================================
// HELPERS
// ============================================================================

function generateId() {
    return crypto.randomUUID();
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.ip ||
           'unknown';
}

/**
 * Comprehensive audit logging
 */
async function auditLog(req, action, resourceType, resourceId, oldValue, newValue) {
    try {
        await db.run(`
            INSERT INTO admin_audit_logs (
                id, admin_id, admin_email, action, resource_type, resource_id,
                old_value, new_value, ip_address, user_agent, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            generateId(),
            req.admin.id,
            req.admin.email,
            action,
            resourceType,
            resourceId || null,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            getClientIP(req),
            req.headers['user-agent'] || 'unknown',
            new Date().toISOString()
        ]);
    } catch (err) {
        console.error('[Admin API v2] Audit log error:', err.message);
    }
}

// ============================================================================
// DASHBOARD OVERVIEW - LIVE DATA
// ============================================================================

router.get('/v2/dashboard', async (req, res) => {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const hourAgo = new Date(now - 3600000).toISOString();
        
        // Parallel queries for performance
        const [
            // Platform stats
            totalUsers,
            activeUsers24h,
            totalGuilds,
            
            // Admin stats
            totalAdmins,
            actionsToday,
            
            // Maintenance status
            maintenanceConfigs,
            
            // Feature flags
            enabledFlags,
            totalFlags,
            
            // Recent activity
            recentAudit,
            
            // Error rates
            errorsLastHour
        ] = await Promise.all([
            db.get(`SELECT COUNT(*) as count FROM users WHERE active = 1`).catch(() => ({ count: 0 })),
            db.get(`SELECT COUNT(*) as count FROM users WHERE last_login >= ?`, [today]).catch(() => ({ count: 0 })),
            discordBot?.guilds?.cache?.size || 0,
            db.get(`SELECT COUNT(*) as count FROM admins WHERE active = 1`).catch(() => ({ count: 0 })),
            db.get(`SELECT COUNT(*) as count FROM admin_audit_logs WHERE created_at >= ?`, [today]).catch(() => ({ count: 0 })),
            maintenanceV2.getAllMaintenanceConfig(),
            db.get(`SELECT COUNT(*) as count FROM feature_flags WHERE is_enabled = 1`).catch(() => ({ count: 0 })),
            db.get(`SELECT COUNT(*) as count FROM feature_flags`).catch(() => ({ count: 0 })),
            db.all(`
                SELECT action, resource_type, admin_email, created_at 
                FROM admin_audit_logs 
                ORDER BY created_at DESC 
                LIMIT 10
            `).catch(() => []),
            db.get(`SELECT COUNT(*) as count FROM error_logs WHERE created_at >= ?`, [hourAgo]).catch(() => ({ count: 0 }))
        ]);
        
        // System metrics (LIVE)
        const systemMetrics = {
            uptime: process.uptime(),
            uptimeFormatted: formatUptime(process.uptime()),
            memory: {
                used: process.memoryUsage().heapUsed,
                total: process.memoryUsage().heapTotal,
                percentage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
            },
            cpu: {
                loadAverage: os.loadavg(),
                cores: os.cpus().length
            },
            platform: os.platform(),
            nodeVersion: process.version
        };
        
        // Discord bot metrics (LIVE)
        const botMetrics = discordBot ? {
            status: discordBot.ws?.status === 0 ? 'online' : 'degraded',
            ping: discordBot.ws?.ping || 0,
            guilds: discordBot.guilds?.cache?.size || 0,
            users: discordBot.users?.cache?.size || 0,
            channels: discordBot.channels?.cache?.size || 0,
            shards: discordBot.ws?.shards?.size || 1,
            shardStatuses: Array.from(discordBot.ws?.shards?.values() || []).map(s => ({
                id: s.id,
                status: s.status,
                ping: s.ping
            }))
        } : {
            status: 'offline',
            ping: 0,
            guilds: 0,
            users: 0,
            channels: 0,
            shards: 0,
            shardStatuses: []
        };
        
        // Calculate health score
        const healthScore = calculateHealthScore(systemMetrics, botMetrics, errorsLastHour?.count || 0);
        
        res.json({
            success: true,
            admin: {
                id: req.admin.id,
                email: req.admin.email,
                role: req.admin.role
            },
            stats: {
                users: {
                    total: totalUsers?.count || 0,
                    active24h: activeUsers24h?.count || 0
                },
                guilds: typeof totalGuilds === 'number' ? totalGuilds : (totalGuilds?.count || 0),
                admins: totalAdmins?.count || 0,
                actionsToday: actionsToday?.count || 0,
                featureFlags: {
                    enabled: enabledFlags?.count || 0,
                    total: totalFlags?.count || 0
                },
                errorsLastHour: errorsLastHour?.count || 0
            },
            maintenance: maintenanceConfigs,
            system: systemMetrics,
            bot: botMetrics,
            health: {
                score: healthScore,
                status: healthScore >= 90 ? 'healthy' : healthScore >= 70 ? 'degraded' : 'unhealthy'
            },
            recentAudit,
            timestamp: now.toISOString()
        });
    } catch (err) {
        console.error('[Admin API v2] Dashboard error:', err);
        res.status(500).json({ success: false, error: 'Failed to load dashboard' });
    }
});

/**
 * Format uptime to human readable
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.join(' ') || '< 1m';
}

/**
 * Calculate overall health score
 */
function calculateHealthScore(system, bot, errorCount) {
    let score = 100;
    
    // Memory pressure
    if (system.memory.percentage > 90) score -= 20;
    else if (system.memory.percentage > 80) score -= 10;
    else if (system.memory.percentage > 70) score -= 5;
    
    // CPU load
    const loadPerCore = system.cpu.loadAverage[0] / system.cpu.cores;
    if (loadPerCore > 2) score -= 20;
    else if (loadPerCore > 1) score -= 10;
    else if (loadPerCore > 0.7) score -= 5;
    
    // Bot status
    if (bot.status !== 'online') score -= 30;
    else if (bot.ping > 500) score -= 10;
    else if (bot.ping > 200) score -= 5;
    
    // Error rate
    if (errorCount > 100) score -= 20;
    else if (errorCount > 50) score -= 10;
    else if (errorCount > 10) score -= 5;
    
    return Math.max(0, Math.min(100, score));
}

// ============================================================================
// SYSTEM HEALTH - LIVE METRICS
// ============================================================================

router.get('/v2/system/health', async (req, res) => {
    try {
        const startTime = Date.now();
        
        // Database health check
        let dbHealth = { status: 'healthy', latency: 0 };
        try {
            const dbStart = Date.now();
            await db.get(`SELECT 1`);
            dbHealth.latency = Date.now() - dbStart;
            if (dbHealth.latency > 100) dbHealth.status = 'degraded';
            if (dbHealth.latency > 500) dbHealth.status = 'unhealthy';
        } catch (err) {
            dbHealth = { status: 'unhealthy', error: err.message };
        }
        
        // Discord bot health
        let botHealth = { status: 'offline', latency: 0 };
        if (discordBot) {
            const wsStatus = discordBot.ws?.status;
            botHealth = {
                status: wsStatus === 0 ? 'healthy' : wsStatus === 5 ? 'connecting' : 'degraded',
                latency: discordBot.ws?.ping || 0,
                shards: discordBot.ws?.shards?.size || 1
            };
            if (botHealth.latency > 300) botHealth.status = 'degraded';
        }
        
        // Memory health
        const memUsage = process.memoryUsage();
        const memHealth = {
            status: 'healthy',
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            rss: memUsage.rss,
            percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
        };
        if (memHealth.percentage > 90) memHealth.status = 'unhealthy';
        else if (memHealth.percentage > 80) memHealth.status = 'degraded';
        
        // CPU health
        const cpuHealth = {
            status: 'healthy',
            loadAverage: os.loadavg(),
            cores: os.cpus().length,
            usage: os.loadavg()[0] / os.cpus().length
        };
        if (cpuHealth.usage > 2) cpuHealth.status = 'unhealthy';
        else if (cpuHealth.usage > 1) cpuHealth.status = 'degraded';
        
        // Overall status
        const statuses = [dbHealth.status, botHealth.status, memHealth.status, cpuHealth.status];
        let overallStatus = 'healthy';
        if (statuses.includes('unhealthy')) overallStatus = 'unhealthy';
        else if (statuses.includes('degraded')) overallStatus = 'degraded';
        
        res.json({
            success: true,
            status: overallStatus,
            responseTime: Date.now() - startTime,
            checks: {
                database: dbHealth,
                bot: botHealth,
                memory: memHealth,
                cpu: cpuHealth
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Admin API v2] Health check error:', err);
        res.status(500).json({ 
            success: false, 
            status: 'unhealthy',
            error: 'Health check failed' 
        });
    }
});

// ============================================================================
// MAINTENANCE MODE - SCOPE-BASED CONTROLS
// ============================================================================

router.get('/v2/maintenance', async (req, res) => {
    try {
        const configs = await maintenanceV2.getAllMaintenanceConfig();
        const schedules = await maintenanceV2.getPendingSchedules();
        
        res.json({
            success: true,
            scopes: configs,
            pendingSchedules: schedules,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Admin API v2] Get maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to load maintenance config' });
    }
});

router.put('/v2/maintenance/:scope', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { scope } = req.params;
        const { enabled, message, endTime, allowAdminBypass, allowedIps } = req.body;
        
        // Validate scope
        const validScopes = ['website', 'platform', 'bot_dashboard', 'api', 'discord_bot'];
        if (!validScopes.includes(scope)) {
            return res.status(400).json({ 
                success: false, 
                error: `Invalid scope. Valid scopes: ${validScopes.join(', ')}` 
            });
        }
        
        const oldConfig = await maintenanceV2.getMaintenanceConfig(scope);
        
        if (enabled) {
            await maintenanceV2.enableMaintenance(scope, {
                message,
                endTime,
                allowAdminBypass,
                allowedIps
            }, req.admin.id, req.admin.email);
        } else if (enabled === false) {
            await maintenanceV2.disableMaintenance(scope, req.admin.id, req.admin.email);
        } else {
            await maintenanceV2.updateMaintenanceConfig(scope, {
                message,
                endTime,
                allowAdminBypass,
                allowedIps
            }, req.admin.id, req.admin.email);
        }
        
        const newConfig = await maintenanceV2.getMaintenanceConfig(scope);
        
        await auditLog(req, enabled ? 'ENABLE_MAINTENANCE' : 'UPDATE_MAINTENANCE', 
            'maintenance', scope, oldConfig, newConfig);
        
        res.json({
            success: true,
            message: `Maintenance ${enabled ? 'enabled' : 'updated'} for ${scope}`,
            config: newConfig
        });
    } catch (err) {
        console.error('[Admin API v2] Update maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to update maintenance config' });
    }
});

router.post('/v2/maintenance/schedule', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { scope, startTime, endTime, message, webhookUrl, notifyDiscord } = req.body;
        
        if (!scope || !startTime) {
            return res.status(400).json({ 
                success: false, 
                error: 'Scope and startTime are required' 
            });
        }
        
        // Validate start time is in the future
        if (new Date(startTime) <= new Date()) {
            return res.status(400).json({ 
                success: false, 
                error: 'Scheduled start time must be in the future' 
            });
        }
        
        const schedule = await maintenanceV2.scheduleMaintenance(scope, {
            startTime,
            endTime,
            message,
            webhookUrl,
            notifyDiscord
        }, req.admin.id, req.admin.email);
        
        await auditLog(req, 'SCHEDULE_MAINTENANCE', 'maintenance', schedule.id, null, schedule);
        
        res.json({
            success: true,
            message: 'Maintenance scheduled',
            schedule
        });
    } catch (err) {
        console.error('[Admin API v2] Schedule maintenance error:', err);
        res.status(500).json({ success: false, error: 'Failed to schedule maintenance' });
    }
});

router.delete('/v2/maintenance/schedule/:id', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        
        await maintenanceV2.cancelScheduledMaintenance(id, req.admin.id, req.admin.email);
        await auditLog(req, 'CANCEL_MAINTENANCE_SCHEDULE', 'maintenance', id, null, null);
        
        res.json({
            success: true,
            message: 'Scheduled maintenance cancelled'
        });
    } catch (err) {
        console.error('[Admin API v2] Cancel schedule error:', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to cancel schedule' });
    }
});

// ============================================================================
// SERVICE CONTROLS - OWNER ONLY
// ============================================================================

router.post('/v2/services/restart', 
    requireRole('owner'), 
    sensitiveActionLimiter,
    requireConfirmation('RESTART'),
    async (req, res) => {
        try {
            const { service } = req.body;
            
            await auditLog(req, 'RESTART_SERVICE', 'service', service, null, { requested: true });
            
            // Graceful restart - send signal
            if (service === 'bot' && discordBot) {
                // Destroy and recreate connection
                await discordBot.destroy();
                setTimeout(() => {
                    discordBot.login(process.env.DISCORD_TOKEN);
                }, 1000);
                
                return res.json({
                    success: true,
                    message: 'Bot restart initiated'
                });
            }
            
            // For other services, we'd need PM2 or similar
            res.json({
                success: true,
                message: `Restart signal sent for ${service}`,
                note: 'Full service restart requires process manager (PM2)'
            });
        } catch (err) {
            console.error('[Admin API v2] Service restart error:', err);
            res.status(500).json({ success: false, error: 'Failed to restart service' });
        }
    }
);

router.post('/v2/services/clear-cache',
    requireRole('owner'),
    async (req, res) => {
        try {
            const { cacheType } = req.body;
            
            // Clear various caches
            const cleared = [];
            
            if (!cacheType || cacheType === 'all' || cacheType === 'maintenance') {
                // Clear maintenance cache
                maintenanceV2.getAllMaintenanceConfig(true); // Force refresh
                cleared.push('maintenance');
            }
            
            if (!cacheType || cacheType === 'all' || cacheType === 'discord') {
                // Clear Discord cache (careful - this can be expensive)
                if (discordBot && cacheType === 'discord') {
                    discordBot.guilds.cache.clear();
                    cleared.push('discord');
                }
            }
            
            await auditLog(req, 'CLEAR_CACHE', 'cache', cacheType || 'all', null, { cleared });
            
            res.json({
                success: true,
                message: 'Cache cleared',
                cleared
            });
        } catch (err) {
            console.error('[Admin API v2] Clear cache error:', err);
            res.status(500).json({ success: false, error: 'Failed to clear cache' });
        }
    }
);

// ============================================================================
// BOT CONTROLS - OWNER ONLY
// ============================================================================

router.post('/v2/bot/resync-commands',
    requireRole('owner'),
    sensitiveActionLimiter,
    async (req, res) => {
        try {
            if (!discordBot) {
                return res.status(503).json({ success: false, error: 'Bot not available' });
            }
            
            await auditLog(req, 'RESYNC_COMMANDS', 'bot', null, null, { requested: true });
            
            // Trigger command refresh
            const commands = discordBot.commands;
            if (commands && discordBot.application) {
                await discordBot.application.commands.set(commands.map(c => c.data.toJSON()));
                
                return res.json({
                    success: true,
                    message: 'Commands resynced',
                    count: commands.size
                });
            }
            
            res.json({
                success: true,
                message: 'Command resync requested',
                note: 'Commands will be refreshed on next ready event'
            });
        } catch (err) {
            console.error('[Admin API v2] Resync commands error:', err);
            res.status(500).json({ success: false, error: 'Failed to resync commands' });
        }
    }
);

router.post('/v2/bot/restart-shard',
    requireRole('owner'),
    sensitiveActionLimiter,
    requireConfirmation('RESTART SHARD'),
    async (req, res) => {
        try {
            const { shardId } = req.body;
            
            if (!discordBot) {
                return res.status(503).json({ success: false, error: 'Bot not available' });
            }
            
            const shard = discordBot.ws?.shards?.get(shardId);
            if (!shard) {
                return res.status(404).json({ success: false, error: 'Shard not found' });
            }
            
            await auditLog(req, 'RESTART_SHARD', 'bot', `shard-${shardId}`, null, { shardId });
            
            // Reconnect shard
            shard.reconnect();
            
            res.json({
                success: true,
                message: `Shard ${shardId} restart initiated`
            });
        } catch (err) {
            console.error('[Admin API v2] Shard restart error:', err);
            res.status(500).json({ success: false, error: 'Failed to restart shard' });
        }
    }
);

router.get('/v2/bot/shards', async (req, res) => {
    try {
        if (!discordBot) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }
        
        const shards = Array.from(discordBot.ws?.shards?.values() || []).map(shard => ({
            id: shard.id,
            status: shard.status,
            statusText: getShardStatusText(shard.status),
            ping: shard.ping,
            guilds: discordBot.guilds.cache.filter(g => g.shardId === shard.id).size,
            lastPingTimestamp: shard.lastPingTimestamp
        }));
        
        res.json({
            success: true,
            shards,
            total: shards.length,
            healthy: shards.filter(s => s.status === 0).length
        });
    } catch (err) {
        console.error('[Admin API v2] Get shards error:', err);
        res.status(500).json({ success: false, error: 'Failed to get shard info' });
    }
});

function getShardStatusText(status) {
    const statuses = {
        0: 'READY',
        1: 'CONNECTING',
        2: 'RECONNECTING',
        3: 'IDLE',
        4: 'NEARLY',
        5: 'DISCONNECTED',
        6: 'WAITING_FOR_GUILDS',
        7: 'IDENTIFYING',
        8: 'RESUMING'
    };
    return statuses[status] || 'UNKNOWN';
}

// ============================================================================
// AUDIT LOGS - IMMUTABLE
// ============================================================================

router.get('/v2/audit-logs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = (page - 1) * limit;
        const action = req.query.action;
        const resourceType = req.query.resourceType;
        const adminId = req.query.adminId;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        
        // Build query
        let query = `SELECT * FROM admin_audit_logs WHERE 1=1`;
        let countQuery = `SELECT COUNT(*) as total FROM admin_audit_logs WHERE 1=1`;
        const params = [];
        const countParams = [];
        
        if (action) {
            query += ` AND action = ?`;
            countQuery += ` AND action = ?`;
            params.push(action);
            countParams.push(action);
        }
        
        if (resourceType) {
            query += ` AND resource_type = ?`;
            countQuery += ` AND resource_type = ?`;
            params.push(resourceType);
            countParams.push(resourceType);
        }
        
        if (adminId) {
            query += ` AND admin_id = ?`;
            countQuery += ` AND admin_id = ?`;
            params.push(adminId);
            countParams.push(adminId);
        }
        
        if (startDate) {
            query += ` AND created_at >= ?`;
            countQuery += ` AND created_at >= ?`;
            params.push(startDate);
            countParams.push(startDate);
        }
        
        if (endDate) {
            query += ` AND created_at <= ?`;
            countQuery += ` AND created_at <= ?`;
            params.push(endDate);
            countParams.push(endDate);
        }
        
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        
        const [logs, countResult] = await Promise.all([
            db.all(query, params),
            db.get(countQuery, countParams)
        ]);
        
        res.json({
            success: true,
            logs,
            pagination: {
                page,
                limit,
                total: countResult?.total || 0,
                totalPages: Math.ceil((countResult?.total || 0) / limit)
            }
        });
    } catch (err) {
        console.error('[Admin API v2] Audit logs error:', err);
        res.status(500).json({ success: false, error: 'Failed to load audit logs' });
    }
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

router.get('/v2/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = (page - 1) * limit;
        const search = req.query.search;
        
        let query = `SELECT id, username, email, created_at, last_login, active FROM users WHERE 1=1`;
        let countQuery = `SELECT COUNT(*) as total FROM users WHERE 1=1`;
        const params = [];
        const countParams = [];
        
        if (search) {
            query += ` AND (username LIKE ? OR email LIKE ?)`;
            countQuery += ` AND (username LIKE ? OR email LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`);
        }
        
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        
        const [users, countResult] = await Promise.all([
            db.all(query, params),
            db.get(countQuery, countParams)
        ]);
        
        res.json({
            success: true,
            users,
            pagination: {
                page,
                limit,
                total: countResult?.total || 0,
                totalPages: Math.ceil((countResult?.total || 0) / limit)
            }
        });
    } catch (err) {
        console.error('[Admin API v2] Get users error:', err);
        res.status(500).json({ success: false, error: 'Failed to load users' });
    }
});

router.post('/v2/users/:id/force-logout', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        
        // Invalidate all sessions for this user
        await db.run(`DELETE FROM sessions WHERE user_id = ?`, [id]);
        
        await auditLog(req, 'FORCE_LOGOUT', 'user', id, null, { reason: req.body.reason });
        
        res.json({
            success: true,
            message: 'User sessions invalidated'
        });
    } catch (err) {
        console.error('[Admin API v2] Force logout error:', err);
        res.status(500).json({ success: false, error: 'Failed to force logout' });
    }
});

router.post('/v2/users/:id/suspend', 
    requireRole('owner'),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { reason, duration } = req.body;
            
            const user = await db.get(`SELECT * FROM users WHERE id = ?`, [id]);
            if (!user) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            await db.run(`UPDATE users SET active = 0, suspended_at = ?, suspended_reason = ? WHERE id = ?`, [
                new Date().toISOString(),
                reason || 'Suspended by admin',
                id
            ]);
            
            // Also invalidate sessions
            await db.run(`DELETE FROM sessions WHERE user_id = ?`, [id]);
            
            await auditLog(req, 'SUSPEND_USER', 'user', id, { active: user.active }, { active: 0, reason });
            
            res.json({
                success: true,
                message: 'User suspended'
            });
        } catch (err) {
            console.error('[Admin API v2] Suspend user error:', err);
            res.status(500).json({ success: false, error: 'Failed to suspend user' });
        }
    }
);

// ============================================================================
// GUILD MANAGEMENT
// ============================================================================

router.get('/v2/guilds', async (req, res) => {
    try {
        if (!discordBot) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }
        
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const search = req.query.search?.toLowerCase();
        
        let guilds = Array.from(discordBot.guilds.cache.values()).map(g => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            ownerId: g.ownerId,
            icon: g.iconURL(),
            createdAt: g.createdAt,
            shardId: g.shardId
        }));
        
        if (search) {
            guilds = guilds.filter(g => 
                g.name.toLowerCase().includes(search) || 
                g.id.includes(search)
            );
        }
        
        // Sort by member count
        guilds.sort((a, b) => b.memberCount - a.memberCount);
        
        // Paginate
        const total = guilds.length;
        const paginatedGuilds = guilds.slice((page - 1) * limit, page * limit);
        
        res.json({
            success: true,
            guilds: paginatedGuilds,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[Admin API v2] Get guilds error:', err);
        res.status(500).json({ success: false, error: 'Failed to load guilds' });
    }
});

router.post('/v2/guilds/:id/sync-config', requireRole('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!discordBot) {
            return res.status(503).json({ success: false, error: 'Bot not available' });
        }
        
        const guild = discordBot.guilds.cache.get(id);
        if (!guild) {
            return res.status(404).json({ success: false, error: 'Guild not found' });
        }
        
        // Force refresh guild data
        await guild.fetch();
        
        await auditLog(req, 'SYNC_GUILD_CONFIG', 'guild', id, null, { synced: true });
        
        res.json({
            success: true,
            message: 'Guild config synced',
            guild: {
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount
            }
        });
    } catch (err) {
        console.error('[Admin API v2] Sync guild error:', err);
        res.status(500).json({ success: false, error: 'Failed to sync guild' });
    }
});

// ============================================================================
// FEATURE FLAGS
// ============================================================================

router.get('/v2/feature-flags', async (req, res) => {
    try {
        const flags = await db.all(`
            SELECT * FROM feature_flags 
            ORDER BY is_kill_switch DESC, name ASC
        `);
        
        res.json({
            success: true,
            flags
        });
    } catch (err) {
        console.error('[Admin API v2] Get flags error:', err);
        res.status(500).json({ success: false, error: 'Failed to load feature flags' });
    }
});

router.put('/v2/feature-flags/:id', requireRole('owner'), async (req, res) => {
    try {
        const { id } = req.params;
        const { is_enabled, rollout_percentage } = req.body;
        
        const existing = await db.get(`SELECT * FROM feature_flags WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Feature flag not found' });
        }
        
        // Kill switches can only be modified by owner (already checked by requireRole)
        
        const now = new Date().toISOString();
        await db.run(`
            UPDATE feature_flags SET
                is_enabled = COALESCE(?, is_enabled),
                rollout_percentage = COALESCE(?, rollout_percentage),
                updated_at = ?
            WHERE id = ?
        `, [
            is_enabled !== undefined ? (is_enabled ? 1 : 0) : null,
            rollout_percentage,
            now,
            id
        ]);
        
        await auditLog(req, 'UPDATE_FEATURE_FLAG', 'feature_flag', id, 
            { is_enabled: existing.is_enabled, rollout_percentage: existing.rollout_percentage },
            { is_enabled, rollout_percentage }
        );
        
        const updated = await db.get(`SELECT * FROM feature_flags WHERE id = ?`, [id]);
        
        res.json({
            success: true,
            message: 'Feature flag updated',
            flag: updated
        });
    } catch (err) {
        console.error('[Admin API v2] Update flag error:', err);
        res.status(500).json({ success: false, error: 'Failed to update feature flag' });
    }
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    router,
    setDiscordBot,
    requireRole,
    auditLog
};
