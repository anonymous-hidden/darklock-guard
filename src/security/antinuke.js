/**
 * Advanced Anti-Nuke System v2.1
 * 
 * Features:
 * - Real-time channel/role snapshot for instant restoration
 * - Immediate quarantine mode (strips all dangerous permissions server-wide)
 * - Fast detection using audit log streaming
 * - Automatic channel restoration from live snapshots
 * - Webhook flood protection
 * - Bot addition protection
 * - Role permission modification tracking
 * - Multi-layer response system
 * 
 * v2.1 Safety Features:
 * - Backup freshness validation
 * - Restore integrity checks
 * - Repair lock (prevents self-triggering)
 * - Diff-based partial restore
 * - Incident provenance tracking
 */

const { PermissionFlagsBits, AuditLogEvent, ChannelType } = require('discord.js');

class AntiNuke {
    constructor(bot) {
        this.bot = bot;
        
        // Action tracking (for detection)
        this.actionTracking = new Map(); // guildId -> Map(userId -> actions[])
        this.punishedUsers = new Map();  // guildId -> Map(userId -> timestamp)
        this.blockedUsers = new Map();   // guildId -> Set(userId)
        this.whitelistedUsers = new Map(); // guildId -> Set(userId)
        
        // CUMULATIVE QUOTA TRACKING - Prevents slow-burn attacks
        this.hourlyQuotas = new Map(); // guildId -> Map(userId -> { channelDelete, roleDelete, bans, kicks, timestamp })
        this.dailyQuotas = new Map();  // guildId -> Map(userId -> { channelDelete, roleDelete, bans, kicks, timestamp })
        
        // LIVE SNAPSHOTS - Updated in real-time for instant restoration
        this.channelSnapshots = new Map(); // guildId -> Map(channelId -> channelData)
        this.roleSnapshots = new Map();    // guildId -> Map(roleId -> roleData)
        this.webhookSnapshots = new Map(); // guildId -> Map(webhookId -> webhookData)
        
        // Quarantine state
        this.quarantineMode = new Map(); // guildId -> { active, triggeredBy, triggeredAt }
        this.originalPermissions = new Map(); // guildId -> Map(roleId -> permissions)
        
        // REPAIR LOCK - Prevents self-triggering during restoration
        this.repairMode = new Map(); // guildId -> { active, incidentId, startedAt }
        this.repairActions = new Map(); // guildId -> Set of action IDs we're performing
        
        // INCIDENT TRACKING - For provenance and auditing
        this.activeIncidents = new Map(); // incidentId -> incident data
        
        // BACKUP FRESHNESS CONFIG
        this.backupFreshnessConfig = {
            maxAgeHours: 24,           // Warn if backup older than this
            staleAgeHours: 72,         // Consider backup stale after this
            requireOwnerApproval: true // Require owner approval for stale backups
        };
        
        // Detection thresholds (aggressive - detect fast)
        this.thresholds = {
            channelDelete: { limit: 2, window: 8000 },  // 2 channels in 8 seconds
            channelCreate: { limit: 4, window: 10000 }, // 4 channels in 10 seconds
            roleDelete: { limit: 2, window: 8000 },     // 2 roles in 8 seconds
            roleCreate: { limit: 4, window: 10000 },    // 4 roles in 10 seconds
            banAdd: { limit: 3, window: 10000 },        // 3 bans in 10 seconds
            memberKick: { limit: 3, window: 10000 },    // 3 kicks in 10 seconds
            webhookCreate: { limit: 2, window: 10000 }, // 2 webhooks in 10 seconds
            roleUpdate: { limit: 3, window: 8000 },     // 3 dangerous permission grants in 8 seconds
            botAdd: { limit: 2, window: 30000 }         // 2 bot additions in 30 seconds
        };
        
        // CUMULATIVE QUOTA THRESHOLDS - Prevents slow-burn attacks
        // These limits apply over longer time windows to catch attackers
        // who space out their actions to evade burst detection
        this.cumulativeThresholds = {
            hourly: {
                channelDelete: 5,   // Max 5 channel deletions per hour per user
                roleDelete: 5,      // Max 5 role deletions per hour per user
                banAdd: 10,         // Max 10 bans per hour per user
                memberKick: 10      // Max 10 kicks per hour per user
            },
            daily: {
                channelDelete: 15,  // Max 15 channel deletions per day per user
                roleDelete: 15,     // Max 15 role deletions per day per user
                banAdd: 30,         // Max 30 bans per day per user
                memberKick: 30      // Max 30 kicks per day per user
            }
        };
        
        // Dangerous permissions to watch
        this.dangerousPerms = [
            PermissionFlagsBits.Administrator,
            PermissionFlagsBits.ManageGuild,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.BanMembers,
            PermissionFlagsBits.KickMembers,
            PermissionFlagsBits.ManageWebhooks
        ];
        
        this.punishmentCooldown = 600000; // 10 minutes
        this.cleanupInterval = 15000; // Faster cleanup
        
        setInterval(() => this.cleanupOldEntries(), this.cleanupInterval);
        setInterval(() => this.refreshAllSnapshots(), 300000); // Refresh every 5 minutes
        setInterval(() => this.cleanupCumulativeQuotas(), 3600000); // Cleanup quotas every hour
    }

    // ========================================
    // CUMULATIVE QUOTA SYSTEM - Prevents slow-burn attacks
    // ========================================

    /**
     * Track cumulative action for hourly/daily quotas
     */
    trackCumulativeAction(guildId, userId, actionType) {
        const now = Date.now();
        const hourAgo = now - 3600000;
        const dayAgo = now - 86400000;
        
        // Initialize maps if needed
        if (!this.hourlyQuotas.has(guildId)) {
            this.hourlyQuotas.set(guildId, new Map());
        }
        if (!this.dailyQuotas.has(guildId)) {
            this.dailyQuotas.set(guildId, new Map());
        }
        
        const hourlyGuild = this.hourlyQuotas.get(guildId);
        const dailyGuild = this.dailyQuotas.get(guildId);
        
        // Initialize user quota if needed
        if (!hourlyGuild.has(userId)) {
            hourlyGuild.set(userId, { channelDelete: [], roleDelete: [], banAdd: [], memberKick: [] });
        }
        if (!dailyGuild.has(userId)) {
            dailyGuild.set(userId, { channelDelete: [], roleDelete: [], banAdd: [], memberKick: [] });
        }
        
        const hourlyUser = hourlyGuild.get(userId);
        const dailyUser = dailyGuild.get(userId);
        
        // Only track actions that have cumulative limits
        if (!['channelDelete', 'roleDelete', 'banAdd', 'memberKick'].includes(actionType)) {
            return { violated: false };
        }
        
        // Add timestamp for this action
        hourlyUser[actionType] = hourlyUser[actionType] || [];
        dailyUser[actionType] = dailyUser[actionType] || [];
        
        // Clean old entries and add new one
        hourlyUser[actionType] = hourlyUser[actionType].filter(t => t > hourAgo);
        dailyUser[actionType] = dailyUser[actionType].filter(t => t > dayAgo);
        
        hourlyUser[actionType].push(now);
        dailyUser[actionType].push(now);
        
        // Check hourly quota
        const hourlyLimit = this.cumulativeThresholds.hourly[actionType];
        if (hourlyUser[actionType].length > hourlyLimit) {
            return {
                violated: true,
                quotaType: 'hourly',
                actionType,
                count: hourlyUser[actionType].length,
                limit: hourlyLimit,
                message: `Exceeded hourly ${actionType} quota (${hourlyUser[actionType].length}/${hourlyLimit})`
            };
        }
        
        // Check daily quota
        const dailyLimit = this.cumulativeThresholds.daily[actionType];
        if (dailyUser[actionType].length > dailyLimit) {
            return {
                violated: true,
                quotaType: 'daily',
                actionType,
                count: dailyUser[actionType].length,
                limit: dailyLimit,
                message: `Exceeded daily ${actionType} quota (${dailyUser[actionType].length}/${dailyLimit})`
            };
        }
        
        return { 
            violated: false,
            hourlyCount: hourlyUser[actionType].length,
            dailyCount: dailyUser[actionType].length
        };
    }

    /**
     * Cleanup old cumulative quota entries
     */
    cleanupCumulativeQuotas() {
        const now = Date.now();
        const hourAgo = now - 3600000;
        const dayAgo = now - 86400000;
        
        // Clean hourly quotas
        for (const [guildId, users] of this.hourlyQuotas) {
            for (const [userId, actions] of users) {
                let hasData = false;
                for (const actionType of Object.keys(actions)) {
                    actions[actionType] = actions[actionType].filter(t => t > hourAgo);
                    if (actions[actionType].length > 0) hasData = true;
                }
                if (!hasData) users.delete(userId);
            }
            if (users.size === 0) this.hourlyQuotas.delete(guildId);
        }
        
        // Clean daily quotas
        for (const [guildId, users] of this.dailyQuotas) {
            for (const [userId, actions] of users) {
                let hasData = false;
                for (const actionType of Object.keys(actions)) {
                    actions[actionType] = actions[actionType].filter(t => t > dayAgo);
                    if (actions[actionType].length > 0) hasData = true;
                }
                if (!hasData) users.delete(userId);
            }
            if (users.size === 0) this.dailyQuotas.delete(guildId);
        }
    }

    // ========================================
    // REPAIR LOCK SYSTEM
    // ========================================

    /**
     * Enter repair mode - suppresses anti-nuke triggers from bot actions
     */
    enterRepairMode(guildId, incidentId) {
        this.repairMode.set(guildId, {
            active: true,
            incidentId,
            startedAt: Date.now()
        });
        if (!this.repairActions.has(guildId)) {
            this.repairActions.set(guildId, new Set());
        }
        this.bot.logger.info(`🔧 [AntiNuke] Entered repair mode for guild ${guildId} (incident: ${incidentId})`);
    }

    /**
     * Exit repair mode
     */
    exitRepairMode(guildId) {
        const repair = this.repairMode.get(guildId);
        if (repair) {
            const duration = Date.now() - repair.startedAt;
            this.bot.logger.info(`🔧 [AntiNuke] Exited repair mode for guild ${guildId} after ${duration}ms`);
        }
        this.repairMode.set(guildId, { active: false });
        this.repairActions.get(guildId)?.clear();
    }

    /**
     * Check if guild is in repair mode
     */
    isInRepairMode(guildId) {
        const repair = this.repairMode.get(guildId);
        if (!repair?.active) return false;
        
        // Auto-exit repair mode after 5 minutes (safety)
        if (Date.now() - repair.startedAt > 5 * 60 * 1000) {
            this.exitRepairMode(guildId);
            return false;
        }
        return true;
    }

    /**
     * Check if an action should be ignored (bot's own repair action)
     */
    shouldIgnoreAction(guildId, executorId) {
        // Always ignore bot's own actions
        if (executorId === this.bot.client.user.id) return true;
        
        // Ignore during repair mode
        if (this.isInRepairMode(guildId)) return true;
        
        return false;
    }

    // ========================================
    // INCIDENT PROVENANCE TRACKING
    // ========================================

