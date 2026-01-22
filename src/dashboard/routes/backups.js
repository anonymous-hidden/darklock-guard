/**
 * Server Backup Routes
 * Handles server backup listing, management, and code display
 */

const express = require('express');

/**
 * Create backup routes
 * @param {Object} dashboard - Dashboard instance
 */
function createBackupRoutes(dashboard) {
    const router = express.Router();
    const bot = dashboard.bot;
    const authenticateToken = dashboard.authenticateToken.bind(dashboard);

    /**
     * Check guild access helper
     */
    async function checkAccess(req, res, guildId) {
        const hasAccess = await dashboard.checkGuildAccess(req.user.userId, guildId);
        if (!hasAccess) {
            res.status(403).json({ error: 'No access to this guild' });
            return false;
        }
        return true;
    }

    /**
     * Format bytes to human readable
     */
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Format date for display
     */
    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Parse includes string
     */
    function parseIncludes(includesStr) {
        if (!includesStr) return { roles: true, channels: true, settings: true };
        try {
            return JSON.parse(includesStr);
        } catch {
            return { roles: true, channels: true, settings: true };
        }
    }

    /**
     * List all backups for a guild
     */
    router.get('/guilds/:guildId/backups', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;
            
            if (!await checkAccess(req, res, guildId)) return;
            
            if (!bot.serverBackup) {
                return res.status(503).json({ error: 'Backup system not available' });
            }

            const backups = await bot.serverBackup.listBackups(guildId);
            const guild = bot.client.guilds.cache.get(guildId);

            // Format backups for dashboard display
            const formattedBackups = backups.map(backup => ({
                id: backup.id,
                backupCode: backup.id,
                type: backup.backup_type || 'manual',
                createdBy: backup.created_by,
                description: backup.description,
                sizeBytes: backup.size_bytes,
                sizeFormatted: formatBytes(backup.size_bytes),
                includes: parseIncludes(backup.includes),
                hasChecksum: !!backup.checksum,
                integrityStatus: backup.checksum ? 'verified' : 'legacy',
                createdAt: backup.created_at,
                createdAtFormatted: formatDate(backup.created_at)
            }));

            res.json({
                success: true,
                guildId,
                guildName: guild?.name,
                backupCount: formattedBackups.length,
                backups: formattedBackups
            });
        } catch (error) {
            bot.logger?.error('Error listing backups:', error);
            res.status(500).json({ error: 'Failed to list backups' });
        }
    });

    /**
     * Get detailed backup information
     */
    router.get('/guilds/:guildId/backups/:backupId', authenticateToken, async (req, res) => {
        try {
            const { guildId, backupId } = req.params;
            
            if (!await checkAccess(req, res, guildId)) return;
            
            if (!bot.serverBackup) {
                return res.status(503).json({ error: 'Backup system not available' });
            }

            // Get backup metadata from database
            const backups = await bot.serverBackup.listBackups(guildId);
            const backupMeta = backups.find(b => b.id === backupId);
            
            if (!backupMeta) {
                return res.status(404).json({ error: 'Backup not found' });
            }

            // Get full backup data with verification
            const backupResult = await bot.serverBackup.getBackupDataWithVerification(backupId);
            
            let details = {
                id: backupMeta.id,
                backupCode: backupMeta.id,
                type: backupMeta.backup_type || 'manual',
                createdBy: backupMeta.created_by,
                description: backupMeta.description,
                sizeBytes: backupMeta.size_bytes,
                sizeFormatted: formatBytes(backupMeta.size_bytes),
                createdAt: backupMeta.created_at,
                createdAtFormatted: formatDate(backupMeta.created_at),
                includes: parseIncludes(backupMeta.includes)
            };

            if (backupResult) {
                const { data, integrity } = backupResult;
                details.integrity = {
                    valid: integrity.valid,
                    legacy: integrity.legacy,
                    reason: integrity.reason
                };
                
                // Add content summary (don't expose full data)
                if (data?.data) {
                    details.contentSummary = {
                        roles: data.data.roles?.length || 0,
                        channels: (data.data.channels?.categories?.length || 0) + (data.data.channels?.channels?.length || 0),
                        categories: data.data.channels?.categories?.length || 0,
                        hasSettings: !!data.data.settings,
                        hasBans: !!data.data.bans,
                        guildName: data.guildName
                    };
                }
            }

            res.json({
                success: true,
                backup: details
            });
        } catch (error) {
            bot.logger?.error('Error getting backup details:', error);
            res.status(500).json({ error: 'Failed to get backup details' });
        }
    });

    /**
     * Create a new backup
     */
    router.post('/guilds/:guildId/backups', authenticateToken, async (req, res) => {
        try {
            const { guildId } = req.params;
            const { description, includeRoles, includeChannels, includeSettings, includeBans } = req.body;
            
            if (!await checkAccess(req, res, guildId)) return;
            
            if (!bot.serverBackup) {
                return res.status(503).json({ error: 'Backup system not available' });
            }

            // Check for duplicate backup
            const duplicateCheck = await bot.serverBackup.checkDuplicateBackup(guildId);
            if (duplicateCheck.isDuplicate) {
                return res.status(429).json({ 
                    error: 'Duplicate backup detected',
                    message: duplicateCheck.message,
                    lastBackup: duplicateCheck.lastBackup
                });
            }

            const result = await bot.serverBackup.createBackup(guildId, {
                createdBy: req.user.userId,
                type: 'manual',
                description: description || 'Created from dashboard',
                includeRoles: includeRoles !== false,
                includeChannels: includeChannels !== false,
                includeSettings: includeSettings !== false,
                includeBans: includeBans === true
            });

            if (result.success) {
                res.json({
                    success: true,
                    message: 'Backup created successfully',
                    backup: {
                        id: result.backupId,
                        backupCode: result.backupId,
                        size: result.size,
                        sizeFormatted: formatBytes(result.size),
                        includes: result.includes,
                        hasChecksum: !!result.checksum
                    }
                });
            } else {
                res.status(500).json({ error: result.error || 'Failed to create backup' });
            }
        } catch (error) {
            bot.logger?.error('Error creating backup:', error);
            res.status(500).json({ error: 'Failed to create backup' });
        }
    });

    /**
     * Delete a backup
     */
    router.delete('/guilds/:guildId/backups/:backupId', authenticateToken, async (req, res) => {
        try {
            const { guildId, backupId } = req.params;
            
            if (!await checkAccess(req, res, guildId)) return;
            
            if (!bot.serverBackup) {
                return res.status(503).json({ error: 'Backup system not available' });
            }

            // Verify backup belongs to this guild
            const backups = await bot.serverBackup.listBackups(guildId);
            const backup = backups.find(b => b.id === backupId);
            
            if (!backup) {
                return res.status(404).json({ error: 'Backup not found' });
            }

            const deleted = await bot.serverBackup.deleteBackup(backupId, guildId);
            
            if (deleted) {
                res.json({ success: true, message: 'Backup deleted successfully' });
            } else {
                res.status(500).json({ error: 'Failed to delete backup' });
            }
        } catch (error) {
            bot.logger?.error('Error deleting backup:', error);
            res.status(500).json({ error: 'Failed to delete backup' });
        }
    });

    /**
     * Verify backup integrity
     */
    router.get('/guilds/:guildId/backups/:backupId/verify', authenticateToken, async (req, res) => {
        try {
            const { guildId, backupId } = req.params;
            
            if (!await checkAccess(req, res, guildId)) return;
            
            if (!bot.serverBackup) {
                return res.status(503).json({ error: 'Backup system not available' });
            }

            // Verify backup belongs to this guild
            const backups = await bot.serverBackup.listBackups(guildId);
            const backup = backups.find(b => b.id === backupId);
            
            if (!backup) {
                return res.status(404).json({ error: 'Backup not found' });
            }

            const result = await bot.serverBackup.getBackupDataWithVerification(backupId);
            
            if (!result) {
                return res.status(404).json({ error: 'Backup data not found' });
            }

            res.json({
                success: true,
                backupId,
                integrity: {
                    valid: result.integrity.valid,
                    legacy: result.integrity.legacy,
                    reason: result.integrity.reason,
                    storedChecksum: result.integrity.storedChecksum ? '***' + result.integrity.storedChecksum.slice(-8) : null,
                    computedChecksum: result.integrity.computedChecksum ? '***' + result.integrity.computedChecksum.slice(-8) : null
                }
            });
        } catch (error) {
            bot.logger?.error('Error verifying backup:', error);
            res.status(500).json({ error: 'Failed to verify backup' });
        }
    });

    return router;
}

module.exports = createBackupRoutes;
