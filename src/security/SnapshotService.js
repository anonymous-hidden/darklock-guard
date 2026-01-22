const { ChannelType, OverwriteType } = require('discord.js');

class SnapshotService {
  constructor(bot, db, emitter) {
    this.bot = bot;
    this.db = db;
    this.emitter = emitter;
    this.cache = {
      roles: new Map(),
      channels: new Map(),
    };
    this.interval = null;
  }

  async init(guild) {
    await this.snapshotGuild(guild);
    this.interval = setInterval(() => {
      this.snapshotGuild(guild).catch(err => this.bot.logger.error('Snapshot schedule error:', err));
    }, 15 * 60 * 1000);
  }

  async snapshotGuild(guild) {
    this.bot.logger.info(`[Snapshot] Taking snapshot for guild ${guild.id}`);
    await guild.roles.fetch();
    await guild.channels.fetch();

    const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id);
    const channels = [...guild.channels.cache.values()];

    const roleRows = roles.map(r => ({
      guild_id: guild.id,
      role_id: r.id,
      name: r.name,
      permissions: r.permissions.bitfield.toString(),
      color: r.color,
      hoist: r.hoist ? 1 : 0,
      mentionable: r.mentionable ? 1 : 0,
      snapshot_at: new Date().toISOString(),
    }));

    const channelRows = channels.map(c => ({
      guild_id: guild.id,
      channel_id: c.id,
      name: c.name || '',
      type: c.type,
      parent_id: c.parentId || null,
      position: typeof c.position === 'number' ? c.position : null,
      overwrites: JSON.stringify((c.permissionOverwrites?.cache ? [...c.permissionOverwrites.cache.values()] : []).map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow.bitfield.toString(),
        deny: o.deny.bitfield.toString(),
      }))),
      snapshot_at: new Date().toISOString(),
    }));

    await this.db.run('BEGIN');
    try {
      await this.db.run('DELETE FROM role_snapshots WHERE guild_id = ?', [guild.id]);
      await this.db.run('DELETE FROM channel_snapshots WHERE guild_id = ?', [guild.id]);

      const roleStmt = await this.db.prepare(`INSERT INTO role_snapshots (guild_id, role_id, name, permissions, color, hoist, mentionable, snapshot_at) VALUES (?,?,?,?,?,?,?,?)`);
      for (const r of roleRows) {
        await roleStmt.run([r.guild_id, r.role_id, r.name, r.permissions, r.color, r.hoist, r.mentionable, r.snapshot_at]);
      }
      await roleStmt.finalize?.();

      const chStmt = await this.db.prepare(`INSERT INTO channel_snapshots (guild_id, channel_id, name, type, parent_id, position, overwrites, snapshot_at) VALUES (?,?,?,?,?,?,?,?)`);
      for (const c of channelRows) {
        await chStmt.run([c.guild_id, c.channel_id, c.name, c.type, c.parent_id, c.position, c.overwrites, c.snapshot_at]);
      }
      await chStmt.finalize?.();

      await this.db.run('COMMIT');
    } catch (e) {
      await this.db.run('ROLLBACK');
      this.bot.logger.error('Snapshot DB error:', e);
      throw e;
    }

    // Refresh cache
    this.cache.roles.clear();
    this.cache.channels.clear();
    for (const r of roleRows) this.cache.roles.set(r.role_id, r);
    for (const c of channelRows) this.cache.channels.set(c.channel_id, c);

    this.bot.logger.info(`[Snapshot] Stored ${roleRows.length} roles, ${channelRows.length} channels for guild ${guild.id}`);
  }

  getRoleSnapshot(roleId) {
    return this.cache.roles.get(roleId) || null;
  }

  getChannelSnapshot(channelId) {
    return this.cache.channels.get(channelId) || null;
  }
}

module.exports = SnapshotService;