    /**
     * Generate unique incident ID
     */
    generateIncidentId() {
        return `INC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Create new incident record
     */
    createIncident(guildId, violation, attackerId) {
        const incidentId = this.generateIncidentId();
        const incident = {
            id: incidentId,
            guildId,
            attackerId,
            violation,
            detectedAt: Date.now(),
            status: 'active',
            restoreSource: null,       // 'memory' | 'database' | 'mixed'
            backupId: null,            // If restored from DB backup
            backupAge: null,           // Age of backup in hours
            itemsRestored: [],         // { type, id, name, source, success }
            itemsSkipped: [],          // { type, id, name, reason }
            actionsPerformed: [],      // { action, target, success, error }
            warnings: [],              // Any warnings during restore
            completedAt: null,
            responseTimeMs: null
        };
        
        this.activeIncidents.set(incidentId, incident);
        return incident;
    }

    /**
     * Record item restoration in incident
     */
    recordRestoration(incident, type, id, name, source, success, reason = null) {
        if (success) {
            incident.itemsRestored.push({ type, id, name, source, timestamp: Date.now() });
        } else {
            incident.itemsSkipped.push({ type, id, name, reason, timestamp: Date.now() });
        }
    }

    /**
     * Record action performed in incident
     */
    recordAction(incident, action, target, success, error = null) {
        incident.actionsPerformed.push({ action, target, success, error, timestamp: Date.now() });
    }

    /**
     * Add warning to incident
     */
    addWarning(incident, warning) {
        incident.warnings.push({ message: warning, timestamp: Date.now() });
    }

    /**
     * Complete incident and save to database
     */
    async completeIncident(incident) {
        incident.status = 'completed';
        incident.completedAt = Date.now();
        incident.responseTimeMs = incident.completedAt - incident.detectedAt;
        
        this.bot.logger.info(`[AntiNuke] Completing incident ${incident.id} - saving to database...`);
        
        // Save to database
        try {
            // Safely extract violation data with fallbacks
            const violationType = incident.violation?.actionType || 'unknown';
            const violationCount = incident.violation?.count || 0;
            
            await this.bot.database.run(`
                INSERT INTO antinuke_incidents 
                (incident_id, guild_id, attacker_id, violation_type, violation_count, 
                 restore_source, backup_id, backup_age_hours, items_restored, items_skipped,
                 actions_performed, warnings, detected_at, completed_at, response_time_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                incident.id,
                incident.guildId,
                incident.attackerId,
                violationType,
                violationCount,
                incident.restoreSource || null,
                incident.backupId || null,
                incident.backupAge || null,
                JSON.stringify(incident.itemsRestored || []),
                JSON.stringify(incident.itemsSkipped || []),
                JSON.stringify(incident.actionsPerformed || []),
                JSON.stringify(incident.warnings || []),
                new Date(incident.detectedAt).toISOString(),
                new Date(incident.completedAt).toISOString(),
                incident.responseTimeMs
            ]);
            
