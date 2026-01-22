const { PermissionsBitField } = require('discord.js');

class LockdownService {
  constructor(bot, db, emitter) {
    this.bot = bot;
    this.db = db;
    this.emitter = emitter;
    this.quarantineRoleName = 'Quarantine';
    this.destructivePerms = new PermissionsBitField([
      PermissionsBitField.Flags.Administrator,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageRoles,
      PermissionsBitField.Flags.BanMembers,
      PermissionsBitField.Flags.KickMembers,
    ]);
  }

  async applyLockdown(guild, whitelistRoleIds = []) {
    this.bot.logger.warn(`[Lockdown] Applying lockdown on guild ${guild.id}`);
    await guild.roles.fetch();

    const roles = guild.roles.cache.filter(r => !whitelistRoleIds.includes(r.id));

    await this.db.run('BEGIN');
    try {
      for (const role of roles.values()) {
        const original = role.permissions.bitfield.toString();
        const newPerms = new PermissionsBitField(role.permissions.bitfield).remove(this.destructivePerms);

        // Backup original perm
        await this.db.run(
          `INSERT INTO role_perm_backup (guild_id, role_id, original_permissions, backup_at) VALUES (?,?,?,?)
           ON CONFLICT(guild_id, role_id) DO UPDATE SET original_permissions = excluded.original_permissions, backup_at = excluded.backup_at`,
          [guild.id, role.id, original, new Date().toISOString()]
        );

        if (original !== newPerms.bitfield.toString()) {
          await role.setPermissions(newPerms).catch(err => this.bot.logger.error(`[Lockdown] Failed to clamp role ${role.id}:`, err));
          this.bot.logger.info(`[Lockdown] Clamped role ${role.name} (${role.id})`);
        }
      }
      await this.db.run('COMMIT');
    } catch (e) {
      await this.db.run('ROLLBACK');
      this.bot.logger.error('[Lockdown] DB error during clamp:', e);
      throw e;
    }
  }

  async ensureQuarantineRole(guild) {
    let role = guild.roles.cache.find(r => r.name === this.quarantineRoleName);
    if (!role) {
      role = await guild.roles.create({
        name: this.quarantineRoleName,
        color: 0x2f3136,
        permissions: [],
        reason: 'Anti-Nuke quarantine role',
      });
      this.bot.logger.info(`[Lockdown] Created quarantine role ${role.id}`);
    }
    return role;
  }

  async quarantineMember(guild, userId) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      const qRole = await this.ensureQuarantineRole(guild);

      // Remove dangerous perms by stripping roles that grant them
      for (const role of member.roles.cache.values()) {
        if (role.permissions.any(this.destructivePerms)) {
          await member.roles.remove(role).catch(err => this.bot.logger.error(`[Lockdown] Remove dangerous role ${role.id} from ${userId} failed:`, err));
        }
      }

      await member.roles.add(qRole).catch(err => this.bot.logger.error(`[Lockdown] Quarantine add failed for ${userId}:`, err));
      this.bot.logger.warn(`[Lockdown] Member ${userId} quarantined`);
      return true;
    } catch (e) {
      this.bot.logger.error('[Lockdown] quarantineMember error:', e);
      return false;
    }
  }

  async restorePermissions(guild) {
    this.bot.logger.info(`[Lockdown] Restoring clamped role permissions on guild ${guild.id}`);
    const backups = await this.db.query('SELECT role_id, original_permissions FROM role_perm_backup WHERE guild_id = ?', [guild.id]);
    await guild.roles.fetch();

    for (const row of backups) {
      const role = guild.roles.cache.get(row.role_id);
      if (!role) continue;
      const original = new PermissionsBitField(BigInt(row.original_permissions));
      await role.setPermissions(original).catch(err => this.bot.logger.error(`[Lockdown] Restore perms failed for ${role.id}:`, err));
      this.bot.logger.info(`[Lockdown] Restored permissions for role ${role.name} (${role.id})`);
    }
  }
}

module.exports = LockdownService;
