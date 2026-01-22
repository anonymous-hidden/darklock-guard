const { writeJson, readJson, ensureDir } = require('./utils');
const path = require('path');

class SnapshotManager {
  constructor(options = {}) {
    this.dir = options.dir || path.join(process.cwd(), 'data', 'snapshots');
    this.intervalMs = options.intervalMs || 15 * 60 * 1000; // 15 minutes
    this.timers = new Map();
  }

  async saveSnapshotForGuild(guild) {
    const channels = [];
    try {
      guild.channels.cache.forEach(ch => {
        channels.push({
          id: ch.id,
          name: ch.name,
          type: ch.type,
          parentId: ch.parentId || null,
          position: ch.position,
          topic: ch.topic || null,
          nsfw: ch.nsfw || false,
          rateLimitPerUser: ch.rateLimitPerUser || ch.rateLimit || 0,
          permissionOverwrites: (ch.permissionOverwrites && Array.from(ch.permissionOverwrites.cache || ch.permissionOverwrites || []).map(po => ({ id: po.id, allow: po.allow?.toArray ? po.allow.toArray() : po.allow, deny: po.deny?.toArray ? po.deny.toArray() : po.deny })) ) || []
        });
      });
    } catch (e) {
      // best-effort
    }

    const payload = { guildId: guild.id, savedAt: Date.now(), channels };
    await ensureDir(this.dir);
    await writeJson(path.join(this.dir, `${guild.id}.json`), payload);
    return payload;
  }

  async getSnapshot(guildId) {
    return await readJson(path.join(this.dir, `${guildId}.json`));
  }

  startAutoSnapshot(client) {
    client.guilds.cache.forEach(g => this._startForGuild(g));
    client.on('guildCreate', g => this._startForGuild(g));
  }

  _startForGuild(guild) {
    if (this.timers.has(guild.id)) return;
    // first save immediately
    this.saveSnapshotForGuild(guild).catch(() => {});
    const t = setInterval(() => this.saveSnapshotForGuild(guild).catch(() => {}), this.intervalMs);
    this.timers.set(guild.id, t);
  }
}

module.exports = SnapshotManager;
