const { ChannelType, PermissionFlagsBits } = require('discord.js');

/**
 * Automated Post-Incident Recovery System
 * Automatically restore server state after nuke attacks
 */
class RecoverySystem {
    constructor(database, client) {
        this.db = database;
        this.client = client;
        this.autoSnapshotInterval = 6 * 60 * 60 * 1000; // 6 hours
        this.snapshotTimers = new Map();
    }

    /**
     * Start automatic snapshots for a guild
     */
    startAutoSnapshots(guildId) {
        if (this.snapshotTimers.has(guildId)) {
            return; // Already running
        }

        const interval = setInterval(async () => {
            try {
                await this.createSnapshot(guildId, 'auto');
            } catch (error) {
                console.error(`Auto-snapshot failed for guild ${guildId}:`, error);
            }
        }, this.autoSnapshotInterval);

        this.snapshotTimers.set(guildId, interval);
        console.log(`✅ Auto-snapshots enabled for guild ${guildId}`);
    }

    /**
     * Stop automatic snapshots
     */
    stopAutoSnapshots(guildId) {
        const timer = this.snapshotTimers.get(guildId);
        if (timer) {
            clearInterval(timer);
            this.snapshotTimers.delete(guildId);
            console.log(`🛑 Auto-snapshots disabled for guild ${guildId}`);
        }
    }

    /**
     * Create a complete server snapshot
     */
    async createSnapshot(guildId, type = 'manual', createdBy = 'system') {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) {
                throw new Error('Guild not found');
            }

            console.log(`📸 Creating snapshot for ${guild.name}...`);

            // Fetch all necessary data
            const [channels, roles, members] = await Promise.all([
                this.snapshotChannels(guild),
                this.snapshotRoles(guild),
                this.snapshotMembers(guild)
            ]);

            const settings = await this.snapshotSettings(guild);