            this.bot.logger.info(`[AntiNuke] ✅ Incident ${incident.id} saved to database successfully`);
        } catch (e) {
            this.bot.logger.error(`[AntiNuke] ❌ Failed to save incident ${incident.id} to database:`, e);
        }
        
        // Remove from active incidents
        this.activeIncidents.delete(incident.id);
        
        return incident;
    }

    // ========================================
    // BACKUP FRESHNESS VALIDATION
    // ========================================

    /**
     * Validate backup freshness before restoration
     */
    validateBackupFreshness(backup, incidentTimestamp) {
        if (!backup?.createdAt) {
            return { valid: false, reason: 'No timestamp on backup', age: null, stale: true };
        }
        
        const backupTime = new Date(backup.createdAt).getTime();
        const ageMs = incidentTimestamp - backupTime;
        const ageHours = ageMs / (1000 * 60 * 60);
        
        const result = {
            valid: true,
            age: ageHours,
            ageFormatted: this.formatAge(ageHours),
            stale: ageHours > this.backupFreshnessConfig.staleAgeHours,
            warning: ageHours > this.backupFreshnessConfig.maxAgeHours
        };
        
        if (result.stale) {
            result.valid = false;
            result.reason = `Backup is ${result.ageFormatted} old (stale threshold: ${this.backupFreshnessConfig.staleAgeHours}h)`;
        }
        
        return result;
    }

    /**
     * Format age in human readable format
     */
    formatAge(hours) {
        if (hours < 1) return `${Math.round(hours * 60)} minutes`;
        if (hours < 24) return `${Math.round(hours)} hours`;
        return `${Math.round(hours / 24)} days`;
    }

    // ========================================
    // RESTORE INTEGRITY CHECKS
    // ========================================

    /**
     * Check if bot can restore a specific role
     */
    canRestoreRole(guild, roleData) {
        const botMember = guild.members.me;
        if (!botMember) return { can: false, reason: 'Bot member not found' };
        
        // Check bot has ManageRoles permission
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { can: false, reason: 'Bot lacks ManageRoles permission' };
        }
        
        // Skip managed roles (bots, integrations)
        if (roleData.managed) {
            return { can: false, reason: 'Managed role (bot/integration)' };
        }
        
        // Skip @everyone
        if (roleData.id === guild.id) {
            return { can: false, reason: '@everyone role cannot be recreated' };
        }
        
        // Check hierarchy - can only create roles below bot's highest role
        const botHighestPosition = botMember.roles.highest.position;
        if (roleData.position >= botHighestPosition) {
            return { can: false, reason: `Role position (${roleData.position}) >= bot position (${botHighestPosition})` };
        }
        
        return { can: true };
    }

    /**
     * Check if bot can restore a specific channel
     */
    canRestoreChannel(guild, channelData) {
        const botMember = guild.members.me;
        if (!botMember) return { can: false, reason: 'Bot member not found' };
        
        // Check bot has ManageChannels permission
        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return { can: false, reason: 'Bot lacks ManageChannels permission' };
        }
        
        // Check parent category exists (if specified)
        if (channelData.parentId) {
            const parent = guild.channels.cache.get(channelData.parentId);
            if (!parent) {
                // Try to find by name
                const parentByName = guild.channels.cache.find(c => 
                    c.type === ChannelType.GuildCategory && c.name === channelData.parent
                );
                if (!parentByName) {
                    return { can: true, warning: 'Parent category not found, will create at root' };
                }
            }
        }
        
        // Check channel limit (Discord limit is 500)
        if (guild.channels.cache.size >= 500) {
            return { can: false, reason: 'Guild at channel limit (500)' };
        }
        
        return { can: true };
    }

    /**
     * Check if channel already exists (for diff-based restore)
     */
    channelExists(guild, channelData) {
        // Check by ID first
        if (guild.channels.cache.has(channelData.id)) {
            return { exists: true, channel: guild.channels.cache.get(channelData.id) };
        }
        
        // Check by name and type
        const byName = guild.channels.cache.find(c => 
            c.name === channelData.name && c.type === channelData.type
        );
        if (byName) {
            return { exists: true, channel: byName, matchedByName: true };
        }
        
        return { exists: false };
    }

    /**
     * Check if role already exists (for diff-based restore)
     */
    roleExists(guild, roleData) {
        // Check by ID first
        if (guild.roles.cache.has(roleData.id)) {
            return { exists: true, role: guild.roles.cache.get(roleData.id) };
        }
        
        // Check by name
        const byName = guild.roles.cache.find(r => r.name === roleData.name);
        if (byName) {
            return { exists: true, role: byName, matchedByName: true };
        }
        
        return { exists: false };
    }

    // ========================================
    // SNAPSHOT MANAGEMENT (For Restoration)
    // ========================================

    /**
     * Initialize snapshots for a guild - called on ready and guild join
     */
    async initializeGuild(guild) {
        const guildId = guild.id;
        
        // Initialize tracking maps
        if (!this.actionTracking.has(guildId)) {
            this.actionTracking.set(guildId, new Map());
        }
        if (!this.punishedUsers.has(guildId)) {
            this.punishedUsers.set(guildId, new Map());
        }
        if (!this.whitelistedUsers.has(guildId)) {
            this.whitelistedUsers.set(guildId, new Set());
        }
        if (!this.blockedUsers.has(guildId)) {
            this.blockedUsers.set(guildId, new Set());
        }
        
        // Take initial snapshots
        await this.snapshotChannels(guild);
        await this.snapshotRoles(guild);
        await this.snapshotWebhooks(guild);
        
        this.bot.logger.info(`🛡️ Anti-nuke initialized for ${guild.name} - ${this.channelSnapshots.get(guildId)?.size || 0} channels, ${this.roleSnapshots.get(guildId)?.size || 0} roles snapshotted`);
    }

    /**
     * Snapshot all channels with full details for restoration
     */
    async snapshotChannels(guild) {
        const guildId = guild.id;
        const snapshot = new Map();
        
        for (const [channelId, channel] of guild.channels.cache) {
            snapshot.set(channelId, {
                id: channelId,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                rawPosition: channel.rawPosition,
                parentId: channel.parentId,
                topic: channel.topic || null,
                nsfw: channel.nsfw || false,
                rateLimitPerUser: channel.rateLimitPerUser || 0,
                bitrate: channel.bitrate,
                userLimit: channel.userLimit,
                rtcRegion: channel.rtcRegion,
                permissionOverwrites: this.serializePermissionOverwrites(channel),
                snapshotTime: Date.now()
            });
        }
        
        this.channelSnapshots.set(guildId, snapshot);
        return snapshot;
    }

    /**
     * Snapshot all roles with full details
     */
    async snapshotRoles(guild) {
        const guildId = guild.id;
        const snapshot = new Map();
        
        for (const [roleId, role] of guild.roles.cache) {
            if (role.managed || roleId === guildId) continue; // Skip managed and @everyone
            
            snapshot.set(roleId, {
                id: roleId,
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                position: role.position,
                permissions: role.permissions.bitfield.toString(),
                mentionable: role.mentionable,
                snapshotTime: Date.now()
            });
        }
        
        this.roleSnapshots.set(guildId, snapshot);
        return snapshot;
    }

    /**
     * Snapshot all webhooks
     */
    async snapshotWebhooks(guild) {
        const guildId = guild.id;
        try {
            const webhooks = await guild.fetchWebhooks().catch(() => null);
            if (!webhooks) return new Map();
            
            const snapshot = new Map();
            for (const [webhookId, webhook] of webhooks) {
                snapshot.set(webhookId, {
                    id: webhookId,
                    name: webhook.name,
                    channelId: webhook.channelId,
                    creatorId: webhook.owner?.id,
                    snapshotTime: Date.now()
                });
            }
            
            this.webhookSnapshots.set(guildId, snapshot);
            return snapshot;
        } catch (e) {
            return new Map();
        }
    }

    /**
     * Update channel snapshot when channel is created/modified
     */
    updateChannelSnapshot(channel) {
        if (!channel.guild) return;
        const guildId = channel.guild.id;
        
        if (!this.channelSnapshots.has(guildId)) {
            this.channelSnapshots.set(guildId, new Map());
        }
        
        this.channelSnapshots.get(guildId).set(channel.id, {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            position: channel.position,
            rawPosition: channel.rawPosition,
            parentId: channel.parentId,
            topic: channel.topic || null,
            nsfw: channel.nsfw || false,
            rateLimitPerUser: channel.rateLimitPerUser || 0,
            bitrate: channel.bitrate,
            userLimit: channel.userLimit,
            rtcRegion: channel.rtcRegion,
            permissionOverwrites: this.serializePermissionOverwrites(channel),
            snapshotTime: Date.now()
        });
    }

    /**
     * Update role snapshot when role is created/modified
     */
    updateRoleSnapshot(role) {
        if (!role.guild || role.managed || role.id === role.guild.id) return;
        const guildId = role.guild.id;
        
        if (!this.roleSnapshots.has(guildId)) {
            this.roleSnapshots.set(guildId, new Map());
        }
        
        this.roleSnapshots.get(guildId).set(role.id, {
            id: role.id,
            name: role.name,
            color: role.color,
            hoist: role.hoist,
            position: role.position,
            permissions: role.permissions.bitfield.toString(),
            mentionable: role.mentionable,
            snapshotTime: Date.now()
        });
    }

    /**
     * Serialize channel permission overwrites
     */
    serializePermissionOverwrites(channel) {
        const overwrites = [];
        for (const [, overwrite] of channel.permissionOverwrites.cache) {
            overwrites.push({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString()
            });
        }
        return overwrites;
    }

    /**
     * Refresh all snapshots periodically
     */
    async refreshAllSnapshots() {
        for (const guild of this.bot.client.guilds.cache.values()) {
            await this.snapshotChannels(guild);
            await this.snapshotRoles(guild);
        }
    }

    // ========================================
    // ACTION TRACKING & DETECTION
    // ========================================

    /**
     * Track an action and check for violations
     */
    async trackAction(guild, userId, actionType, details = {}) {
        const guildId = guild.id;
        
        // REPAIR LOCK CHECK - Ignore bot's own actions and actions during repair
        if (this.shouldIgnoreAction(guildId, userId)) {
            return { violated: false, reason: 'Repair mode active or bot action' };
        }
        
        // Initialize if needed
        if (!this.actionTracking.has(guildId)) {
            await this.initializeGuild(guild);
        }
        
        // Ignore blocked users (already being handled)
        if (this.blockedUsers.get(guildId)?.has(userId)) {
            return { violated: false, reason: 'User already blocked' };
        }
        
        // Ignore guild owner
        if (guild.ownerId === userId) {
            return { violated: false, reason: 'Guild owner' };
        }
        
        // Ignore whitelisted users
        if (this.whitelistedUsers.get(guildId)?.has(userId)) {
            return { violated: false, reason: 'Whitelisted user' };
        }
        
        // Check if anti-nuke is enabled
        const config = await this.bot.database.getGuildConfig(guildId);
        if (!config?.antinuke_enabled) {
            return { violated: false, reason: 'Anti-nuke disabled' };
        }
        
        // Get threshold config (use dashboard settings or defaults)
        const threshold = this.getThreshold(actionType, config);
        
        // Track the action
        const guildTracking = this.actionTracking.get(guildId);
        if (!guildTracking.has(userId)) {
            guildTracking.set(userId, []);
        }
        
        const now = Date.now();
        const userActions = guildTracking.get(userId);
        
        userActions.push({
            type: actionType,
            timestamp: now,
            details
        });
        
        // Filter to recent actions within window
        const recentActions = userActions.filter(a => 
            a.type === actionType && now - a.timestamp <= threshold.window
        );
        
        // Clean old actions
        const maxWindow = Math.max(...Object.values(this.thresholds).map(t => t.window));
        guildTracking.set(userId, userActions.filter(a => now - a.timestamp <= maxWindow));
        
        this.bot.logger.debug(`[AntiNuke] ${actionType} by ${userId}: ${recentActions.length}/${threshold.limit} in ${threshold.window}ms`);
        
        // Check for burst violation (existing behavior)
        if (recentActions.length >= threshold.limit) {
            this.bot.logger.security(`🚨 ANTI-NUKE VIOLATION: ${userId} performed ${recentActions.length} ${actionType} in ${threshold.window}ms`);
            
            return {
                violated: true,
                actionType,
                count: recentActions.length,
                limit: threshold.limit,
                window: threshold.window,
                actions: recentActions,
                detectedAt: now,
                violationType: 'burst'
            };
        }
        
        // Check cumulative quotas (slow-burn attack prevention)
        const quotaResult = this.trackCumulativeAction(guildId, userId, actionType);
        if (quotaResult.violated) {
            this.bot.logger.security(`🚨 ANTI-NUKE QUOTA VIOLATION: ${userId} - ${quotaResult.message}`);
            
            return {
                violated: true,
                actionType,
                count: quotaResult.count,
                limit: quotaResult.limit,
                quotaType: quotaResult.quotaType,
                detectedAt: now,
                violationType: 'cumulative',
                message: quotaResult.message
            };
        }
        
        return { 
            violated: false, 
            count: recentActions.length, 
            limit: threshold.limit,
            hourlyCount: quotaResult.hourlyCount,
            dailyCount: quotaResult.dailyCount
        };
    }

    /**
     * Get threshold for an action type (from config or defaults)
     */
    getThreshold(actionType, config) {
        // Allow dashboard to override limits
        const configLimits = {
            channelDelete: config?.antinuke_channel_limit,
            channelCreate: config?.antinuke_channel_limit,
            roleDelete: config?.antinuke_role_limit,
            roleCreate: config?.antinuke_role_limit,
            banAdd: config?.antinuke_ban_limit,
            memberKick: config?.antinuke_ban_limit
        };
        
        const baseThreshold = this.thresholds[actionType] || { limit: 3, window: 10000 };
        
        return {
            limit: configLimits[actionType] || baseThreshold.limit,
            window: baseThreshold.window
        };
    }

    // ========================================
    // VIOLATION HANDLING & RESPONSE
    // ========================================

    /**
     * Handle a detected violation - FAST response with incident tracking
     */
    async handleViolation(guild, userId, violation) {
        const guildId = guild.id;
        const startTime = Date.now();
        
        // CREATE INCIDENT for provenance tracking
        const incident = this.createIncident(guildId, violation, userId);
        
        this.bot.logger.security(`🚨 [${incident.id}] Handling anti-nuke violation: ${violation.actionType} by ${userId}`);
        
        // ENTER REPAIR MODE - Prevent self-triggering
        this.enterRepairMode(guildId, incident.id);
        
        // IMMEDIATELY block further actions from this user
        if (!this.blockedUsers.has(guildId)) {
            this.blockedUsers.set(guildId, new Set());
        }
        this.blockedUsers.get(guildId).add(userId);
        
        // Mark as punished
        if (!this.punishedUsers.has(guildId)) {
            this.punishedUsers.set(guildId, new Map());
        }
        this.punishedUsers.get(guildId).set(userId, Date.now());
        
        try {
            // 1. QUARANTINE - Strip dangerous permissions from ALL roles immediately
            const quarantineResult = await this.activateQuarantine(guild, userId);
            this.recordAction(incident, 'quarantine', 'all_roles', quarantineResult.success, quarantineResult.error);
            
            // 2. NEUTRALIZE the attacker
            const neutralizeResult = await this.neutralizeAttacker(guild, userId, violation);
            for (const action of neutralizeResult.actions) {
                this.recordAction(incident, action, userId, true);
            }
            for (const error of neutralizeResult.errors) {
                this.recordAction(incident, 'neutralize_error', userId, false, error);
            }
            
            // 3. RESTORE any damage (with integrity checks)
            const restoreResult = await this.restoreDamageWithValidation(guild, violation, userId, incident);
            
            // 4. EXIT REPAIR MODE
            this.exitRepairMode(guildId);
            
            // 5. Complete incident record
            await this.completeIncident(incident);
            
            // 6. Log the incident (legacy)
            await this.logIncident(guild, userId, violation, {
                incidentId: incident.id,
                quarantine: quarantineResult,
                neutralize: neutralizeResult,
                restore: restoreResult,
                responseTime: Date.now() - startTime
            });
            
            // 7. Notify moderators
            await this.notifyModerators(guild, userId, violation, {
                incident,
                quarantine: quarantineResult,
                neutralize: neutralizeResult,
                restore: restoreResult,
                responseTime: Date.now() - startTime
            });
            
            // 8. Emit security event
            if (this.bot.eventEmitter) {
                await this.bot.eventEmitter.emitSecurityEvent(guildId, 'antinuke_detected', {
                    incidentId: incident.id,
                    executorId: userId,
                    actionType: violation.actionType,
                    count: violation.count,
                    threshold: violation.limit,
                    mitigated: true,
                    responseTimeMs: Date.now() - startTime,
                    restoration: restoreResult
                });
            }
            
            this.bot.logger.security(`✅ [${incident.id}] Anti-nuke response completed in ${Date.now() - startTime}ms`);
            
        } catch (error) {
            this.bot.logger.error(`❌ [${incident.id}] Anti-nuke response failed:`, error);
            this.addWarning(incident, `Critical error: ${error.message}`);
            await this.completeIncident(incident);
        } finally {
            // Ensure repair mode is exited
            this.exitRepairMode(guildId);
        }
    }

    /**
     * Activate quarantine mode - strip dangerous permissions from all non-admin roles
     */
    async activateQuarantine(guild, triggeredBy) {
        const guildId = guild.id;
        
        if (this.quarantineMode.get(guildId)?.active) {
            return { success: true, message: 'Already in quarantine' };
        }
        
        this.bot.logger.security(`🔒 Activating QUARANTINE MODE for ${guild.name}`);
        
        const results = { rolesModified: 0, errors: [] };
        const originalPerms = new Map();
        
        const botMember = guild.members.me;
        if (!botMember) {
            return { success: false, error: 'Bot member not found' };
        }
        
        // Strip dangerous permissions from all roles below bot
        for (const [roleId, role] of guild.roles.cache) {
            // Skip @everyone, managed roles, and roles above bot
            if (roleId === guildId || role.managed) continue;
            if (role.position >= botMember.roles.highest.position) continue;
            
            // Check if role has any dangerous permissions
            const hasDangerous = this.dangerousPerms.some(perm => role.permissions.has(perm));
            if (!hasDangerous) continue;
            
            // Store original permissions
            originalPerms.set(roleId, role.permissions.bitfield.toString());
            
            try {
                // Remove dangerous permissions
                const newPerms = role.permissions.remove(this.dangerousPerms);
                await role.setPermissions(newPerms, `Anti-nuke quarantine triggered by ${triggeredBy}`);
                results.rolesModified++;
                await this.sleep(100); // Rate limit protection
            } catch (e) {
                results.errors.push({ roleId, roleName: role.name, error: e.message });
            }
        }
        
        this.originalPermissions.set(guildId, originalPerms);
        this.quarantineMode.set(guildId, {
            active: true,
            triggeredBy,
            triggeredAt: Date.now()
        });
        
        this.bot.logger.security(`🔒 Quarantine activated: ${results.rolesModified} roles modified`);
        
        return { success: true, ...results };
    }

    /**
     * Deactivate quarantine mode - restore original permissions
     */
    async deactivateQuarantine(guild, authorizedBy) {
        const guildId = guild.id;
        
        const quarantine = this.quarantineMode.get(guildId);
        if (!quarantine?.active) {
            return { success: false, error: 'Not in quarantine mode' };
        }
        
        const originalPerms = this.originalPermissions.get(guildId);
        if (!originalPerms) {
            return { success: false, error: 'No original permissions stored' };
        }
        
        this.bot.logger.security(`🔓 Deactivating quarantine for ${guild.name}`);
        
        const results = { rolesRestored: 0, errors: [] };
        
        for (const [roleId, perms] of originalPerms) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;
            
            try {
                await role.setPermissions(BigInt(perms), `Anti-nuke quarantine lifted by ${authorizedBy}`);
                results.rolesRestored++;
                await this.sleep(100);
            } catch (e) {
                results.errors.push({ roleId, error: e.message });
            }
        }
        
        this.quarantineMode.set(guildId, { active: false });
        this.originalPermissions.delete(guildId);
        
        // Unblock all users after quarantine lift
        this.blockedUsers.get(guildId)?.clear();
        
        this.bot.logger.security(`🔓 Quarantine deactivated: ${results.rolesRestored} roles restored`);
        
        return { success: true, ...results };
    }

    /**
     * Neutralize the attacker - ban, strip roles, remove from server
     */
    async neutralizeAttacker(guild, userId, violation) {
        const results = { actions: [], errors: [] };
        
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            const botMember = guild.members.me;
            
            if (!member) {
                results.errors.push('Could not fetch member');
                // Still try to ban
                try {
                    if (botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
                        await guild.members.ban(userId, {
                            reason: `Anti-nuke: ${violation.count} ${violation.actionType} in ${violation.window/1000}s`,
                            deleteMessageSeconds: 0
                        });
                        results.actions.push('Banned user (not in server)');
                    }
                } catch (e) {
                    results.errors.push(`Failed to ban: ${e.message}`);
                }
                return results;
            }
            
            // Check if we can act on this member
            if (member.roles.highest.position >= botMember.roles.highest.position) {
                results.errors.push('Member has higher role than bot');
            }
            
            // 1. Strip ALL roles immediately
            try {
                if (botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    const rolesToRemove = member.roles.cache.filter(r => r.position < botMember.roles.highest.position && r.id !== guild.id);
                    if (rolesToRemove.size > 0) {
                        await member.roles.remove(rolesToRemove, `Anti-nuke: ${violation.actionType} violation`);
                        results.actions.push(`Removed ${rolesToRemove.size} roles`);
                    }
                }
            } catch (e) {
                results.errors.push(`Failed to remove roles: ${e.message}`);
            }
            
            // 2. Timeout for max duration
            try {
                if (botMember.permissions.has(PermissionFlagsBits.ModerateMembers) && member.moderatable) {
                    await member.timeout(28 * 24 * 60 * 60 * 1000, `Anti-nuke: ${violation.actionType}`);
                    results.actions.push('Applied 28-day timeout');
                }
            } catch (e) {
                results.errors.push(`Failed to timeout: ${e.message}`);
            }
            
            // 3. BAN the attacker
            try {
                if (botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
                    await guild.members.ban(userId, {
                        reason: `Anti-nuke: ${violation.count} ${violation.actionType} in ${violation.window/1000}s`,
                        deleteMessageSeconds: 0 // Don't delete messages for evidence
                    });
                    results.actions.push('Banned user');
                }
            } catch (e) {
                results.errors.push(`Failed to ban: ${e.message}`);
            }
            
        } catch (error) {
            results.errors.push(`Neutralization error: ${error.message}`);
        }
        
        return results;
    }

    /**
     * Restore damage with full validation and integrity checks
     * This is the v2.1 safe restore method
     */
    async restoreDamageWithValidation(guild, violation, attackerId, incident) {
        const guildId = guild.id;
        const results = {
            channelsRestored: 0,
            channelsDeleted: 0,
            rolesRestored: 0,
            usersUnbanned: 0,
            webhooksDeleted: 0,
            itemsSkipped: 0,
            errors: [],
            source: 'memory' // Default to memory snapshots
        };
        
        const actions = violation.actions || [];
        
        // Track what we're restoring to avoid duplicates
        const restoredChannels = new Set();
        const restoredRoles = new Set();
        const channelsToRestore = []; // { channelId, data, source }
        const categoriesToRestore = []; // Categories must be restored first
        const channelsToDelete = new Set(); // Malicious channels to delete
        
        // PHASE 1: Collect all channels that need restoration or deletion
        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'channelDelete': {
                        const channelId = action.details.channelId;
                        const channelName = action.details.channelName || channelId;
                        const channelType = action.details.channelType;
                        
                        // DIFF CHECK - Skip if channel already exists
                        const existsCheck = this.channelExists(guild, { id: channelId, name: channelName, type: channelType });
                        if (existsCheck.exists) {
                            this.recordRestoration(incident, 'channel', channelId, channelName, 'skipped', false, 'Channel already exists');
                            results.itemsSkipped++;
                            break;
                        }
                        
                        // Skip if already queued
                        if (restoredChannels.has(channelId)) break;
                        restoredChannels.add(channelId);
                        
                        // Try snapshot first, then DB backup
                        const snapshot = this.channelSnapshots.get(guildId)?.get(channelId);
                        if (snapshot) {
                            const canRestore = this.canRestoreChannel(guild, snapshot);
                            if (!canRestore.can) {
                                this.recordRestoration(incident, 'channel', channelId, channelName, 'memory', false, canRestore.reason);
                                results.itemsSkipped++;
                                break;
                            }
                            if (canRestore.warning) {
                                this.addWarning(incident, canRestore.warning);
                            }
                            
                            // Queue for ordered restoration - categories first
                            if (snapshot.type === ChannelType.GuildCategory) {
                                categoriesToRestore.push({ channelId, data: snapshot, source: 'memory' });
                            } else {
                                channelsToRestore.push({ channelId, data: snapshot, source: 'memory' });
                            }
                        } else {
                            // Will try DB backup later
                            if (channelType === ChannelType.GuildCategory) {
                                categoriesToRestore.push({ channelId, data: null, source: 'database' });
                            } else {
                                channelsToRestore.push({ channelId, data: null, source: 'database' });
                            }
                        }
                        break;
                    }
                    
                    case 'channelCreate': {
                        // Mark malicious channel for deletion
                        channelsToDelete.add(action.details.channelId);
                        break;
                    }
                    
                    case 'roleDelete': {
                        const roleId = action.details.roleId;
                        const roleName = action.details.roleName || roleId;
                        
                        // DIFF CHECK - Skip if role already exists
                        const existsCheck = this.roleExists(guild, { id: roleId, name: roleName });
                        if (existsCheck.exists) {
                            this.recordRestoration(incident, 'role', roleId, roleName, 'skipped', false, 'Role already exists');
                            results.itemsSkipped++;
                            break;
                        }
                        
                        // Skip if already restored
                        if (restoredRoles.has(roleId)) break;
                        
                        // Try snapshot first
                        const snapshot = this.roleSnapshots.get(guildId)?.get(roleId);
                        if (snapshot) {
                            // INTEGRITY CHECK
                            const canRestore = this.canRestoreRole(guild, snapshot);
                            if (!canRestore.can) {
                                this.recordRestoration(incident, 'role', roleId, roleName, 'memory', false, canRestore.reason);
                                results.itemsSkipped++;
                                break;
                            }
                            
                            const restored = await this.restoreRoleFromSnapshot(guild, snapshot, incident);
                            if (restored) {
                                results.rolesRestored++;
                                restoredRoles.add(roleId);
                                this.recordRestoration(incident, 'role', roleId, roleName, 'memory', true);
                            }
                        } else {
                            // Try DB backup
                            const restored = await this.restoreRoleFromBackupWithValidation(guild, roleId, incident);
                            if (restored) {
                                results.rolesRestored++;
                                results.source = 'mixed';
                                restoredRoles.add(roleId);
                            }
                        }
                        break;
                    }
                    
                    case 'roleCreate': {
                        // Delete malicious roles with integrity check
                        const role = guild.roles.cache.get(action.details.roleId);
                        if (role) {
                            if (role.managed) {
                                this.recordAction(incident, 'skip_delete_role', role.id, false, 'Managed role');
                                break;
                            }
                            if (!role.editable) {
                                this.recordAction(incident, 'skip_delete_role', role.id, false, 'Role not editable');
                                break;
                            }
                            await role.delete('Anti-nuke: Reverting mass role creation');
                            results.rolesRestored++;
                            this.recordAction(incident, 'delete_role', role.id, true);
                        }
                        break;
                    }
                    
                    case 'banAdd': {
                        // Unban victims
                        if (action.details.targetId) {
                            try {
                                await guild.members.unban(action.details.targetId, 'Anti-nuke: Reverting mass ban');
                                results.usersUnbanned++;
                                this.recordAction(incident, 'unban', action.details.targetId, true);
                            } catch (e) {
                                this.recordAction(incident, 'unban', action.details.targetId, false, e.message);
                            }
                        }
                        break;
                    }
                    
                    case 'webhookCreate': {
                        // Delete malicious webhooks
                        const webhooks = await guild.fetchWebhooks().catch(() => null);
                        if (webhooks) {
                            const wh = webhooks.get(action.details.webhookId);
                            if (wh) {
                                await wh.delete('Anti-nuke: Removing malicious webhook');
                                results.webhooksDeleted++;
                                this.recordAction(incident, 'delete_webhook', wh.id, true);
                            }
                        }
                        break;
                    }
                }
                
            } catch (e) {
                results.errors.push(`Failed ${action.type}: ${e.message}`);
                this.recordAction(incident, action.type, action.details?.channelId || action.details?.roleId, false, e.message);
            }
        }
        
        // PHASE 2: Delete malicious channels FIRST (before restoring)
        this.bot.logger.info(`[AntiNuke] Phase 2: Deleting ${channelsToDelete.size} malicious channels...`);
        for (const channelId of channelsToDelete) {
            try {
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    await channel.delete('Anti-nuke: Reverting mass channel creation');
                    results.channelsDeleted++;
                    this.recordAction(incident, 'delete_channel', channelId, true);
                    await this.sleep(200);
                }
            } catch (e) {
                results.errors.push(`Failed to delete malicious channel ${channelId}: ${e.message}`);
            }
        }
        
        // PHASE 3: Restore categories first (sorted by position)
        this.bot.logger.info(`[AntiNuke] Phase 3: Restoring ${categoriesToRestore.length} categories...`);
        categoriesToRestore.sort((a, b) => (a.data?.position || 0) - (b.data?.position || 0));
        const categoryIdMap = new Map(); // oldId -> newId (for parent mapping)
        
        for (const item of categoriesToRestore) {
            try {
                if (item.data) {
                    const newChannel = await this.restoreChannelFromSnapshotWithId(guild, item.data, incident);
                    if (newChannel) {
                        categoryIdMap.set(item.channelId, newChannel.id);
                        results.channelsRestored++;
                        this.recordRestoration(incident, 'channel', item.channelId, item.data.name, 'memory', true);
                    }
                } else {
                    const restored = await this.restoreChannelFromBackupWithValidation(guild, item.channelId, incident);
                    if (restored) {
                        results.channelsRestored++;
                        results.source = 'mixed';
                    }
                }
                await this.sleep(200);
            } catch (e) {
                results.errors.push(`Failed to restore category ${item.channelId}: ${e.message}`);
            }
        }
        
        // PHASE 4: Restore regular channels (sorted by position within categories)
        this.bot.logger.info(`[AntiNuke] Phase 4: Restoring ${channelsToRestore.length} channels...`);
        channelsToRestore.sort((a, b) => {
            // Sort by parent first, then position
            const parentA = a.data?.parentId || '';
            const parentB = b.data?.parentId || '';
            if (parentA !== parentB) return parentA.localeCompare(parentB);
            return (a.data?.position || 0) - (b.data?.position || 0);
        });
        
        for (const item of channelsToRestore) {
            try {
                if (item.data) {
                    // Update parent ID if category was restored with new ID
                    if (item.data.parentId && categoryIdMap.has(item.data.parentId)) {
                        item.data.parentId = categoryIdMap.get(item.data.parentId);
                    }
                    const restored = await this.restoreChannelFromSnapshot(guild, item.data, incident);
                    if (restored) {
                        results.channelsRestored++;
                        this.recordRestoration(incident, 'channel', item.channelId, item.data.name, 'memory', true);
                    }
                } else {
                    const restored = await this.restoreChannelFromBackupWithValidation(guild, item.channelId, incident);
                    if (restored) {
                        results.channelsRestored++;
                        results.source = 'mixed';
                    }
                }
                await this.sleep(200);
            } catch (e) {
                results.errors.push(`Failed to restore channel ${item.channelId}: ${e.message}`);
            }
        }
        
        // PHASE 5: Sweep for additional malicious channels created by attacker
        this.bot.logger.info(`[AntiNuke] Phase 5: Sweeping for additional malicious channels...`);
        await this.sweepMaliciousChannels(guild, attackerId, violation.detectedAt, incident, results);
        
        // PHASE 6: Reorder all channels to match original positions
        this.bot.logger.info(`[AntiNuke] Phase 6: Reordering channels to original positions...`);
        await this.reorderChannelsToSnapshots(guild, incident, results);
        
        // Update incident restore source
        incident.restoreSource = results.source;
        
        // Also do a sweep for any other damage by this attacker (roles, bans, etc.)
        await this.sweepAttackerDamageWithValidation(guild, attackerId, violation.detectedAt, incident);
        
        return results;
    }

    /**
     * Restore channel from snapshot with validation (internal)
     */
    async restoreChannelFromSnapshot(guild, snapshot, incident) {
        const guildId = guild.id;
        
        try {
            // Determine parent category
            let parent = null;
            if (snapshot.parentId) {
                parent = guild.channels.cache.get(snapshot.parentId);
            }
            
            // Build permission overwrites
            const permissionOverwrites = [];
            for (const ow of snapshot.permissionOverwrites || []) {
                if (guild.roles.cache.has(ow.id) || guild.members.cache.has(ow.id) || ow.id === guildId) {
                    permissionOverwrites.push({
                        id: ow.id,
                        type: ow.type,
                        allow: BigInt(ow.allow),
                        deny: BigInt(ow.deny)
                    });
                }
            }
            
            const options = {
                name: snapshot.name,
                type: snapshot.type,
                parent: parent,
                position: snapshot.position,
                topic: snapshot.topic,
                nsfw: snapshot.nsfw,
                rateLimitPerUser: snapshot.rateLimitPerUser,
                permissionOverwrites,
                reason: `Anti-nuke: Restoring deleted channel [${incident?.id || 'manual'}]`
            };
            
            if (snapshot.type === ChannelType.GuildVoice || snapshot.type === ChannelType.GuildStageVoice) {
                options.bitrate = snapshot.bitrate;
                options.userLimit = snapshot.userLimit;
                options.rtcRegion = snapshot.rtcRegion;
            }
            
            const newChannel = await guild.channels.create(options);
            
            // Update snapshot with new ID
            this.channelSnapshots.get(guildId)?.delete(snapshot.id);
            this.updateChannelSnapshot(newChannel);
            
            this.bot.logger.info(`✅ Channel restored: ${newChannel.name} (${newChannel.id})`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore channel ${snapshot.name}:`, e);
            return false;
        }
    }

    /**
     * Restore channel from snapshot and return the new channel object (for ID tracking)
     */
    async restoreChannelFromSnapshotWithId(guild, snapshot, incident) {
        const guildId = guild.id;
        
        try {
            // Determine parent category
            let parent = null;
            if (snapshot.parentId) {
                parent = guild.channels.cache.get(snapshot.parentId);
            }
            
            // Build permission overwrites
            const permissionOverwrites = [];
            for (const ow of snapshot.permissionOverwrites || []) {
                if (guild.roles.cache.has(ow.id) || guild.members.cache.has(ow.id) || ow.id === guildId) {
                    permissionOverwrites.push({
                        id: ow.id,
                        type: ow.type,
                        allow: BigInt(ow.allow),
                        deny: BigInt(ow.deny)
                    });
                }
            }
            
            const options = {
                name: snapshot.name,
                type: snapshot.type,
                parent: parent,
                topic: snapshot.topic,
                nsfw: snapshot.nsfw,
                rateLimitPerUser: snapshot.rateLimitPerUser,
                permissionOverwrites,
                reason: `Anti-nuke: Restoring deleted channel [${incident?.id || 'manual'}]`
            };
            
            if (snapshot.type === ChannelType.GuildVoice || snapshot.type === ChannelType.GuildStageVoice) {
                options.bitrate = snapshot.bitrate;
                options.userLimit = snapshot.userLimit;
                options.rtcRegion = snapshot.rtcRegion;
            }
            
            const newChannel = await guild.channels.create(options);
            
            // Store mapping for position restoration
            newChannel._originalPosition = snapshot.position;
            newChannel._originalRawPosition = snapshot.rawPosition;
            
            // Update snapshot with new ID
            this.channelSnapshots.get(guildId)?.delete(snapshot.id);
            this.updateChannelSnapshot(newChannel);
            
            this.bot.logger.info(`✅ Channel restored: ${newChannel.name} (${newChannel.id})`);
            return newChannel;
        } catch (e) {
            this.bot.logger.error(`Failed to restore channel ${snapshot.name}:`, e);
            return null;
        }
    }

    /**
     * Sweep for and delete malicious channels created by attacker
     */
    async sweepMaliciousChannels(guild, attackerId, detectedAt, incident, results) {
        const windowMs = 5 * 60 * 1000;
        const cutoff = Math.max(0, (detectedAt || Date.now()) - windowMs);
        
        try {
            // Fetch audit logs for channel creations
            const createLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelCreate,
                limit: 100
            }).catch(() => null);
            
            if (!createLogs) return;
            
            // Get list of original channel IDs from snapshots
            const originalChannelIds = new Set(this.channelSnapshots.get(guild.id)?.keys() || []);
            
            for (const entry of createLogs.entries.values()) {
                // Only target attacker's actions within the time window
                if (entry.executor?.id !== attackerId) continue;
                if (entry.createdTimestamp < cutoff) continue;
                
                const channelId = entry.target?.id;
                const channel = guild.channels.cache.get(channelId);
                
                // Delete if channel exists and wasn't in original snapshot
                if (channel && !originalChannelIds.has(channelId)) {
                    try {
                        await channel.delete('Anti-nuke: Removing malicious channel created during attack');
                        results.channelsDeleted = (results.channelsDeleted || 0) + 1;
                        this.recordAction(incident, 'delete_malicious_channel', channelId, true);
                        this.bot.logger.info(`🗑️ Deleted malicious channel: ${channel.name}`);
                        await this.sleep(300);
                    } catch (e) {
                        this.recordAction(incident, 'delete_malicious_channel', channelId, false, e.message);
                    }
                }
            }
        } catch (e) {
            this.bot.logger.error('Failed to sweep malicious channels:', e);
            this.addWarning(incident, `Malicious channel sweep failed: ${e.message}`);
        }
    }

    /**
     * Reorder channels to match original snapshot positions
     */
    async reorderChannelsToSnapshots(guild, incident, results) {
        const guildId = guild.id;
        const snapshots = this.channelSnapshots.get(guildId);
        
        if (!snapshots || snapshots.size === 0) {
            this.bot.logger.warn('[AntiNuke] No snapshots available for reordering');
            return;
        }
        
        try {
            // Build position map from snapshots: { parentId -> [{ id, position, name }] }
            const positionMap = new Map();
            
            // First, handle categories (they have no parent)
            const categories = [];
            const channelsByParent = new Map();
            
            for (const [channelId, snapshot] of snapshots) {
                const currentChannel = guild.channels.cache.find(c => c.name === snapshot.name && c.type === snapshot.type);
                if (!currentChannel) continue;
                
                if (snapshot.type === ChannelType.GuildCategory) {
                    categories.push({
                        id: currentChannel.id,
                        position: snapshot.position,
                        rawPosition: snapshot.rawPosition,
                        name: snapshot.name
                    });
                } else {
                    const parentKey = snapshot.parentId || 'root';
                    if (!channelsByParent.has(parentKey)) {
                        channelsByParent.set(parentKey, []);
                    }
                    channelsByParent.get(parentKey).push({
                        id: currentChannel.id,
                        position: snapshot.position,
                        rawPosition: snapshot.rawPosition,
                        name: snapshot.name,
                        parentId: snapshot.parentId
                    });
                }
            }
            
            // Sort categories by position
            categories.sort((a, b) => a.position - b.position);
            
            // Reorder categories first
            if (categories.length > 0) {
                const categoryPositions = categories.map((cat, index) => ({
                    channel: cat.id,
                    position: index
                }));
                
                try {
                    await guild.channels.setPositions(categoryPositions);
                    this.bot.logger.info(`[AntiNuke] Reordered ${categories.length} categories`);
                    await this.sleep(500);
                } catch (e) {
                    this.bot.logger.warn(`[AntiNuke] Failed to reorder categories: ${e.message}`);
                }
            }
            
            // Now handle channels within each category/root
            for (const [parentKey, channels] of channelsByParent) {
                // Sort by original position
                channels.sort((a, b) => a.position - b.position);
                
                // Find the actual parent channel (if any)
                let parentChannel = null;
                if (parentKey !== 'root') {
                    parentChannel = guild.channels.cache.get(parentKey);
                    if (!parentChannel) {
                        // Try to find by matching name from snapshots
                        const parentSnapshot = snapshots.get(parentKey);
                        if (parentSnapshot) {
                            parentChannel = guild.channels.cache.find(c => 
                                c.name === parentSnapshot.name && c.type === ChannelType.GuildCategory
                            );
                        }
                    }
                }
                
                // Set parent and position for each channel
                for (const channelData of channels) {
                    const channel = guild.channels.cache.get(channelData.id);
                    if (!channel) continue;
                    
                    try {
                        // Update parent if needed
                        if (parentChannel && channel.parentId !== parentChannel.id) {
                            await channel.setParent(parentChannel.id, { 
                                lockPermissions: false,
                                reason: 'Anti-nuke: Restoring channel to original category' 
                            });
                            await this.sleep(200);
                        } else if (!parentChannel && parentKey === 'root' && channel.parentId) {
                            // Move to root if it was originally at root
                            await channel.setParent(null, {
                                lockPermissions: false,
                                reason: 'Anti-nuke: Restoring channel to root'
                            });
                            await this.sleep(200);
                        }
                    } catch (e) {
                        this.bot.logger.warn(`[AntiNuke] Failed to set parent for ${channel.name}: ${e.message}`);
                    }
                }
                
                // Set positions within the category
                const positionUpdates = channels.map((ch, index) => ({
                    channel: ch.id,
                    position: index,
                    parent: parentChannel?.id || null
                }));
                
                try {
                    if (positionUpdates.length > 0) {
                        await guild.channels.setPositions(positionUpdates);
                        await this.sleep(300);
                    }
                } catch (e) {
                    this.bot.logger.warn(`[AntiNuke] Failed to reorder channels in ${parentKey}: ${e.message}`);
                }
            }
            
            this.bot.logger.info(`[AntiNuke] ✅ Channel reordering complete`);
            
        } catch (e) {
            this.bot.logger.error('[AntiNuke] Channel reordering failed:', e);
            this.addWarning(incident, `Channel reordering failed: ${e.message}`);
        }
    }

    /**
     * Restore role from snapshot with validation (internal)
     */
    async restoreRoleFromSnapshot(guild, snapshot, incident) {
        const guildId = guild.id;
        
        try {
            const newRole = await guild.roles.create({
                name: snapshot.name,
                color: snapshot.color,
                hoist: snapshot.hoist,
                permissions: BigInt(snapshot.permissions),
                mentionable: snapshot.mentionable,
                reason: `Anti-nuke: Restoring deleted role [${incident?.id || 'manual'}]`
            });
            
            // Update snapshot
            this.roleSnapshots.get(guildId)?.delete(snapshot.id);
            this.updateRoleSnapshot(newRole);
            
            this.bot.logger.info(`✅ Role restored: ${newRole.name} (${newRole.id})`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore role ${snapshot.name}:`, e);
            return false;
        }
    }

    /**
     * Restore channel from DB backup with freshness and integrity validation
     */
    async restoreChannelFromBackupWithValidation(guild, channelId, incident) {
        if (!this.bot.serverBackup) {
            this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, 'Backup system unavailable');
            return false;
        }
        
        try {
            const backups = await this.bot.serverBackup.listBackups(guild.id);
            if (!backups || backups.length === 0) {
                this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, 'No backups found');
                return false;
            }
            
            // Use integrity-verified backup retrieval
            const backupResult = await this.bot.serverBackup.getBackupDataWithVerification(backups[0].id);
            if (!backupResult) {
                this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, 'Failed to load backup');
                return false;
            }
            
            const { data: latestBackup, integrity } = backupResult;
            
            // INTEGRITY VALIDATION
            if (!integrity.valid && !integrity.legacy) {
                this.addWarning(incident, `Backup integrity failed: ${integrity.reason}`);
                this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, 'Backup integrity check failed');
                return false;
            }
            if (integrity.legacy) {
                this.addWarning(incident, 'Using legacy backup without integrity hash');
            }
            
            if (!latestBackup?.data?.channels) {
                this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, 'Backup has no channel data');
                return false;
            }
            
            // FRESHNESS VALIDATION
            const freshness = this.validateBackupFreshness(latestBackup, incident.detectedAt);
            incident.backupId = backups[0].id;
            incident.backupAge = freshness.age;
            incident.backupIntegrity = integrity.valid ? 'verified' : (integrity.legacy ? 'legacy' : 'failed');
            
            if (!freshness.valid) {
                this.addWarning(incident, `Backup too old: ${freshness.reason}`);
                this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, freshness.reason);
                return false;
            }
            
            if (freshness.warning) {
                this.addWarning(incident, `Backup age warning: ${freshness.ageFormatted} old`);
            }
            
            // Find channel in backup
            const allChannels = [
                ...(latestBackup.data.channels.categories || []),
                ...(latestBackup.data.channels.channels || [])
            ];
            const channelData = allChannels.find(c => c.id === channelId);
            
            if (!channelData) {
                this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, 'Channel not in backup');
                return false;
            }
            
            // INTEGRITY CHECK
            const canRestore = this.canRestoreChannel(guild, channelData);
            if (!canRestore.can) {
                this.recordRestoration(incident, 'channel', channelId, channelData.name, 'database', false, canRestore.reason);
                return false;
            }
            
            // Restore the channel
            this.bot.logger.info(`🔧 Restoring channel from DB backup: ${channelData.name}`);
            
            let parent = null;
            if (channelData.parentId) {
                parent = guild.channels.cache.get(channelData.parentId);
                if (!parent && channelData.parent) {
                    parent = guild.channels.cache.find(c => 
                        c.type === ChannelType.GuildCategory && c.name === channelData.parent
                    );
                }
            }
            
            const permissionOverwrites = [];
            for (const ow of channelData.permissionOverwrites || []) {
                let targetId = ow.id;
                if (ow.type === 0 && ow.roleName) {
                    const role = guild.roles.cache.find(r => r.name === ow.roleName);
                    if (role) targetId = role.id;
                }
                if (guild.roles.cache.has(targetId) || guild.members.cache.has(targetId) || targetId === guild.id) {
                    permissionOverwrites.push({
                        id: targetId,
                        type: ow.type,
                        allow: BigInt(ow.allow),
                        deny: BigInt(ow.deny)
                    });
                }
            }
            
            const options = {
                name: channelData.name,
                type: channelData.type,
                parent,
                topic: channelData.topic,
                nsfw: channelData.nsfw,
                rateLimitPerUser: channelData.rateLimitPerUser,
                permissionOverwrites,
                reason: `Anti-nuke: Restoring from backup [${incident.id}]`
            };
            
            if (channelData.type === ChannelType.GuildVoice || channelData.type === ChannelType.GuildStageVoice) {
                options.bitrate = channelData.bitrate;
                options.userLimit = channelData.userLimit;
            }
            
            const newChannel = await guild.channels.create(options);
            this.updateChannelSnapshot(newChannel);
            
            this.recordRestoration(incident, 'channel', channelId, channelData.name, 'database', true);
            this.bot.logger.info(`✅ Channel restored from backup: ${newChannel.name}`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore channel from backup:`, e);
            this.recordRestoration(incident, 'channel', channelId, 'unknown', 'database', false, e.message);
            return false;
        }
    }

    /**
     * Restore role from DB backup with freshness and integrity validation
     */
    async restoreRoleFromBackupWithValidation(guild, roleId, incident) {
        if (!this.bot.serverBackup) {
            this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, 'Backup system unavailable');
            return false;
        }
        
        try {
            const backups = await this.bot.serverBackup.listBackups(guild.id);
            if (!backups || backups.length === 0) {
                this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, 'No backups found');
                return false;
            }
            
            // Use integrity-verified backup retrieval
            const backupResult = await this.bot.serverBackup.getBackupDataWithVerification(backups[0].id);
            if (!backupResult) {
                this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, 'Failed to load backup');
                return false;
            }
            
            const { data: latestBackup, integrity } = backupResult;
            
            // INTEGRITY VALIDATION
            if (!integrity.valid && !integrity.legacy) {
                this.addWarning(incident, `Backup integrity failed: ${integrity.reason}`);
                this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, 'Backup integrity check failed');
                return false;
            }
            
            if (!latestBackup?.data?.roles) {
                this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, 'Backup has no role data');
                return false;
            }
            
            // FRESHNESS VALIDATION
            const freshness = this.validateBackupFreshness(latestBackup, incident.detectedAt);
            if (!incident.backupId) {
                incident.backupId = backups[0].id;
                incident.backupAge = freshness.age;
                incident.backupIntegrity = integrity.valid ? 'verified' : (integrity.legacy ? 'legacy' : 'failed');
            }
            
            if (!freshness.valid) {
                this.addWarning(incident, `Backup too old for role restore: ${freshness.reason}`);
                this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, freshness.reason);
                return false;
            }
            
            // Find role in backup
            const roleData = latestBackup.data.roles.find(r => r.id === roleId);
            if (!roleData) {
                this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, 'Role not in backup');
                return false;
            }
            
            // INTEGRITY CHECK
            const canRestore = this.canRestoreRole(guild, roleData);
            if (!canRestore.can) {
                this.recordRestoration(incident, 'role', roleId, roleData.name, 'database', false, canRestore.reason);
                return false;
            }
            
            this.bot.logger.info(`🔧 Restoring role from DB backup: ${roleData.name}`);
            
            const newRole = await guild.roles.create({
                name: roleData.name,
                color: roleData.color,
                hoist: roleData.hoist,
                permissions: BigInt(roleData.permissions),
                mentionable: roleData.mentionable,
                reason: `Anti-nuke: Restoring from backup [${incident.id}]`
            });
            
            this.updateRoleSnapshot(newRole);
            
            this.recordRestoration(incident, 'role', roleId, roleData.name, 'database', true);
            this.bot.logger.info(`✅ Role restored from backup: ${newRole.name}`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore role from backup:`, e);
            this.recordRestoration(incident, 'role', roleId, 'unknown', 'database', false, e.message);
            return false;
        }
    }

    /**
     * Sweep for additional attacker damage with validation
     */
    async sweepAttackerDamageWithValidation(guild, attackerId, detectedAt, incident) {
        const windowMs = 5 * 60 * 1000;
        const cutoff = Math.max(0, (detectedAt || Date.now()) - windowMs);
        
        try {
            // Check for deleted channels not already restored
            const channelLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelDelete,
                limit: 50
            }).catch(() => null);
            
            if (channelLogs) {
                for (const entry of channelLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    const channelId = entry.target?.id;
                    // Check if already exists (was restored or never deleted)
                    if (guild.channels.cache.has(channelId)) continue;
                    
                    // Try to restore
                    const snapshot = this.channelSnapshots.get(guild.id)?.get(channelId);
                    if (snapshot) {
                        const canRestore = this.canRestoreChannel(guild, snapshot);
                        if (canRestore.can) {
                            await this.restoreChannelFromSnapshot(guild, snapshot, incident);
                            this.recordRestoration(incident, 'channel', channelId, snapshot.name, 'memory', true);
                        }
                    }
                    await this.sleep(300);
                }
            }
            
            // Check for deleted roles
            const roleLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.RoleDelete,
                limit: 50
            }).catch(() => null);
            
            if (roleLogs) {
                for (const entry of roleLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    const roleId = entry.target?.id;
                    // Check if already exists
                    if (guild.roles.cache.has(roleId)) continue;
                    
                    const snapshot = this.roleSnapshots.get(guild.id)?.get(roleId);
                    if (snapshot) {
                        const canRestore = this.canRestoreRole(guild, snapshot);
                        if (canRestore.can) {
                            await this.restoreRoleFromSnapshot(guild, snapshot, incident);
                            this.recordRestoration(incident, 'role', roleId, snapshot.name, 'memory', true);
                        }
                    }
                    await this.sleep(300);
                }
            }
            
            // Check for bans (unban victims)
            const banLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 50
            }).catch(() => null);
            
            if (banLogs) {
                for (const entry of banLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    try {
                        await guild.members.unban(entry.target?.id, `Anti-nuke sweep [${incident.id}]`);
                        this.recordAction(incident, 'unban_sweep', entry.target?.id, true);
                    } catch (e) {
                        // Already unbanned or can't unban
                    }
                    await this.sleep(300);
                }
            }
            
        } catch (e) {
            this.bot.logger.error('Anti-nuke sweep failed:', e);
            this.addWarning(incident, `Sweep failed: ${e.message}`);
        }
    }

    /**
     * Restore damage using live snapshots (legacy method)
     */
    async restoreDamage(guild, violation, attackerId) {
        const guildId = guild.id;
        const results = {
            channelsRestored: 0,
            rolesRestored: 0,
            usersUnbanned: 0,
            webhooksDeleted: 0,
            errors: []
        };
        
        const actions = violation.actions || [];
        
        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'channelDelete':
                        // RESTORE from snapshot!
                        const restored = await this.restoreChannel(guild, action.details.channelId);
                        if (restored) results.channelsRestored++;
                        break;
                        
                    case 'channelCreate':
                        // Delete malicious channels
                        const channel = guild.channels.cache.get(action.details.channelId);
                        if (channel) {
                            await channel.delete('Anti-nuke: Reverting mass channel creation');
                            results.channelsRestored++;
                        }
                        break;
                        
                    case 'roleDelete':
                        // Restore role from snapshot
                        const roleRestored = await this.restoreRole(guild, action.details.roleId);
                        if (roleRestored) results.rolesRestored++;
                        break;
                        
                    case 'roleCreate':
                        // Delete malicious roles
                        const role = guild.roles.cache.get(action.details.roleId);
                        if (role && role.editable) {
                            await role.delete('Anti-nuke: Reverting mass role creation');
                            results.rolesRestored++;
                        }
                        break;
                        
                    case 'banAdd':
                        // Unban victims
                        if (action.details.targetId) {
                            await guild.members.unban(action.details.targetId, 'Anti-nuke: Reverting mass ban');
                            results.usersUnbanned++;
                        }
                        break;
                        
                    case 'webhookCreate':
                        // Delete malicious webhooks
                        const webhooks = await guild.fetchWebhooks().catch(() => null);
                        if (webhooks) {
                            const wh = webhooks.get(action.details.webhookId);
                            if (wh) {
                                await wh.delete('Anti-nuke: Removing malicious webhook');
                                results.webhooksDeleted++;
                            }
                        }
                        break;
                }
                
                await this.sleep(200); // Rate limit protection
            } catch (e) {
                results.errors.push(`Failed ${action.type}: ${e.message}`);
            }
        }
        
        // Also do a sweep for any other damage by this attacker
        await this.sweepAttackerDamage(guild, attackerId, violation.detectedAt);
        
        return results;
    }

    /**
     * Restore a deleted channel from snapshot
     */
    async restoreChannel(guild, channelId) {
        const guildId = guild.id;
        const snapshot = this.channelSnapshots.get(guildId)?.get(channelId);
        
        if (!snapshot) {
            this.bot.logger.warn(`No snapshot found for channel ${channelId}`);
            // Try to restore from server backup system
            return await this.restoreChannelFromBackup(guild, channelId);
        }
        
        this.bot.logger.info(`🔧 Restoring channel: ${snapshot.name} (${channelId})`);
        
        try {
            // Determine parent category
            let parent = null;
            if (snapshot.parentId) {
                parent = guild.channels.cache.get(snapshot.parentId);
            }
            
            // Build permission overwrites
            const permissionOverwrites = [];
            for (const ow of snapshot.permissionOverwrites || []) {
                // Only add if the target still exists
                if (guild.roles.cache.has(ow.id) || guild.members.cache.has(ow.id) || ow.id === guildId) {
                    permissionOverwrites.push({
                        id: ow.id,
                        type: ow.type,
                        allow: BigInt(ow.allow),
                        deny: BigInt(ow.deny)
                    });
                }
            }
            
            // Create the channel
            const options = {
                name: snapshot.name,
                type: snapshot.type,
                parent: parent,
                position: snapshot.position,
                topic: snapshot.topic,
                nsfw: snapshot.nsfw,
                rateLimitPerUser: snapshot.rateLimitPerUser,
                permissionOverwrites,
                reason: 'Anti-nuke: Restoring deleted channel'
            };
            
            // Voice channel properties
            if (snapshot.type === ChannelType.GuildVoice || snapshot.type === ChannelType.GuildStageVoice) {
                options.bitrate = snapshot.bitrate;
                options.userLimit = snapshot.userLimit;
                options.rtcRegion = snapshot.rtcRegion;
            }
            
            const newChannel = await guild.channels.create(options);
            
            // Update snapshot with new ID
            this.channelSnapshots.get(guildId).delete(channelId);
            this.updateChannelSnapshot(newChannel);
            
            this.bot.logger.info(`✅ Channel restored: ${newChannel.name} (${newChannel.id})`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore channel ${channelId}:`, e);
            return false;
        }
    }

    /**
     * Try to restore channel from server backup system
     */
    async restoreChannelFromBackup(guild, channelId) {
        if (!this.bot.serverBackup) return false;
        
        try {
            // Get most recent backup
            const backups = await this.bot.serverBackup.listBackups(guild.id);
            if (!backups || backups.length === 0) return false;
            
            const latestBackup = await this.bot.serverBackup.getBackupData(backups[0].id);
            if (!latestBackup?.data?.channels) return false;
            
            // Find the channel in backup
            const channelData = latestBackup.data.channels.channels?.find(c => c.id === channelId);
            if (!channelData) return false;
            
            this.bot.logger.info(`🔧 Restoring channel from backup: ${channelData.name}`);
            
            // Find parent category
            let parent = null;
            if (channelData.parentId) {
                parent = guild.channels.cache.get(channelData.parentId);
                if (!parent && channelData.parent) {
                    // Try to find by name
                    parent = guild.channels.cache.find(c => 
                        c.type === ChannelType.GuildCategory && c.name === channelData.parent
                    );
                }
            }
            
            // Build permission overwrites
            const permissionOverwrites = [];
            for (const ow of channelData.permissionOverwrites || []) {
                // Try to find role by name if ID doesn't exist
                let targetId = ow.id;
                if (ow.type === 0 && ow.roleName) {
                    const role = guild.roles.cache.find(r => r.name === ow.roleName);
                    if (role) targetId = role.id;
                }
                
                if (guild.roles.cache.has(targetId) || guild.members.cache.has(targetId) || targetId === guild.id) {
                    permissionOverwrites.push({
                        id: targetId,
                        type: ow.type,
                        allow: BigInt(ow.allow),
                        deny: BigInt(ow.deny)
                    });
                }
            }
            
            const options = {
                name: channelData.name,
                type: channelData.type,
                parent,
                topic: channelData.topic,
                nsfw: channelData.nsfw,
                rateLimitPerUser: channelData.rateLimitPerUser,
                permissionOverwrites,
                reason: 'Anti-nuke: Restoring from backup'
            };
            
            if (channelData.type === ChannelType.GuildVoice || channelData.type === ChannelType.GuildStageVoice) {
                options.bitrate = channelData.bitrate;
                options.userLimit = channelData.userLimit;
            }
            
            const newChannel = await guild.channels.create(options);
            this.updateChannelSnapshot(newChannel);
            
            this.bot.logger.info(`✅ Channel restored from backup: ${newChannel.name}`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore channel from backup:`, e);
            return false;
        }
    }

    /**
     * Restore a deleted role from snapshot
     */
    async restoreRole(guild, roleId) {
        const guildId = guild.id;
        const snapshot = this.roleSnapshots.get(guildId)?.get(roleId);
        
        if (!snapshot) {
            this.bot.logger.warn(`No snapshot found for role ${roleId}`);
            // Try to restore from server backup system
            return await this.restoreRoleFromBackup(guild, roleId);
        }
        
        this.bot.logger.info(`🔧 Restoring role: ${snapshot.name}`);
        
        try {
            const newRole = await guild.roles.create({
                name: snapshot.name,
                color: snapshot.color,
                hoist: snapshot.hoist,
                permissions: BigInt(snapshot.permissions),
                mentionable: snapshot.mentionable,
                reason: 'Anti-nuke: Restoring deleted role'
            });
            
            // Update snapshot
            this.roleSnapshots.get(guildId).delete(roleId);
            this.updateRoleSnapshot(newRole);
            
            this.bot.logger.info(`✅ Role restored: ${newRole.name} (${newRole.id})`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore role ${roleId}:`, e);
            return false;
        }
    }

    /**
     * Try to restore role from server backup system (DB)
     */
    async restoreRoleFromBackup(guild, roleId) {
        if (!this.bot.serverBackup) return false;
        
        try {
            // Get most recent backup from database
            const backups = await this.bot.serverBackup.listBackups(guild.id);
            if (!backups || backups.length === 0) return false;
            
            const latestBackup = await this.bot.serverBackup.getBackupData(backups[0].id);
            if (!latestBackup?.data?.roles) return false;
            
            // Find the role in backup
            const roleData = latestBackup.data.roles.find(r => r.id === roleId);
            if (!roleData) return false;
            
            this.bot.logger.info(`🔧 Restoring role from DB backup: ${roleData.name}`);
            
            const newRole = await guild.roles.create({
                name: roleData.name,
                color: roleData.color,
                hoist: roleData.hoist,
                permissions: BigInt(roleData.permissions),
                mentionable: roleData.mentionable,
                reason: 'Anti-nuke: Restoring from backup'
            });
            
            this.updateRoleSnapshot(newRole);
            
            this.bot.logger.info(`✅ Role restored from backup: ${newRole.name}`);
            return true;
        } catch (e) {
            this.bot.logger.error(`Failed to restore role from backup:`, e);
            return false;
        }
    }

    /**
     * Sweep for additional damage by attacker via audit logs
     */
    async sweepAttackerDamage(guild, attackerId, detectedAt) {
        const windowMs = 5 * 60 * 1000; // Look back 5 minutes
        const cutoff = Math.max(0, (detectedAt || Date.now()) - windowMs);
        const guildId = guild.id;
        
        // Get list of original channel IDs from snapshots
        const originalChannelIds = new Set(this.channelSnapshots.get(guildId)?.keys() || []);
        
        try {
            // Check for deleted channels (restore them)
            const channelLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelDelete,
                limit: 50
            }).catch(() => null);
            
            if (channelLogs) {
                for (const entry of channelLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    await this.restoreChannel(guild, entry.target?.id);
                    await this.sleep(300);
                }
            }
            
            // Check for deleted roles (restore them)
            const roleLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.RoleDelete,
                limit: 50
            }).catch(() => null);
            
            if (roleLogs) {
                for (const entry of roleLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    await this.restoreRole(guild, entry.target?.id);
                    await this.sleep(300);
                }
            }
            
            // Check for created channels (delete them if not in original snapshot)
            const createChannelLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelCreate,
                limit: 100
            }).catch(() => null);
            
            if (createChannelLogs) {
                for (const entry of createChannelLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    const channelId = entry.target?.id;
                    const channel = guild.channels.cache.get(channelId);
                    
                    // Only delete if it wasn't in our original snapshot
                    if (channel && !originalChannelIds.has(channelId)) {
                        try {
                            await channel.delete('Anti-nuke sweep: Removing malicious channel');
                            this.bot.logger.info(`🗑️ Sweep deleted malicious channel: ${channel.name}`);
                        } catch (e) {
                            this.bot.logger.warn(`Failed to delete channel ${channel.name}: ${e.message}`);
                        }
                        await this.sleep(300);
                    }
                }
            }
            
            // Check for bans (unban victims)
            const banLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 50
            }).catch(() => null);
            
            if (banLogs) {
                for (const entry of banLogs.entries.values()) {
                    if (entry.executor?.id !== attackerId) continue;
                    if (entry.createdTimestamp < cutoff) continue;
                    
                    await guild.members.unban(entry.target?.id, 'Anti-nuke sweep').catch(() => {});
                    await this.sleep(300);
                }
            }
            
            // Final step: Reorder channels to match original positions
            await this.reorderChannelsAfterSweep(guild);
            
        } catch (e) {
            this.bot.logger.error('Anti-nuke sweep failed:', e);
        }
    }
    
    /**
     * Reorder channels after sweep to match original snapshot positions
     */
    async reorderChannelsAfterSweep(guild) {
        const guildId = guild.id;
        const snapshots = this.channelSnapshots.get(guildId);
        
        if (!snapshots || snapshots.size === 0) return;
        
        try {
            // Build category ordering
            const categories = [];
            const channelsByParent = new Map();
            
            for (const [channelId, snapshot] of snapshots) {
                const currentChannel = guild.channels.cache.find(c => c.name === snapshot.name && c.type === snapshot.type);
                if (!currentChannel) continue;
                
                if (snapshot.type === ChannelType.GuildCategory) {
                    categories.push({
                        id: currentChannel.id,
                        position: snapshot.position,
                        name: snapshot.name
                    });
                } else {
                    const parentKey = snapshot.parentId || 'root';
                    if (!channelsByParent.has(parentKey)) {
                        channelsByParent.set(parentKey, []);
                    }
                    
                    // Find the actual parent in the current guild
                    let actualParentId = null;
                    if (snapshot.parentId) {
                        const parentSnapshot = snapshots.get(snapshot.parentId);
                        if (parentSnapshot) {
                            const parentChannel = guild.channels.cache.find(c => 
                                c.name === parentSnapshot.name && c.type === ChannelType.GuildCategory
                            );
                            if (parentChannel) {
                                actualParentId = parentChannel.id;
                            }
                        }
                    }
                    
                    channelsByParent.get(parentKey).push({
                        id: currentChannel.id,
                        position: snapshot.position,
                        name: snapshot.name,
                        actualParentId
                    });
                }
            }
            
            // Sort and set category positions
            categories.sort((a, b) => a.position - b.position);
            if (categories.length > 0) {
                const categoryPositions = categories.map((cat, index) => ({
                    channel: cat.id,
                    position: index
                }));
                await guild.channels.setPositions(categoryPositions).catch(e => 
                    this.bot.logger.warn(`Failed to reorder categories: ${e.message}`)
                );
                await this.sleep(500);
            }
            
            // Sort and set channel positions within categories
            for (const [parentKey, channels] of channelsByParent) {
                channels.sort((a, b) => a.position - b.position);
                
                // Set parent for each channel if needed
                for (const ch of channels) {
                    const channel = guild.channels.cache.get(ch.id);
                    if (!channel) continue;
                    
                    if (ch.actualParentId && channel.parentId !== ch.actualParentId) {
                        try {
                            await channel.setParent(ch.actualParentId, { lockPermissions: false });
                            await this.sleep(200);
                        } catch (e) {
                            // Ignore parent setting errors
                        }
                    }
                }
                
                // Set positions
                const positionUpdates = channels.map((ch, index) => ({
                    channel: ch.id,
                    position: index,
                    parent: ch.actualParentId || null
                }));
                
                if (positionUpdates.length > 0) {
                    await guild.channels.setPositions(positionUpdates).catch(e => 
                        this.bot.logger.warn(`Failed to reorder channels: ${e.message}`)
                    );
                    await this.sleep(300);
                }
            }
            
            this.bot.logger.info(`[AntiNuke] Channel reordering after sweep complete`);
            
        } catch (e) {
            this.bot.logger.error('[AntiNuke] Channel reordering after sweep failed:', e);
        }
    }

    // ========================================
    // LOGGING & NOTIFICATIONS
    // ========================================

    async logIncident(guild, userId, violation, results) {
        try {
            this.bot.logger.info(`[AntiNuke] Logging incident to security_incidents table...`);
            const user = await this.bot.client.users.fetch(userId).catch(() => ({ tag: userId, id: userId }));
            
            await this.bot.database.run(`
                INSERT INTO security_incidents 
                (guild_id, incident_type, severity, user_id, description, data)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                guild.id,
                'ANTI_NUKE_VIOLATION',
                'CRITICAL',
                userId,
                `User ${user.tag} performed ${violation.count} ${violation.actionType} actions in ${violation.window/1000}s`,
                JSON.stringify({
                    violation,
                    results,
                    timestamp: new Date().toISOString()
                })
            ]);
            
            this.bot.logger.info(`[AntiNuke] ✅ Incident logged to security_incidents successfully`);
        } catch (e) {
            this.bot.logger.error('[AntiNuke] ❌ Failed to log incident to security_incidents:', e);
        }
    }

    async notifyModerators(guild, userId, violation, results) {
        try {
            const config = await this.bot.database.getGuildConfig(guild.id);
            const logChannelId = config?.log_channel_id || config?.alert_channel;
            
            let logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
            if (!logChannel) {
                logChannel = guild.channels.cache.find(c => 
                    c.name.toLowerCase().includes('log') && c.isTextBased()
                );
            }
            
            if (!logChannel) return;
            
            const user = await this.bot.client.users.fetch(userId).catch(() => ({ tag: userId, id: userId }));
            const incident = results.incident;
            
            const embed = {
                title: '🚨 ANTI-NUKE ALERT - SERVER PROTECTED',
                description: `**Attack detected and neutralized!**\n\n` +
                    `An attacker attempted to damage this server but was stopped.\n` +
                    (incident ? `**Incident ID:** \`${incident.id}\`` : ''),
                color: 0xff0000,
                fields: [
                    {
                        name: '👤 Attacker',
                        value: `${user.tag}\n<@${userId}>\nID: \`${userId}\``,
                        inline: true
                    },
                    {
                        name: '⚠️ Attack Type',
                        value: `**${violation.actionType}**\n${violation.count} actions in ${violation.window/1000}s\nLimit: ${violation.limit}`,
                        inline: true
                    },
                    {
                        name: '⏱️ Response Time',
                        value: `${results.responseTime}ms`,
                        inline: true
                    },
                    {
                        name: '🛡️ Actions Taken',
                        value: results.neutralize?.actions?.join('\n') || 'User neutralized',
                        inline: false
                    },
                    {
                        name: '🔧 Restoration',
                        value: [
                            results.restore?.channelsRestored ? `✅ ${results.restore.channelsRestored} channels restored` : null,
                            results.restore?.channelsDeleted ? `🗑️ ${results.restore.channelsDeleted} malicious channels deleted` : null,
                            results.restore?.rolesRestored ? `✅ ${results.restore.rolesRestored} roles restored` : null,
                            results.restore?.usersUnbanned ? `✅ ${results.restore.usersUnbanned} users unbanned` : null,
                            results.restore?.webhooksDeleted ? `✅ ${results.restore.webhooksDeleted} webhooks deleted` : null,
                            results.restore?.itemsSkipped ? `⏭️ ${results.restore.itemsSkipped} items skipped` : null,
                            results.quarantine?.rolesModified ? `🔒 ${results.quarantine.rolesModified} roles quarantined` : null,
                            '📐 Channel positions restored'
                        ].filter(Boolean).join('\n') || 'No restoration needed',
                        inline: true
                    },
                    {
                        name: '📊 Restore Source',
                        value: results.restore?.source ? 
                            (results.restore.source === 'memory' ? '💾 Live Snapshots' : 
                             results.restore.source === 'database' ? '🗄️ Database Backup' : 
                             '🔀 Mixed Sources') : 'N/A',
                        inline: true
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'Anti-Nuke Protection System v2.1' }
            };
            
            // Add incident details if available
            if (incident) {
                const warningCount = incident.warnings?.length || 0;
                if (warningCount > 0) {
                    embed.fields.push({
                        name: '⚠️ Warnings',
                        value: incident.warnings.slice(0, 3).map(w => w.message).join('\n') +
                            (warningCount > 3 ? `\n...and ${warningCount - 3} more` : ''),
                        inline: false
                    });
                }
                
                if (incident.backupAge) {
                    embed.fields.push({
                        name: '📦 Backup Info',
                        value: `Age: ${this.formatAge(incident.backupAge)}\nID: \`${incident.backupId || 'N/A'}\``,
                        inline: true
                    });
                }
            }
            
            // Add quarantine notice if active
            if (this.quarantineMode.get(guild.id)?.active) {
                embed.fields.push({
                    name: '⚠️ QUARANTINE ACTIVE',
                    value: 'Dangerous permissions have been temporarily removed from all roles.\n' +
                        'Use `/antinuke quarantine disable` to restore permissions when safe.',
                    inline: false
                });
            }
            
            await logChannel.send({
                content: config?.mod_role_id ? `<@&${config.mod_role_id}>` : '@here',
                embeds: [embed]
            });
            
        } catch (e) {
            this.bot.logger.error('Failed to notify moderators:', e);
        }
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    cleanupOldEntries() {
        const now = Date.now();
        const maxWindow = Math.max(...Object.values(this.thresholds).map(t => t.window));
        
        for (const [, guildTracking] of this.actionTracking) {
            for (const [userId, actions] of guildTracking) {
                const recent = actions.filter(a => now - a.timestamp <= maxWindow);
                if (recent.length === 0) {
                    guildTracking.delete(userId);
                } else {
                    guildTracking.set(userId, recent);
                }
            }
        }
        
        // Cleanup punishment cooldowns
        for (const [, punishedMap] of this.punishedUsers) {
            for (const [userId, timestamp] of punishedMap) {
                if (now - timestamp >= this.punishmentCooldown) {
                    punishedMap.delete(userId);
                }
            }
        }
        
        // Cleanup blocked users after 30 minutes
        for (const [guildId, blockedSet] of this.blockedUsers) {
            if (!this.quarantineMode.get(guildId)?.active) {
                // Only clear if not in quarantine
                for (const userId of blockedSet) {
                    const punishTime = this.punishedUsers.get(guildId)?.get(userId);
                    if (!punishTime || now - punishTime >= 30 * 60 * 1000) {
                        blockedSet.delete(userId);
                    }
                }
            }
        }
    }

    async whitelistUser(guildId, userId) {
        if (!this.whitelistedUsers.has(guildId)) {
            this.whitelistedUsers.set(guildId, new Set());
        }
        this.whitelistedUsers.get(guildId).add(userId);
        this.bot.logger.info(`Anti-nuke: Whitelisted user ${userId} in guild ${guildId}`);
    }

    async unwhitelistUser(guildId, userId) {
        this.whitelistedUsers.get(guildId)?.delete(userId);
        this.bot.logger.info(`Anti-nuke: Removed whitelist for user ${userId} in guild ${guildId}`);
    }

    isWhitelisted(guildId, userId) {
        return this.whitelistedUsers.get(guildId)?.has(userId) || false;
    }

    isInQuarantine(guildId) {
        return this.quarantineMode.get(guildId)?.active || false;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Legacy compatibility
    async initialize(guildId) {
        const guild = this.bot.client.guilds.cache.get(guildId);
        if (guild) {
            await this.initializeGuild(guild);
        }
    }

    hasBotPermissions(guild, perms = []) {
        try {
            const botMember = guild?.members?.me;
            if (!botMember) return false;
            return botMember.permissions?.has?.(perms) || false;
        } catch (e) {
            return false;
        }
    }
}

module.exports = AntiNuke;
