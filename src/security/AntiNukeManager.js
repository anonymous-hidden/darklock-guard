const PermissionMonitor = require('./permissionMonitor');
const RateLimiter = require('./rateLimiter');
const SnapshotManager = require('./snapshotManager');
const { restoreGuildFromSnapshot } = require('./restoreManager');
const path = require('path');

class AntiNukeManager {
  constructor(botOrClient, options = {}) {
    // Accept either the SecurityBot instance (which has `.client`) or the raw Discord client
    this.client = botOrClient && botOrClient.client ? botOrClient.client : botOrClient;
    this.whitelist = new Set(options.whitelist || (botOrClient && botOrClient.whitelist) || []);
    this.modLog = options.modLog || ((guild, msg)=>console.log(`[modlog:${guild.id}]`, msg));
    this.rateLimiter = new RateLimiter(options.rateLimiter || {});
    this.snapshotManager = new SnapshotManager(options.snapshot || {});
    this.flagged = new Map(); // guildId -> Set(userId)
    this.lockdowns = new Map(); // guildId -> timestamp
    // activity tracking for compatibility with existing handlers
    // Map<guildId, Map<userId, { actions: [{type,ts}], createdChannels: [], createdRoles: [] }>>
    this.activity = new Map();
    this.createThreshold = options.createThreshold || 3;
    this.deleteThreshold = options.deleteThreshold || 3;
    this.windowMs = options.windowMs || this.rateLimiter.windowMs || 1500;

    this.permissionMonitor = new PermissionMonitor(this.client, { whitelist: this.whitelist, onDangerDetected: (...args)=>this._onDangerDetected(...args) });

    this._bindEvents();
    this.snapshotManager.startAutoSnapshot(this.client);
  }

  _ensureActivity(guildId, userId) {
    if (!this.activity.has(guildId)) this.activity.set(guildId, new Map());
    const gm = this.activity.get(guildId);
    if (!gm.has(userId)) gm.set(userId, { actions: [], createdChannels: [], createdRoles: [] });
    return gm.get(userId);
  }

  pruneActivity(entry) {
    const cutoff = Date.now() - this.windowMs;
    entry.actions = entry.actions.filter(a => a.ts >= cutoff);
  }

  // Backwards-compatible tracking used by existing bot handlers
  track(guildId, userId, actionType, target) {
    try {
      // Skip whitelisted users (bot owner, trusted admins)
      if (this.whitelist.has(userId)) {
        return { triggered: false, recentCreates: 0, recentDeletes: 0 };
      }

      const entry = this._ensureActivity(guildId, userId);
      entry.actions.push({ type: actionType, ts: Date.now() });
      if (actionType === 'channel_create' && target?.id) entry.createdChannels.push(target.id);
      if (actionType === 'role_create' && target?.id) entry.createdRoles.push(target.id);
      this.pruneActivity(entry);

      const recentCreates = entry.actions.filter(a => a.type.includes('create')).length;
      const recentDeletes = entry.actions.filter(a => a.type.includes('delete')).length;

      const triggered = (recentCreates >= this.createThreshold) || (recentDeletes >= this.deleteThreshold) || (this.rateLimiter.record(guildId, userId) && recentDeletes > 0);

      // containment: if user is flagged and created a channel, try deleting it
      const flagged = this.flagged.get(guildId);
      if (flagged && flagged.has(userId) && actionType === 'channel_create' && target?.id) {
        (async () => {
          try {
            const g = await this.client.guilds.fetch(guildId).catch(()=>null);
            if (g) {
              const ch = g.channels.cache.get(target.id) || await g.channels.fetch(target.id).catch(()=>null);
              if (ch) await ch.delete('Containment: created by flagged nuker');
            }
          } catch(e){}
        })();
      }

      return { triggered, recentCreates, recentDeletes };
    } catch (e) {
      return { triggered: false, recentCreates: 0, recentDeletes: 0 };
    }
  }

  // Public mitigation method (compatible with previous code calling mitigate(guild, userId))
  async mitigate(guild, userId) {
    try {
      if (!guild) {
        // allow calling with guildId
        const g = await this.client.guilds.fetch(guild).catch(()=>null);
        if (!g) return;
        guild = g;
      }

      // SECURITY: Never mitigate whitelisted users, the server owner, or the bot itself
      if (this.whitelist.has(userId)) {
        this.modLog(guild, { type: 'nuke_mitigation_skipped', userId, reason: 'whitelisted' });
        return;
      }
      if (guild.ownerId === userId) {
        this.modLog(guild, { type: 'nuke_mitigation_skipped', userId, reason: 'server_owner' });
        return;
      }
      if (this.client.user && this.client.user.id === userId) {
        this.modLog(guild, { type: 'nuke_mitigation_skipped', userId, reason: 'self' });
        return;
      }

      // Check hierarchy before attempting ban
      const botMember = guild.members.me;
      const targetMember = await guild.members.fetch(userId).catch(() => null);
      if (targetMember && botMember && targetMember.roles.highest.position >= botMember.roles.highest.position) {
        this.modLog(guild, { type: 'nuke_mitigation_skipped', userId, reason: 'hierarchy_too_high' });
        return;
      }

      // prefer ban, else strip roles
      try {
        await guild.members.ban(userId, { reason: 'Detected nuke - automated mitigation' });
      } catch (e) {
        const m = await guild.members.fetch(userId).catch(()=>null);
        if (m) {
          try {
            for (const r of m.roles.cache.values()) {
              if (r.managed) continue;
              await m.roles.remove(r.id, 'Automated removal after nuke detection');
            }
          } catch (e) {}
        }
      }

      // trigger lockdown and restore snapshot
      await this._triggerLockdown(guild);
      const snap = await this.snapshotManager.getSnapshot(guild.id);
      if (snap) await restoreGuildFromSnapshot(guild, snap).catch(()=>{});

      this.modLog(guild, { type: 'nuke_mitigated', userId });
    } catch (e) {}
  }

