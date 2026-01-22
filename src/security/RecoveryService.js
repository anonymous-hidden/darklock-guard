const { ChannelType, PermissionsBitField } = require('discord.js');

class RecoveryService {
  constructor(bot, db, emitter, snapshotService) {
    this.bot = bot;
    this.db = db;
    this.emitter = emitter;
    this.snapshots = snapshotService;
  }

  async trackDeletedGoodChannel(guildId, channelId) {
    const snap = this.snapshots.getChannelSnapshot(channelId);
    if (!snap) return;
    await this.db.run(
      `INSERT INTO incident_deleted_channels (guild_id, channel_id, payload, deleted_at)
       VALUES (?,?,?,?)`,
      [guildId, channelId, JSON.stringify(snap), new Date().toISOString()]
    );
  }

  async trackCreatedBadChannel(guildId, channel) {
    const row = {
      guild_id: guildId,
      channel_id: channel.id,
      name: channel.name,
      type: channel.type,
      created_at: new Date().toISOString(),
    };
    await this.db.run(
      `INSERT INTO incident_created_channels (guild_id, channel_id, name, type, created_at)
       VALUES (?,?,?,?,?)`,
      [row.guild_id, row.channel_id, row.name, row.type, row.created_at]
    );
  }

  async restoreGoodChannels(guild) {
    const rows = await this.db.query('SELECT payload FROM incident_deleted_channels WHERE guild_id = ?', [guild.id]);
    for (const r of rows) {
      const snap = JSON.parse(r.payload);
      const parent = snap.parent_id ? guild.channels.cache.get(snap.parent_id) : null;

      const created = await guild.channels.create({
        name: snap.name,
        type: snap.type,
        parent: parent || undefined,
        reason: 'Anti-Nuke recovery: restore good channel',
      }).catch(err => this.bot.logger.error('[Recovery] Create channel failed:', err));
      if (!created) continue;

      // Reapply overwrites
      try {
        const overwrites = JSON.parse(snap.overwrites || '[]');
        for (const o of overwrites) {
          await created.permissionOverwrites.edit(o.id, {
            allow: new PermissionsBitField(BigInt(o.allow)),
            deny: new PermissionsBitField(BigInt(o.deny)),
          }).catch(() => {});
        }
      } catch {}
      this.bot.logger.info(`[Recovery] Restored channel ${created.id} (${snap.name})`);
    }
  }

  async deleteBadChannels(guild) {
    const rows = await this.db.query('SELECT channel_id FROM incident_created_channels WHERE guild_id = ?', [guild.id]);
    for (const r of rows) {
      const ch = guild.channels.cache.get(r.channel_id) || await guild.channels.fetch(r.channel_id).catch(() => null);
      if (ch) {
        await ch.delete('Anti-Nuke recovery: delete bad channel').catch(err => this.bot.logger.error('[Recovery] Delete bad channel failed:', err));
        this.bot.logger.info(`[Recovery] Deleted bad channel ${r.channel_id}`);
      }
    }
  }

  async trackBan(guildId, userId, executorId) {
    await this.db.run(
      `INSERT INTO incident_banned_members (guild_id, user_id, executor_id, banned_at)
       VALUES (?,?,?,?)`,
      [guildId, userId, executorId, new Date().toISOString()]
    );
  }

  async snapshotMember(guild, member) {
    const roles = member.roles.cache.map(r => r.id);
    const nick = member.nickname || member.user.username;
    await this.db.run(
      `INSERT INTO member_snapshots (guild_id, user_id, nickname, roles, snapshot_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET nickname = excluded.nickname, roles = excluded.roles, snapshot_at = excluded.snapshot_at`,
      [guild.id, member.id, nick, JSON.stringify(roles), new Date().toISOString()]
    );
  }

  async unbanWave(guild) {
    const bans = await this.db.query('SELECT user_id FROM incident_banned_members WHERE guild_id = ?', [guild.id]);
    for (const b of bans) {
      try {
        await guild.members.unban(b.user_id, 'Anti-Nuke unban wave');
        const snap = await this.db.query('SELECT nickname, roles FROM member_snapshots WHERE guild_id = ? AND user_id = ?', [guild.id, b.user_id]);
        const s = snap[0];
        // Reassign roles if user rejoins later (cannot assign while not a member). We store for later reconciliation.
        await this.db.run(
          `UPDATE incident_banned_members SET needs_role_restore = 1 WHERE guild_id = ? AND user_id = ?`,
          [guild.id, b.user_id]
        );
        this.bot.logger.info(`[Recovery] Unbanned ${b.user_id}; queued role restoration upon rejoin`);
      } catch (e) {
        this.bot.logger.error(`[Recovery] Unban failed for ${b.user_id}:`, e);
      }
    }
  }
}

module.exports = RecoveryService;
