const { PermissionFlagsBits } = require('discord.js');

class PermissionManager {
    constructor(bot) {
        this.bot = bot;
        // Command group mapping; adjust as needed
        this.groupMap = {
            admin: new Set(['setup', 'settings', 'wizard']),
            security: new Set(['security', 'status', 'lockdown']),
            moderation: new Set(['ban', 'unban', 'kick', 'timeout', 'warn', 'purge']),
            utility: new Set(['help', 'userinfo', 'serverinfo', 'ticket']),
            analytics: new Set(['analytics']),
            tickets: new Set(['ticket'])
        };
    }

    getCommandGroup(commandName) {
        commandName = commandName.toLowerCase();
        for (const [group, set] of Object.entries(this.groupMap)) {
            if (set.has(commandName)) return group;
        }
        return 'utility';
    }

    async setRoles(guildId, scope, name, roleIds) {
        const json = JSON.stringify(roleIds);
        await this.bot.database.run(
            `INSERT INTO command_permissions (guild_id, scope, name, role_ids, created_at, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(guild_id, scope, name) DO UPDATE SET role_ids = excluded.role_ids, updated_at = CURRENT_TIMESTAMP`,
            [guildId, scope, name, json]
        );
    }

    async clear(guildId, scope = null, name = null) {
        if (!scope) {
            return this.bot.database.run(`DELETE FROM command_permissions WHERE guild_id = ?`, [guildId]);
        }
        if (!name) {
            return this.bot.database.run(`DELETE FROM command_permissions WHERE guild_id = ? AND scope = ?`, [guildId, scope]);
        }
        return this.bot.database.run(`DELETE FROM command_permissions WHERE guild_id = ? AND scope = ? AND name = ?`, [guildId, scope, name]);
    }

    async getRoles(guildId, scope, name) {
        const row = await this.bot.database.get(
            `SELECT role_ids FROM command_permissions WHERE guild_id = ? AND scope = ? AND name = ?`,
            [guildId, scope, name]
        );
        if (!row) return [];
        try { return JSON.parse(row.role_ids) || []; } catch { return []; }
    }

    async list(guildId) {
        const rows = await this.bot.database.all(
            `SELECT scope, name, role_ids, created_at, updated_at FROM command_permissions WHERE guild_id = ? ORDER BY scope, name`,
            [guildId]
        );
        return rows.map(r => ({ scope: r.scope, name: r.name, roles: JSON.parse(r.role_ids || '[]') }));
    }

    memberHasAnyRole(member, roleIds) {
        if (!roleIds?.length) return false;
        return roleIds.some(id => member.roles.cache.has(id));
    }

    async isAllowed(interaction) {
        const { guild, member, commandName } = interaction;
        if (!guild) return true; // DMs
        if (!member) return false;

        // Always allow server admins
        if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

        const group = this.getCommandGroup(commandName);

        // Command-specific rule first
        const cmdRoles = await this.getRoles(guild.id, 'command', commandName);
        if (cmdRoles.length) return this.memberHasAnyRole(member, cmdRoles);

        // Group rule next
        const grpRoles = await this.getRoles(guild.id, 'group', group);
        if (grpRoles.length) return this.memberHasAnyRole(member, grpRoles);

        // No explicit config -> allow by default (command's own default perms still apply in Discord)
        return true;
    }
}

module.exports = PermissionManager;
