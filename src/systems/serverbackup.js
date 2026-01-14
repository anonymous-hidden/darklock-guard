/**
 * Server Backup/Restore System
 * Full backup of server settings, roles, channels, and configurations
 * 
 * Enhanced Features:
 * - Complete role capture with hierarchy, colors, permissions
 * - Full channel capture with types, categories, positions, permissions
 * - Server settings (name, icon, verification level)
 * - Validation before restore
 * - Fail-safe restore with detailed logging
 * - Duplicate backup prevention
 * - SHA-256 integrity hash verification (v2.1)
 */

const { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ServerBackupSystem {
    constructor(bot) {
        this.bot = bot;
        this.db = bot.database.db;
        this.backupDir = path.join(process.cwd(), 'data', 'backups');
        this.restoreInProgress = new Set(); // Track guilds with active restores
    }

    async initialize() {
        await this.ensureBackupDir();
        await this.ensureTables();
        this.bot.logger.info('ServerBackupSystem initialized');
    }

    async ensureBackupDir() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
        } catch (error) {
            // Directory exists
        }
    }

    async ensureTables() {
        // First, check and migrate table schema if needed
        await this.migrateServerBackupsTable();
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                // Backup metadata with version tracking
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS server_backups (
                        id TEXT PRIMARY KEY,
                        guild_id TEXT NOT NULL,
                        backup_type TEXT DEFAULT 'manual',
                        created_by TEXT,
                        description TEXT,
                        size_bytes INTEGER,
                        includes TEXT,
                        version INTEGER DEFAULT 2,
                        checksum TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);

                // Backup config
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS backup_config (
                        guild_id TEXT PRIMARY KEY,
                        auto_backup_enabled INTEGER DEFAULT 0,
                        auto_backup_interval_hours INTEGER DEFAULT 24,
                        max_backups INTEGER DEFAULT 5,
                        backup_roles INTEGER DEFAULT 1,
                        backup_channels INTEGER DEFAULT 1,
                        backup_settings INTEGER DEFAULT 1,
                        backup_bans INTEGER DEFAULT 0,
                        last_auto_backup DATETIME,
                        prevent_duplicates INTEGER DEFAULT 1
                    )
                `, (err) => {
                    if (err) reject(err);
                    else resolve();
                });

                // Indexes
                this.db.run(`CREATE INDEX IF NOT EXISTS idx_backups_guild ON server_backups(guild_id)`);
            });
        });
    }

    // Migrate server_backups table to correct schema (TEXT id instead of INTEGER)
    async migrateServerBackupsTable() {
        return new Promise((resolve) => {
            // Check if table exists and has wrong schema
            this.db.get(`PRAGMA table_info(server_backups)`, [], (err, row) => {
                if (err || !row) {
                    // Table doesn't exist or error - let it be created fresh
                    resolve();
                    return;
                }
                
                // Get full schema info
                this.db.all(`PRAGMA table_info(server_backups)`, [], (err, columns) => {
                    if (err || !columns || columns.length === 0) {
                        resolve();
                        return;
                    }
                    
                    // Find the id column
                    const idColumn = columns.find(col => col.name === 'id');
                    
                    // Check if id is INTEGER type (wrong) - should be TEXT
                    if (idColumn && idColumn.type.toUpperCase() === 'INTEGER') {
                        this.bot.logger.warn('[ServerBackup] Detected INTEGER id column - migrating to TEXT');
                        
                        this.db.serialize(() => {
                            this.db.run('BEGIN TRANSACTION');
                            
                            // Create new table with correct schema
                            this.db.run(`
                                CREATE TABLE IF NOT EXISTS server_backups_new (
                                    id TEXT PRIMARY KEY,
                                    guild_id TEXT NOT NULL,
                                    backup_type TEXT DEFAULT 'manual',
                                    created_by TEXT,
                                    description TEXT,
                                    size_bytes INTEGER,
                                    includes TEXT,
                                    version INTEGER DEFAULT 2,
                                    checksum TEXT,
                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                )
                            `);
                            
                            // Copy existing data, casting id to TEXT
                            this.db.run(`
                                INSERT OR IGNORE INTO server_backups_new 
                                    (id, guild_id, backup_type, created_by, description, size_bytes, includes, version, checksum, created_at)
                                SELECT 
                                    CAST(id AS TEXT), 
                                    guild_id, 
                                    COALESCE(backup_type, 'manual'), 
                                    created_by, 
                                    description, 
                                    size_bytes, 
                                    includes, 
                                    COALESCE(version, 2), 
                                    checksum, 
                                    created_at
                                FROM server_backups
                            `);
                            
                            // Drop old table
                            this.db.run('DROP TABLE IF EXISTS server_backups');
                            
                            // Rename new table
                            this.db.run('ALTER TABLE server_backups_new RENAME TO server_backups', (err) => {
                                if (err) {
                                    this.db.run('ROLLBACK');
                                    this.bot.logger.error('[ServerBackup] Migration failed:', err.message);
                                } else {
                                    this.db.run('COMMIT');
                                    this.bot.logger.info('[ServerBackup] Successfully migrated server_backups table to TEXT id');
                                }
                                resolve();
                            });
                        });
                    } else {
                        // Schema is correct
                        resolve();
                    }
                });
            });
        });
    }

    // Generate unique backup ID
    generateBackupId() {
        return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Get config for guild
    async getConfig(guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM backup_config WHERE guild_id = ?',
                [guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }

    // Setup backup config
    async setup(guildId, settings = {}) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO backup_config (guild_id, auto_backup_enabled, auto_backup_interval_hours, max_backups)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(guild_id) DO UPDATE SET
                    auto_backup_enabled = ?,
                    auto_backup_interval_hours = ?,
                    max_backups = ?`,
                [guildId, settings.autoEnabled ? 1 : 0, settings.interval || 24, settings.maxBackups || 5,
                 settings.autoEnabled ? 1 : 0, settings.interval || 24, settings.maxBackups || 5],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // Create a full backup
    async createBackup(guildId, options = {}) {
        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return { success: false, error: 'Guild not found' };

        const backupId = this.generateBackupId();
        const backupData = {
            id: backupId,
            guildId,
            guildName: guild.name,
            guildIcon: guild.iconURL(),
            createdAt: new Date().toISOString(),
            createdBy: options.createdBy,
            type: options.type || 'manual',
            data: {}
        };

        // Backup roles
        if (options.includeRoles !== false) {
            backupData.data.roles = await this.backupRoles(guild);
        }

        // Backup channels
        if (options.includeChannels !== false) {
            backupData.data.channels = await this.backupChannels(guild);
        }

        // Backup guild settings
        if (options.includeSettings !== false) {
            backupData.data.settings = await this.backupSettings(guild);
        }

        // Backup bans (if enabled)
        if (options.includeBans) {
            backupData.data.bans = await this.backupBans(guild);
        }

        // Backup emojis
        if (options.includeEmojis !== false) {
            backupData.data.emojis = await this.backupEmojis(guild);
        }

        // Save to file
        const filePath = path.join(this.backupDir, `${backupId}.json`);
        const dataString = JSON.stringify(backupData, null, 2);
        
        // Generate SHA-256 integrity hash
        const checksum = this.generateChecksum(dataString);
        backupData.checksum = checksum;
        
        // Re-stringify with checksum included
        const finalDataString = JSON.stringify(backupData, null, 2);
        await fs.writeFile(filePath, finalDataString);

        // Save metadata to database with checksum
        const includes = [];
        if (backupData.data.roles) includes.push('roles');
        if (backupData.data.channels) includes.push('channels');
        if (backupData.data.settings) includes.push('settings');
        if (backupData.data.bans) includes.push('bans');
        if (backupData.data.emojis) includes.push('emojis');

        try {
            await new Promise((resolve, reject) => {
                this.db.run(
                    `INSERT INTO server_backups (id, guild_id, backup_type, created_by, description, size_bytes, includes, checksum)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [String(backupId), String(guildId), options.type || 'manual', options.createdBy || null, 
                     options.description || null, finalDataString.length, includes.join(','), checksum],
                    function(err) {
                        if (err) {
                            // If we get SQLITE_MISMATCH, the table schema might be wrong
                            if (err.message && err.message.includes('SQLITE_MISMATCH')) {
                                reject(new Error('Database schema mismatch - please restart the bot to run migrations'));
                            } else {
                                reject(err);
                            }
                        } else {
                            resolve(this.lastID);
                        }
                    }
                );
            });
        } catch (dbError) {
            // Delete the file we created since DB insert failed
            try {
                await fs.unlink(filePath);
            } catch (e) {
                // Ignore file deletion error
            }
            this.bot.logger.error(`[ServerBackup] Database error creating backup: ${dbError.message}`);
            return { success: false, error: dbError.message };
        }

        // Update last auto backup time
        if (options.type === 'auto') {
            await new Promise((resolve, reject) => {
                this.db.run(
                    'UPDATE backup_config SET last_auto_backup = CURRENT_TIMESTAMP WHERE guild_id = ?',
                    [guildId],
                    (err) => err ? reject(err) : resolve()
                );
            });
        }

        // Cleanup old backups
        await this.cleanupOldBackups(guildId);

        return { 
            success: true, 
            backupId, 
            includes,
            size: finalDataString.length,
            checksum
        };
    }

    // Backup roles with full details (hierarchy, colors, permissions)
    async backupRoles(guild) {
        const roles = [];
        const botRole = guild.members.me?.roles.highest;
        
        for (const [id, role] of guild.roles.cache) {
            // Skip @everyone and bot-managed roles
            if (role.managed || role.id === guild.id) continue;
            
            roles.push({
                id: role.id,  // Store ID for reference
                name: role.name,
                color: role.color,
                hexColor: role.hexColor,
                hoist: role.hoist,
                position: role.position,
                rawPosition: role.rawPosition,
                permissions: role.permissions.bitfield.toString(),
                mentionable: role.mentionable,
                icon: role.iconURL(),
                unicodeEmoji: role.unicodeEmoji,
                // Flag if role is above bot (can't be restored)
                aboveBot: botRole ? role.position >= botRole.position : false
            });
        }

        // Sort by position descending (highest first) for correct hierarchy restore
        return roles.sort((a, b) => b.position - a.position);
    }

    // Backup channels with full details (types, categories, positions, permissions)
    async backupChannels(guild) {
        const channels = [];
        const categories = [];

        // First, collect categories
        for (const [, channel] of guild.channels.cache) {
            if (channel.type === ChannelType.GuildCategory) {
                categories.push({
                    id: channel.id,
                    name: channel.name,
                    position: channel.position,
                    rawPosition: channel.rawPosition,
                    permissionOverwrites: this.serializePermissionOverwrites(channel, guild)
                });
            }
        }

        // Sort categories by position
        categories.sort((a, b) => a.position - b.position);

        // Then collect other channels
        for (const [, channel] of guild.channels.cache) {
            if (channel.type === ChannelType.GuildCategory) continue;
            
            const channelData = {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                rawPosition: channel.rawPosition,
                parentId: channel.parentId,
                parent: channel.parent?.name || null,
                topic: channel.topic || null,
                nsfw: channel.nsfw || false,
                rateLimitPerUser: channel.rateLimitPerUser || 0,
                defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration,
                permissionOverwrites: this.serializePermissionOverwrites(channel, guild)
            };

            // Voice channel specific properties
            if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
                channelData.bitrate = channel.bitrate;
                channelData.userLimit = channel.userLimit;
                channelData.rtcRegion = channel.rtcRegion;
                channelData.videoQualityMode = channel.videoQualityMode;
            }

            // Forum channel specific properties
            if (channel.type === ChannelType.GuildForum) {
                channelData.defaultReactionEmoji = channel.defaultReactionEmoji;
                channelData.defaultSortOrder = channel.defaultSortOrder;
                channelData.defaultForumLayout = channel.defaultForumLayout;
                channelData.availableTags = channel.availableTags?.map(tag => ({
                    name: tag.name,
                    moderated: tag.moderated,
                    emoji: tag.emoji
                }));
            }

            channels.push(channelData);
        }

        // Sort channels by position within their categories
        channels.sort((a, b) => a.position - b.position);

        return { categories, channels };
    }

    // Serialize permission overwrites with role name resolution
    serializePermissionOverwrites(channel, guild) {
        const overwrites = [];
        
        for (const [, overwrite] of channel.permissionOverwrites.cache) {
            const role = overwrite.type === 0 ? guild.roles.cache.get(overwrite.id) : null;
            overwrites.push({
                id: overwrite.id,
                type: overwrite.type, // 0 = role, 1 = member
                roleName: role?.name || null, // Store role name for matching during restore
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString()
            });
        }

        return overwrites;
    }

    // Backup guild settings
    async backupSettings(guild) {
        return {
            name: guild.name,
            icon: guild.iconURL(),
            splash: guild.splashURL(),
            banner: guild.bannerURL(),
            description: guild.description,
            verificationLevel: guild.verificationLevel,
            explicitContentFilter: guild.explicitContentFilter,
            defaultMessageNotifications: guild.defaultMessageNotifications,
            systemChannel: guild.systemChannel?.name || null,
            rulesChannel: guild.rulesChannel?.name || null,
            publicUpdatesChannel: guild.publicUpdatesChannel?.name || null,
            afkChannel: guild.afkChannel?.name || null,
            afkTimeout: guild.afkTimeout
        };
    }

    // Backup bans
    async backupBans(guild) {
        try {
            const bans = await guild.bans.fetch();
            return bans.map(ban => ({
                id: ban.user.id,
                reason: ban.reason
            }));
        } catch (error) {
            return [];
        }
    }

    // Backup emojis
    async backupEmojis(guild) {
        return guild.emojis.cache.map(emoji => ({
            name: emoji.name,
            url: emoji.url
        }));
    }

    // ========================================
    // INTEGRITY HASH SYSTEM (v2.1)
    // ========================================

    /**
     * Generate SHA-256 checksum for backup data
     * @param {string} dataString - JSON string of backup data (without checksum)
     * @returns {string} SHA-256 hash in hex format
     */
    generateChecksum(dataString) {
        return crypto.createHash('sha256').update(dataString, 'utf8').digest('hex');
    }

    /**
     * Verify backup integrity by comparing checksums
     * @param {object} backupData - Parsed backup data from file
     * @param {string} storedChecksum - Checksum from database
     * @returns {object} Verification result { valid, reason, computedHash, storedHash }
     */
    verifyBackupIntegrity(backupData, storedChecksum) {
        if (!storedChecksum) {
            return { 
                valid: true, 
                reason: 'No checksum stored (legacy backup)', 
                legacy: true 
            };
        }

        // Remove checksum from data for recalculation
        const dataWithoutChecksum = { ...backupData };
        delete dataWithoutChecksum.checksum;
        
        const dataString = JSON.stringify(dataWithoutChecksum, null, 2);
        const computedHash = this.generateChecksum(dataString);
        
        const valid = computedHash === storedChecksum;
        
        return {
            valid,
            reason: valid ? 'Integrity verified' : 'Checksum mismatch - possible corruption or tampering',
            computedHash,
            storedHash: storedChecksum,
            embeddedHash: backupData.checksum
        };
    }

    /**
     * Get backup data with integrity verification
     * @param {string} backupId - Backup ID to retrieve
     * @param {boolean} verify - Whether to verify integrity (default: true)
     * @returns {object|null} Backup data with verification result, or null if not found
     */
    async getBackupDataWithVerification(backupId, verify = true) {
        const filePath = path.join(this.backupDir, `${backupId}.json`);
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const backupData = JSON.parse(data);
            
            if (!verify) {
                return { data: backupData, integrity: { valid: true, reason: 'Verification skipped' } };
            }
            
            // Get stored checksum from database
            const metadata = await new Promise((resolve, reject) => {
                this.db.get(
                    'SELECT checksum FROM server_backups WHERE id = ?',
                    [backupId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
            
            const integrity = this.verifyBackupIntegrity(backupData, metadata?.checksum);
            
            return { data: backupData, integrity };
        } catch (error) {
            this.bot.logger.error(`Failed to load backup ${backupId}:`, error);
            return null;
        }
    }

    // Get backup data from file (legacy method - no verification)
    async getBackupData(backupId) {
        const filePath = path.join(this.backupDir, `${backupId}.json`);
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    // List backups for a guild
    async listBackups(guildId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM server_backups WHERE guild_id = ? ORDER BY created_at DESC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    // Delete a backup
    async deleteBackup(backupId, guildId) {
        const filePath = path.join(this.backupDir, `${backupId}.json`);
        
        try {
            await fs.unlink(filePath);
        } catch (error) {
            // File might not exist
        }

        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM server_backups WHERE id = ? AND guild_id = ?',
                [backupId, guildId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // Cleanup old backups
    async cleanupOldBackups(guildId) {
        const config = await this.getConfig(guildId);
        const maxBackups = config?.max_backups || 5;

        const backups = await this.listBackups(guildId);
        
        if (backups.length > maxBackups) {
            const toDelete = backups.slice(maxBackups);
            for (const backup of toDelete) {
                await this.deleteBackup(backup.id, guildId);
            }
        }
    }

    // Restore from backup
    async restoreBackup(guildId, backupId, options = {}) {
        const backup = await this.getBackupData(backupId);
        if (!backup) return { success: false, error: 'Backup not found' };

        const guild = await this.bot.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return { success: false, error: 'Guild not found' };

        const results = {
            roles: { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] },
            channels: { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] },
            settings: { restored: false, error: null },
            logs: []
        };

        // Prevent concurrent restores
        if (this.restoreInProgress.has(guildId)) {
            return { success: false, error: 'A restore is already in progress for this server' };
        }
        this.restoreInProgress.add(guildId);

        try {
            // VALIDATION: Check bot permissions before starting
            const botMember = guild.members.me;
            const requiredPerms = [
                PermissionFlagsBits.ManageRoles,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageGuild
            ];
            
            const missingPerms = requiredPerms.filter(p => !botMember.permissions.has(p));
            if (missingPerms.length > 0) {
                this.restoreInProgress.delete(guildId);
                return { 
                    success: false, 
                    error: `Missing permissions: ${missingPerms.map(p => {
                        const name = Object.keys(PermissionFlagsBits).find(k => PermissionFlagsBits[k] === p);
                        return name || p;
                    }).join(', ')}` 
                };
            }

            results.logs.push(`Starting restore of backup ${backupId}`);
            results.logs.push(`Bot highest role position: ${botMember.roles.highest.position}`);

            // Restore roles first (needed for channel permissions)
            if (options.restoreRoles && backup.data.roles) {
                const roleMap = new Map(); // Map old role names to new roles
                results.logs.push(`Restoring ${backup.data.roles.length} roles...`);
                
                // Process roles from lowest position to highest (reverse order)
                for (const roleData of [...backup.data.roles].reverse()) {
                    try {
                        // Skip roles above bot's highest role
                        if (roleData.aboveBot) {
                            results.logs.push(`⚠️ Skipped role "${roleData.name}" - above bot's highest role`);
                            results.roles.skipped++;
                            continue;
                        }

                        // Check if role already exists by name
                        const existing = guild.roles.cache.find(r => r.name === roleData.name);
                        if (existing) {
                            roleMap.set(roleData.name, existing);
                            roleMap.set(roleData.id, existing); // Map by old ID too
                            
                            // Optionally update existing role if different
                            if (options.updateExisting) {
                                await existing.edit({
                                    color: roleData.color,
                                    hoist: roleData.hoist,
                                    permissions: BigInt(roleData.permissions),
                                    mentionable: roleData.mentionable,
                                    reason: 'Backup restore - updating existing'
                                });
                                results.roles.updated++;
                            } else {
                                results.roles.skipped++;
                            }
                            continue;
                        }

                        const role = await guild.roles.create({
                            name: roleData.name,
                            color: roleData.color,
                            hoist: roleData.hoist,
                            permissions: BigInt(roleData.permissions),
                            mentionable: roleData.mentionable,
                            reason: 'Backup restore'
                        });
                        roleMap.set(roleData.name, role);
                        roleMap.set(roleData.id, role);
                        results.roles.created++;
                        results.logs.push(`✅ Created role "${roleData.name}"`);
                    } catch (error) {
                        results.roles.failed++;
                        results.roles.errors.push(`${roleData.name}: ${error.message}`);
                        results.logs.push(`❌ Failed role "${roleData.name}": ${error.message}`);
                    }
                }
            }

            // Restore channels
            if (options.restoreChannels && backup.data.channels) {
                const categoryMap = new Map();
                const roleMap = new Map();
                
                // Build role map for permission overwrites
                for (const role of guild.roles.cache.values()) {
                    roleMap.set(role.name, role);
                }
                
                results.logs.push(`Restoring ${backup.data.channels.categories?.length || 0} categories...`);
                
                // Create categories first (sorted by position)
                // STEP 1: Create categories FIRST (sorted by position)
                // Wait a bit between each creation to ensure proper ordering
                for (const catData of (backup.data.channels.categories || []).sort((a, b) => a.position - b.position)) {
                    try {
                        // Check for existing category by name (case-insensitive)
                        const existing = guild.channels.cache.find(c => 
                            c.type === ChannelType.GuildCategory && c.name.toLowerCase() === catData.name.toLowerCase()
                        );
                        if (existing) {
                            categoryMap.set(catData.name, existing);
                            categoryMap.set(catData.id, existing);
                            results.channels.skipped++;
                            results.logs.push(`⏭️ Category "${catData.name}" already exists, reusing`);
                            continue;
                        }

                        // Build permission overwrites using role names
                        const permissionOverwrites = this.buildPermissionOverwrites(catData.permissionOverwrites, roleMap, guild);

                        const category = await guild.channels.create({
                            name: catData.name,
                            type: ChannelType.GuildCategory,
                            position: catData.position,
                            permissionOverwrites,
                            reason: 'Backup restore'
                        });
                        categoryMap.set(catData.name, category);
                        categoryMap.set(catData.id, category);
                        results.channels.created++;
                        results.logs.push(`✅ Created category "${catData.name}" at position ${catData.position}`);
                        
                        // Small delay to ensure proper ordering
                        await new Promise(r => setTimeout(r, 200));
                    } catch (error) {
                        results.channels.failed++;
                        results.channels.errors.push(`Category ${catData.name}: ${error.message}`);
                        results.logs.push(`❌ Failed category "${catData.name}": ${error.message}`);
                    }
                }

                results.logs.push(`Restoring ${backup.data.channels.channels?.length || 0} channels...`);
                results.logs.push(`Category map has ${categoryMap.size} entries`);
                
                // Add a delay before creating channels to ensure categories are fully registered
                await new Promise(r => setTimeout(r, 500));

                // STEP 2: Create channels AFTER all categories exist (sorted by position within their category)
                const sortedChannels = (backup.data.channels.channels || []).sort((a, b) => {
                    // First sort by whether they have a parent (parentless first)
                    if (!a.parent && b.parent) return -1;
                    if (a.parent && !b.parent) return 1;
                    // Then by position
                    return a.position - b.position;
                });

                for (const channelData of sortedChannels) {
                    try {
                        // Find parent category - try multiple lookup strategies
                        let parentCategory = null;
                        if (channelData.parent || channelData.parentId) {
                            // First try the category map (by name, then by old ID)
                            parentCategory = categoryMap.get(channelData.parent) || 
                                           categoryMap.get(channelData.parentId);
                            
                            // If not found in map, try to find by name in current guild
                            if (!parentCategory && channelData.parent) {
                                parentCategory = guild.channels.cache.find(c => 
                                    c.type === ChannelType.GuildCategory && 
                                    c.name.toLowerCase() === channelData.parent.toLowerCase()
                                );
                            }
                            
                            if (!parentCategory) {
                                results.logs.push(`⚠️ Parent category "${channelData.parent}" not found for channel "${channelData.name}"`);
                            }
                        }
                        
                        // Check for existing channel by name AND type AND parent category
                        const existing = guild.channels.cache.find(c => {
                            const nameMatch = c.name.toLowerCase() === channelData.name.toLowerCase();
                            const typeMatch = c.type === channelData.type;
                            const parentMatch = parentCategory ? c.parentId === parentCategory.id : !c.parentId;
                            return nameMatch && typeMatch && parentMatch;
                        });

                        if (existing) {
                            results.channels.skipped++;
                            results.logs.push(`⏭️ Channel "${channelData.name}" already exists in correct location`);
                            continue;
                        }

                        // Build permission overwrites using role names
                        const permissionOverwrites = this.buildPermissionOverwrites(channelData.permissionOverwrites, roleMap, guild);

                        const channelOptions = {
                            name: channelData.name,
                            type: channelData.type,
                            topic: channelData.topic,
                            nsfw: channelData.nsfw,
                            rateLimitPerUser: channelData.rateLimitPerUser,
                            parent: parentCategory?.id || null,
                            permissionOverwrites,
                            reason: 'Backup restore'
                        };

                        // Voice channel properties
                        if (channelData.bitrate) channelOptions.bitrate = Math.min(channelData.bitrate, 96000);
                        if (channelData.userLimit !== undefined) channelOptions.userLimit = channelData.userLimit;
                        if (channelData.rtcRegion) channelOptions.rtcRegion = channelData.rtcRegion;

                        await guild.channels.create(channelOptions);
                        results.channels.created++;
                        results.logs.push(`✅ Created channel "${channelData.name}"${parentCategory ? ` in "${parentCategory.name}"` : ''}`);
                        
                        // Small delay to prevent rate limiting
                        await new Promise(r => setTimeout(r, 150));
                    } catch (error) {
                        results.channels.failed++;
                        results.channels.errors.push(`${channelData.name}: ${error.message}`);
                        results.logs.push(`❌ Failed channel "${channelData.name}": ${error.message}`);
                    }
                }
            }

            // Restore settings
            if (options.restoreSettings && backup.data.settings) {
                try {
                    const settings = backup.data.settings;
                    await guild.edit({
                        verificationLevel: settings.verificationLevel,
                        explicitContentFilter: settings.explicitContentFilter,
                        defaultMessageNotifications: settings.defaultMessageNotifications,
                        afkTimeout: settings.afkTimeout
                    }, { reason: 'Backup restore' });
                    results.settings.restored = true;
                    results.logs.push('✅ Server settings restored');
                } catch (error) {
                    results.settings.error = error.message;
                    results.logs.push(`❌ Failed to restore settings: ${error.message}`);
                }
            }

            results.logs.push('Restore complete');
            return { success: true, results };

        } catch (error) {
            results.logs.push(`❌ Fatal error: ${error.message}`);
            return { success: false, error: error.message, results };
        } finally {
            this.restoreInProgress.delete(guildId);
        }
    }

    // Build permission overwrites for channel creation using role names
    buildPermissionOverwrites(overwrites, roleMap, guild) {
        if (!overwrites || !Array.isArray(overwrites)) return [];
        
        return overwrites.map(ow => {
            let id = ow.id;
            
            // Try to find role by name if type is role (0)
            if (ow.type === 0 && ow.roleName) {
                const role = roleMap.get(ow.roleName);
                if (role) id = role.id;
            }
            
            // For @everyone, use guild ID
            if (ow.roleName === '@everyone' || ow.id === guild.id) {
                id = guild.id;
            }
            
            return {
                id,
                type: ow.type,
                allow: BigInt(ow.allow || '0'),
                deny: BigInt(ow.deny || '0')
            };
        }).filter(ow => {
            // Filter out overwrites for non-existent roles/members
            if (ow.type === 0) {
                return guild.roles.cache.has(ow.id) || ow.id === guild.id;
            }
            return guild.members.cache.has(ow.id);
        });
    }

    // Check if a backup with similar content already exists (duplicate prevention)
    async checkDuplicateBackup(guildId, options = {}) {
        const recentBackups = await this.listBackups(guildId);
        if (recentBackups.length === 0) return { isDuplicate: false };
        
        const lastBackup = recentBackups[0];
        const timeSinceLastBackup = Date.now() - new Date(lastBackup.created_at).getTime();
        
        // Consider duplicate if backup created within last 5 minutes
        if (timeSinceLastBackup < 5 * 60 * 1000) {
            return { 
                isDuplicate: true, 
                lastBackup: lastBackup.id,
                message: `A backup was created ${Math.floor(timeSinceLastBackup / 1000)} seconds ago`
            };
        }
        
        return { isDuplicate: false };
    }

    // Get backup info
    async getBackupInfo(backupId, guildId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM server_backups WHERE id = ? AND guild_id = ?',
                [backupId, guildId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                }
            );
        });
    }
}

module.exports = ServerBackupSystem;