            // Store in database
            await this.db.run(`
                INSERT INTO server_snapshots (
                    guild_id, snapshot_type, channels, roles,
                    permissions, members, settings, created_by, auto_created
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                guildId,
                type,
                JSON.stringify(channels),
                JSON.stringify(roles),
                JSON.stringify(this.extractPermissions(roles)),
                JSON.stringify(members),
                JSON.stringify(settings),
                createdBy,
                type === 'auto' ? 1 : 0
            ]);

            // Clean up old snapshots (keep last 10)
            await this.cleanupOldSnapshots(guildId, 10);

            console.log(`✅ Snapshot created for ${guild.name}`);
            return { success: true, channels: channels.length, roles: roles.length };
        } catch (error) {
            console.error('Snapshot creation failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Snapshot all channels
     */
    async snapshotChannels(guild) {
        const channels = [];

        for (const [channelId, channel] of guild.channels.cache) {
            const channelData = {
                id: channelId,
                name: channel.name,
                type: channel.type,
                position: channel.position,
                parentId: channel.parentId,
                permissionOverwrites: [],
                topic: channel.topic || null,
                nsfw: channel.nsfw || false,
                rateLimitPerUser: channel.rateLimitPerUser || 0,
                bitrate: channel.bitrate || null,
                userLimit: channel.userLimit || null
            };

            // Snapshot permission overwrites
            if (channel.permissionOverwrites) {
                channel.permissionOverwrites.cache.forEach(overwrite => {
                    channelData.permissionOverwrites.push({
                        id: overwrite.id,
                        type: overwrite.type,
                        allow: overwrite.allow.toArray(),
                        deny: overwrite.deny.toArray()
                    });
                });
            }

            channels.push(channelData);
        }

        return channels;
    }

    /**
     * Snapshot all roles
     */
    async snapshotRoles(guild) {
        const roles = [];

        for (const [roleId, role] of guild.roles.cache) {
            if (role.managed) continue; // Skip bot roles

            roles.push({
                id: roleId,
                name: role.name,
                color: role.color,
                hoist: role.hoist,
                position: role.position,
                permissions: role.permissions.toArray(),
                mentionable: role.mentionable,
                icon: role.icon,
                unicodeEmoji: role.unicodeEmoji
            });
        }

        return roles;
    }

    /**
     * Snapshot member roles (limited to prevent huge data)
     */
    async snapshotMembers(guild) {
        const members = [];
        const membersToSnapshot = guild.members.cache.size > 1000 ? 
            guild.members.cache.filter(m => m.roles.cache.size > 1).first(1000) :
            guild.members.cache;

        for (const [memberId, member] of membersToSnapshot) {
            members.push({
                id: memberId,
                roles: member.roles.cache.map(r => r.id).filter(id => id !== guild.id) // Exclude @everyone
            });
        }

        return members;
    }

    /**
     * Snapshot guild settings
     */
    async snapshotSettings(guild) {
        return {
            name: guild.name,
            icon: guild.iconURL(),
            banner: guild.bannerURL(),
            description: guild.description,
            verificationLevel: guild.verificationLevel,
            defaultMessageNotifications: guild.defaultMessageNotifications,
            explicitContentFilter: guild.explicitContentFilter,
            afkChannelId: guild.afkChannelId,
            afkTimeout: guild.afkTimeout,
            systemChannelId: guild.systemChannelId
        };
    }

    /**
     * Extract permissions from roles
     */
    extractPermissions(roles) {
        return roles.map(role => ({
            id: role.id,
            name: role.name,
            permissions: role.permissions
        }));
    }

    /**
     * Restore server from snapshot
     */
    async restoreFromSnapshot(snapshotId, restoredBy, options = {}) {
        const {
            restoreChannels = true,
            restoreRoles = true,
            restoreMemberRoles = true,
            restorePermissions = true,
            deleteExisting = false
        } = options;

        try {
            const snapshot = await this.db.get(`
                SELECT * FROM server_snapshots WHERE id = ?
            `, [snapshotId]);

            if (!snapshot) {
                return { success: false, error: 'Snapshot not found' };
            }

            const guild = this.client.guilds.cache.get(snapshot.guild_id);
            if (!guild) {
                return { success: false, error: 'Guild not found' };
            }

            console.log(`🔄 Starting restoration for ${guild.name}...`);

            // Create recovery action log
            const recoveryId = await this.startRecoveryAction(
                guild.id,
                null,
                'full_restore',
                restoredBy
            );

            const stats = {
                channelsRestored: 0,
                rolesRestored: 0,
                permissionsRestored: 0,
                membersRestored: 0,
                errors: []
            };

            // Parse snapshot data
            const channels = JSON.parse(snapshot.channels);
            const roles = JSON.parse(snapshot.roles);
            const members = JSON.parse(snapshot.members);

            // Step 1: Restore Roles
            if (restoreRoles) {
                console.log('📝 Restoring roles...');
                const roleMapping = await this.restoreRoles(guild, roles, deleteExisting);
                stats.rolesRestored = Object.keys(roleMapping).length;
            }

            // Step 2: Restore Channels
            if (restoreChannels) {
                console.log('📝 Restoring channels...');
                await this.restoreChannels(guild, channels, deleteExisting);
                stats.channelsRestored = channels.length;
            }

            // Step 3: Restore Member Roles
            if (restoreMemberRoles) {
                console.log('📝 Restoring member roles...');
                stats.membersRestored = await this.restoreMemberRoles(guild, members);
            }

            // Update recovery action
            await this.completeRecoveryAction(recoveryId, stats);

            // Mark snapshot as restored
            await this.db.run(`
                UPDATE server_snapshots
                SET restored = 1, restored_at = CURRENT_TIMESTAMP, restored_by = ?
                WHERE id = ?
            `, [restoredBy, snapshotId]);

            console.log(`✅ Restoration complete for ${guild.name}`);
            return { success: true, stats };
        } catch (error) {
            console.error('Restoration failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Restore roles from snapshot
     */
    async restoreRoles(guild, roles, deleteExisting = false) {
        const roleMapping = {}; // Old ID -> New ID

        // Delete existing roles if requested
        if (deleteExisting) {
            for (const [roleId, role] of guild.roles.cache) {
                if (!role.managed && role.id !== guild.id) {
                    await role.delete('Restoration: removing existing role').catch(() => {});
                }
            }
        }

        // Sort roles by position
        roles.sort((a, b) => a.position - b.position);

        // Recreate roles
        for (const roleData of roles) {
            try {
                const newRole = await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    hoist: roleData.hoist,
                    permissions: roleData.permissions,
                    mentionable: roleData.mentionable,
                    icon: roleData.icon,
                    unicodeEmoji: roleData.unicodeEmoji,
                    reason: 'Snapshot restoration'
                });

                roleMapping[roleData.id] = newRole.id;
                console.log(`✅ Restored role: ${roleData.name}`);
            } catch (error) {
                console.error(`Failed to restore role ${roleData.name}:`, error.message);
            }
        }

        return roleMapping;
    }

    /**
     * Restore channels from snapshot
     */
    async restoreChannels(guild, channels, deleteExisting = false) {
        const channelMapping = {}; // Old ID -> New ID
        const categories = channels.filter(c => c.type === ChannelType.GuildCategory);
        const otherChannels = channels.filter(c => c.type !== ChannelType.GuildCategory);

        // Delete existing channels if requested
        if (deleteExisting) {
            for (const [channelId, channel] of guild.channels.cache) {
                await channel.delete('Restoration: removing existing channel').catch(() => {});
            }
        }

        // Restore categories first
        for (const categoryData of categories) {
            try {
                const newCategory = await guild.channels.create({
                    name: categoryData.name,
                    type: ChannelType.GuildCategory,
                    position: categoryData.position,
                    reason: 'Snapshot restoration'
                });

                channelMapping[categoryData.id] = newCategory.id;

                // Restore permission overwrites
                await this.restoreChannelPermissions(newCategory, categoryData.permissionOverwrites);

                console.log(`✅ Restored category: ${categoryData.name}`);
            } catch (error) {
                console.error(`Failed to restore category ${categoryData.name}:`, error.message);
            }
        }

        // Restore other channels
        for (const channelData of otherChannels) {
            try {
                const createOptions = {
                    name: channelData.name,
                    type: channelData.type,
                    position: channelData.position,
                    parent: channelMapping[channelData.parentId] || null,
                    topic: channelData.topic,
                    nsfw: channelData.nsfw,
                    rateLimitPerUser: channelData.rateLimitPerUser,
                    reason: 'Snapshot restoration'
                };

                if (channelData.type === ChannelType.GuildVoice) {
                    createOptions.bitrate = channelData.bitrate;
                    createOptions.userLimit = channelData.userLimit;
                }

                const newChannel = await guild.channels.create(createOptions);
                channelMapping[channelData.id] = newChannel.id;

                // Restore permission overwrites
                await this.restoreChannelPermissions(newChannel, channelData.permissionOverwrites);

                console.log(`✅ Restored channel: ${channelData.name}`);
            } catch (error) {
                console.error(`Failed to restore channel ${channelData.name}:`, error.message);
            }
        }

        return channelMapping;
    }

    /**
     * Restore channel permissions
     */
    async restoreChannelPermissions(channel, overwrites) {
        for (const overwrite of overwrites) {
            try {
                await channel.permissionOverwrites.create(overwrite.id, {
                    [overwrite.type === 0 ? 'role' : 'member']: overwrite.id,
                    allow: overwrite.allow,
                    deny: overwrite.deny
                }, { reason: 'Snapshot restoration' });
            } catch (error) {
                console.error(`Failed to restore permissions for ${channel.name}:`, error.message);
            }
        }
    }

    /**
     * Restore member roles
     */
    async restoreMemberRoles(guild, members) {
        let restored = 0;

        for (const memberData of members) {
            try {
                const member = await guild.members.fetch(memberData.id).catch(() => null);
                if (!member) continue;

                // Filter roles that still exist
                const rolesToAdd = memberData.roles.filter(roleId => 
                    guild.roles.cache.has(roleId)
                );

                if (rolesToAdd.length > 0) {
                    await member.roles.add(rolesToAdd, 'Snapshot restoration');
                    restored++;
                }
            } catch (error) {
                console.error(`Failed to restore roles for member ${memberData.id}:`, error.message);
            }
        }

        return restored;
    }

    /**
     * Start recovery action logging
     */
    async startRecoveryAction(guildId, incidentId, recoveryType, startedBy) {
        const result = await this.db.run(`
            INSERT INTO recovery_actions (
                guild_id, incident_id, recovery_type, started_by
            ) VALUES (?, ?, ?, ?)
        `, [guildId, incidentId, recoveryType, startedBy]);

        return result.id;
    }

    /**
     * Complete recovery action
     */
    async completeRecoveryAction(recoveryId, stats) {
        await this.db.run(`
            UPDATE recovery_actions
            SET status = 'completed',
                items_restored = ?,
                completed_at = CURRENT_TIMESTAMP,
                errors = ?
            WHERE id = ?
        `, [
            stats.channelsRestored + stats.rolesRestored + stats.membersRestored,
            JSON.stringify(stats.errors),
            recoveryId
        ]);
    }

    /**
     * Get available snapshots for a guild
     */
    async getSnapshots(guildId, limit = 10) {
        return await this.db.all(`
            SELECT id, snapshot_type, created_at, created_by, restored, can_restore
            FROM server_snapshots
            WHERE guild_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `, [guildId, limit]);
    }

    /**
     * Clean up old snapshots
     */
    async cleanupOldSnapshots(guildId, keepCount = 10) {
        await this.db.run(`
            DELETE FROM server_snapshots
            WHERE guild_id = ? AND id NOT IN (
                SELECT id FROM server_snapshots
                WHERE guild_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            )
        `, [guildId, guildId, keepCount]);
    }

    /**
     * Quick restore after nuke (automated)
     */
    async quickRestore(guildId) {
        // Get the most recent snapshot
        const snapshot = await this.db.get(`
            SELECT * FROM server_snapshots
            WHERE guild_id = ? AND can_restore = 1
            ORDER BY created_at DESC
            LIMIT 1
        `, [guildId]);

        if (!snapshot) {
            console.error('No restorable snapshot found for quick restore');
            return { success: false, error: 'No snapshot available' };
        }

        return await this.restoreFromSnapshot(snapshot.id, 'system', {
            restoreChannels: true,
            restoreRoles: true,
            restoreMemberRoles: false, // Skip member roles for speed
            deleteExisting: false
        });
    }
}

module.exports = RecoverySystem;