  _bindEvents() {
    const client = this.client;

    client.on('channelDelete', async (channel) => {
      try {
        const guild = channel.guild;
        // attempt to get executor from cache via audit log is slow; instead rely on rateLimiter injection
        // This handler will be paired with a partial detection system: other code should call recordChannelDelete
        // Here just trigger restore if lockdown active
        if (this.isLockedDown(guild.id)) {
          // restore from snapshot
          const snap = await this.snapshotManager.getSnapshot(guild.id);
          if (snap) await restoreGuildFromSnapshot(guild, snap).catch(()=>{});
        }
      } catch (e) {}
    });

    client.on('channelCreate', async (channel) => {
      try {
        const guild = channel.guild;
        // containment: if creator is flagged nuker, delete the channel
        const creatorId = (channel?.creatorId) || (channel?.lastMessage?.author?.id) || null;
        // best-effort: try fetch audit logs for create
        let executorId = null;
        try {
          const logs = await guild.fetchAuditLogs({ type: 'CHANNEL_CREATE', limit: 1 });
          const entry = logs.entries.first();
          if (entry && entry.executor) executorId = entry.executor.id;
        } catch(e){}

        const flagged = this.flagged.get(guild.id);
        if (executorId && flagged && flagged.has(executorId)) {
          try { await channel.delete('Containment: channel created by flagged nuker'); } catch(e){}
        }
      } catch(e){}
    });

    // Listen for explicit external reports of deletes (this function will be used by permissionMonitor or other code)
    client.on('antiNuke:channelDeleteBy', async ({ guildId, userId }) => {
      try {
        const hit = this.rateLimiter.record(guildId, userId);
        if (hit) {
          await this._handleNukeDetected(guildId, userId);
        }
      } catch (e) {}
    });
  }

  isLockedDown(guildId) {
    const ts = this.lockdowns.get(guildId) || 0;
    return Date.now() < ts;
  }

  async _onDangerDetected(guild, member, details) {
    try {
      // flag member
      if (!this.flagged.has(guild.id)) this.flagged.set(guild.id, new Set());
      this.flagged.get(guild.id).add(member.id);

      // remove elevated perms already done by permissionMonitor; now lockdown
      await this._triggerLockdown(guild);

      this.modLog(guild, { type: 'permission_prevention', member: member.id, details });
    } catch (e) {}
  }

  async _triggerLockdown(guild) {
    try {
      // set lockdown for 5 seconds
      this.lockdowns.set(guild.id, Date.now() + 5000);
      // NOTE: We no longer delete ALL webhooks during lockdown.
      // Deleting all webhooks destroys integrations (GitHub, CI/CD, logging bots).
      // Instead, log the lockdown event for staff review.
      this.modLog(guild, { type: 'lockdown_activated', duration: '5s', guildId: guild.id });
    } catch (e) {}
  }

  async _handleNukeDetected(guildId, userId) {
    try {
      // SECURITY: Never act against whitelisted users, owner, or self
      if (this.whitelist.has(userId)) return;

      const guild = await this.client.guilds.fetch(guildId).catch(()=>null);
      if (!guild) return;

      if (guild.ownerId === userId) return;
      if (this.client.user && this.client.user.id === userId) return;

      // Hierarchy check
      const botMember = guild.members.me;
      const targetMember = await guild.members.fetch(userId).catch(() => null);
      if (targetMember && botMember && targetMember.roles.highest.position >= botMember.roles.highest.position) {
        this.modLog(guild, { type: 'nuke_detected_but_cannot_act', userId, reason: 'hierarchy' });
        return;
      }

      // try to ban executor
      try {
        await guild.members.ban(userId, { reason: 'Detected nuke - automated mitigation' });
      } catch (e) {
        // fallback: remove roles from member
        try {
          const m = await guild.members.fetch(userId).catch(()=>null);
          if (m) {
            for (const r of m.roles.cache.values()) {
              if (r.managed) continue;
              try { await m.roles.remove(r.id, 'Automated removal after nuke detection'); } catch(e){}
            }
          }
        } catch(e){}
      }

      // trigger lockdown and restore
      await this._triggerLockdown(guild);
      const snap = await this.snapshotManager.getSnapshot(guild.id);
      if (snap) await restoreGuildFromSnapshot(guild, snap).catch(()=>{});

      this.modLog(guild, { type: 'nuke_detected', userId });
    } catch (e) {}
  }
}

module.exports = AntiNukeManager;
