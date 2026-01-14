const { PermissionsBitField } = require('discord.js');
const { t } = require('../../locale');

class VerificationActions {
  constructor(bot) {
    this.bot = bot;
  }

  async getGuildConfig(guildId) {
    const cfg = await this.bot.database.getGuildConfig(guildId);
    return cfg || {};
  }

  async assertEnabled(guildId) {
    const cfg = await this.getGuildConfig(guildId);
    if (!cfg.verification_enabled) throw new Error('Verification disabled');
    return cfg;
  }

  async canAct(guildId, actorId) {
    const guild = this.bot.client.guilds.cache.get(guildId);
    if (!guild) return false;
    try {
      const member = await guild.members.fetch(actorId);
      if (!member) return false;
      if (guild.ownerId === actorId) return true;
      return member.permissions.has(PermissionsBitField.Flags.Administrator) ||
             member.permissions.has(PermissionsBitField.Flags.ManageGuild);
    } catch { return false; }
  }

  async applyRoles(guild, userId, { add = [], remove = [] }) {
    try {
      const member = await guild.members.fetch(userId);
      for (const r of remove) if (r) await member.roles.remove(r).catch(() => {});
      for (const r of add) if (r) await member.roles.add(r).catch(() => {});
    } catch (e) {
      this.bot.logger?.warn('[VERIFICATION] Role update failed:', e.message);
    }
  }

  async record(guildId, userId, data) {
    const now = new Date().toISOString();
    const { status = 'pending', method = null, actor_id = null, source = null, profile_used = null, risk_score = null, notes = null } = data || {};
    await this.bot.database.run(
      `INSERT INTO verification_records (guild_id, user_id, status, method, actor_id, source, profile_used, risk_score, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET status=excluded.status, method=excluded.method, actor_id=excluded.actor_id, source=excluded.source, profile_used=excluded.profile_used, risk_score=COALESCE(excluded.risk_score, verification_records.risk_score), notes=COALESCE(excluded.notes, verification_records.notes), updated_at=excluded.updated_at`,
      [guildId, userId, status, method, actor_id, source, profile_used, risk_score, notes, now, now]
    );
  }

  notify(guildId, message, extra) {
    try {
      const payload = { type: 'dashboardEvent', guildId, timestamp: Date.now(), group: extra?.group || 'verification', source: extra?.source || 'system', actorId: extra?.actorId || null, ...extra, message };
      if (this.bot.dashboard && typeof this.bot.dashboard.broadcastToGuild === 'function') {
        this.bot.dashboard.broadcastToGuild(guildId, payload);
      }
    } catch {}
  }

  allowedTransition(prev, next) {
    const allowed = {
      pending: new Set(['captcha_required','verified','skipped','kicked','approved','rejected','expired','awaiting_approval']),
      captcha_required: new Set(['captcha_passed','skipped','kicked','expired']),
      captcha_passed: new Set(['awaiting_approval','verified','skipped','kicked','expired']),
      awaiting_approval: new Set(['approved','rejected','kicked']),
      approved: new Set(['verified']),
      rejected: new Set([]),
      verified: new Set([]),
      skipped: new Set([]),
      kicked: new Set([]),
      expired: new Set([])
    };
    const set = allowed[prev] || new Set();
    return set.has(next);
  }

  async getPrevStatus(guildId, userId) {
    const row = await this.bot.database.get(
      `SELECT status FROM verification_records WHERE guild_id = ? AND user_id = ?`,
      [guildId, userId]
    );
    return row?.status || 'pending';
  }

  async setStatus(guildId, userId, status, meta = {}) {
    const prev = await this.getPrevStatus(guildId, userId);
    // Graceful noops for idempotent transitions
    if (prev === status && ['verified','skipped','kicked','expired','awaiting_approval'].includes(status)) {
      this.notify(guildId, `[NOOP] ${userId}: already ${status}`, { event: 'STATUS_NOOP', userId, prev, next: status, group: 'verification', source: meta.source || 'system', actorId: meta.actor_id || null });
      return status;
    }
    if (!this.allowedTransition(prev, status)) {
      // Soft invalid: warn and keep prev without throwing for batch ops
      if (meta.soft) {
        this.notify(guildId, `[WARN] Invalid transition ${prev} -> ${status} for ${userId}`, { event: 'STATUS_INVALID', userId, prev, next: status, group: 'verification', source: meta.source || 'system', actorId: meta.actor_id || null });
        return prev;
      }
      throw new Error(`Invalid status transition: ${prev} -> ${status}`);
    }
    await this.record(guildId, userId, { status, ...meta });
    this.notify(guildId, `[STATUS] ${userId}: ${prev} -> ${status}`, { event: 'STATUS_CHANGE', userId, prev, next: status, group: 'verification', source: meta.source || 'system', actorId: meta.actor_id || null });
    return status;
  }

  async handleJoin(member) {
    const guildId = member.guild.id;
    const userId = member.id;
    const cfg = await this.getGuildConfig(guildId);

    this.bot.logger?.info(`👤 New member joined: ${member.user.tag} (${userId}) in ${member.guild.name}`);
    this.notify(guildId, 'USER_JOINED', { event: 'USER_JOINED', userId, username: member.user.tag, group: 'verification', source: 'system' });

    // Create/Update basic record
    await this.bot.database.createOrUpdateUserRecord(guildId, userId, {
      username: member.user.username,
      discriminator: member.user.discriminator,
      join_date: new Date().toISOString(),
      account_created: member.user.createdAt.toISOString(),
      verification_status: 'unverified'
    });

    // Queue record as pending
    // Idempotent: check existing record
    const prev = await this.getPrevStatus(guildId, userId);
    if (['pending','awaiting_approval','captcha_required','captcha_passed'].includes(prev)) {
      // Already queued
    } else {
      // Check account age for High/Ultra profiles
      const profile = cfg.verification_profile || 'standard';
      const minAgeDays = cfg.verification_min_account_age_days || 0;
      const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / (1000*60*60*24));
      
      let riskScore = 0;
      if (accountAgeDays < 7) riskScore += 30;
      if (accountAgeDays < 1) riskScore += 50;
      if (!member.user.avatar) riskScore += 20;
      if (/discord|admin|mod|official|support/i.test(member.user.username)) riskScore += 30;
      
      // Auto-reject if below minimum age for High/Ultra (only if auto_action_enabled)
      if ((profile === 'high' || profile === 'ultra') && minAgeDays > 0 && accountAgeDays < minAgeDays) {
        await this.setStatus(guildId, userId, 'rejected', { source: 'join', method: 'auto_age_check', risk_score: riskScore });
        this.notify(guildId, 'AUTO_REJECTED_AGE', { event: 'AUTO_REJECTED', userId, reason: 'account_age', group: 'verification', source: 'system' });
        
        // Only kick if auto_action_enabled
        if (cfg.auto_action_enabled) {
          try {
            await member.kick(`Account too new (${accountAgeDays}d < ${minAgeDays}d required)`);
          } catch {}
        } else {
          this.notify(guildId, 'AUTO_ACTION_SKIPPED', { event: 'AUTO_ACTION_SKIPPED', userId, reason: 'auto_action_disabled', group: 'verification', source: 'system' });
        }
        return;
      }

      // Determine initial status based on profile
      let initialStatus = 'pending';
      if (profile === 'high' || profile === 'ultra') {
        initialStatus = 'captcha_required';
      }
      await this.setStatus(guildId, userId, initialStatus, { source: 'join', risk_score: riskScore, profile_used: profile });
      this.notify(guildId, 'QUEUE_ADDED', { event: 'QUEUE_ADDED', userId, riskScore, profile, group: 'verification', source: 'system' });
    }

    // Assign unverified role if enabled
    if (cfg.verification_enabled) {
      const guild = member.guild;
      const unverifiedRole = cfg.unverified_role_id && guild.roles.cache.get(cfg.unverified_role_id);
      if (unverifiedRole) {
        const memberObj = await guild.members.fetch(userId).catch(() => null);
        const hasRole = memberObj?.roles?.cache?.has(unverifiedRole.id);
        if (!hasRole) {
          await this.applyRoles(guild, userId, { add: [unverifiedRole] });
          this.notify(guildId, 'ROLE_ASSIGNED_UNVERIFIED', { event: 'ROLE_ASSIGNED_UNVERIFIED', userId, group: 'verification', source: 'system' });
        }
      }

      // Localized DM welcome
      const lang = cfg.verification_language || 'en';
      try {
        const welcomeMsg = t(lang, 'verification.dm.welcome', { server: guild.name });
        await member.send({ content: welcomeMsg });
        this.notify(guildId, 'VERIFICATION_DM_SENT', { event: 'VERIFICATION_DM_SENT', userId, group: 'verification', source: 'system' });
      } catch {}

      // Staff alert (buttons)
      this.notify(guildId, 'STAFF_ALERT_SENT', { event: 'STAFF_ALERT_SENT', userId, group: 'verification', source: 'system' });
    }
  }

  async verifyUser(guildId, userId, actorId = null, source = 'dashboard') {
    const cfg = await this.assertEnabled(guildId);
    const guild = this.bot.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');

    // For high/ultra profiles ensure captcha is satisfied before direct verify
    const current = await this.getPrevStatus(guildId, userId);
    const profile = cfg.verification_profile || 'standard';
    if ((profile === 'high' || profile === 'ultra') && !['captcha_passed','awaiting_approval','approved','verified'].includes(current)) {
      throw new Error('Captcha not completed');
    }

    await this.setStatus(guildId, userId, 'verified', { actor_id: actorId, source, method: 'button', profile_used: cfg.verification_profile || 'standard' });

    const add = [cfg.verified_role_id && guild.roles.cache.get(cfg.verified_role_id)];
    const remove = [cfg.unverified_role_id && guild.roles.cache.get(cfg.unverified_role_id)];
    await this.applyRoles(guild, userId, { add, remove });
    this.notify(guildId, 'USER_VERIFIED', { event: 'USER_VERIFIED', userId, actorId, source, group: 'verification' });
    
    // DM user success
    try {
      const lang = cfg.verification_language || 'en';
      const successMsg = t(lang, 'verification.dm.verified_success', { server: guild.name });
      const member = await guild.members.fetch(userId).catch(() => null);
      await member?.send({ content: successMsg }).catch(() => {});
    } catch {}

    // Send deferred welcome message if welcome system is also enabled
    if (cfg.welcome_enabled && cfg.welcome_channel) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await this.sendDeferredWelcome(guild, member, cfg);
        }
      } catch (e) {
        this.bot.logger?.warn('[WELCOME] Failed to send deferred welcome after verification:', e.message);
      }
    }

    return { success: true };
  }

  async skipUser(guildId, userId, actorId, source = 'dashboard') {
    await this.assertEnabled(guildId);
    const guild = this.bot.client.guilds.cache.get(guildId);
    await this.setStatus(guildId, userId, 'skipped', { actor_id: actorId, source });

    const cfg = await this.getGuildConfig(guildId);
    const add = [cfg.verified_role_id && guild.roles.cache.get(cfg.verified_role_id)];
    const remove = [cfg.unverified_role_id && guild.roles.cache.get(cfg.unverified_role_id)];
    await this.applyRoles(guild, userId, { add, remove });
    this.notify(guildId, 'STAFF_SKIPPED', { event: 'STAFF_SKIPPED', userId, actorId, source, group: 'verification' });
    return { success: true };
  }

  async kickUser(guildId, userId, actorId, source = 'dashboard') {
    const guild = this.bot.client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not found');
    const ok = await this.canAct(guildId, actorId);
    if (!ok) throw new Error('Forbidden');

    try { await guild.members.kick(userId, 'Verification kick'); } catch {}
    await this.setStatus(guildId, userId, 'kicked', { actor_id: actorId, source });
    this.notify(guildId, 'STAFF_KICKED', { event: 'STAFF_KICKED', userId, actorId, source, group: 'verification' });
    return { success: true };
  }

  async approveUser(guildId, userId, actorId, source = 'dashboard') {
    // Ultra mode approval
    await this.setStatus(guildId, userId, 'approved', { actor_id: actorId, source });
    this.notify(guildId, 'DASHBOARD_APPROVE', { event: 'DASHBOARD_APPROVE', userId, actorId, source, group: 'verification' });
    return this.verifyUser(guildId, userId, actorId, source);
  }

  async rejectUser(guildId, userId, actorId, source = 'dashboard') {
    await this.setStatus(guildId, userId, 'rejected', { actor_id: actorId, source });
    this.notify(guildId, 'DASHBOARD_REJECT', { event: 'DASHBOARD_REJECT', userId, actorId, source, group: 'verification' });
    return { success: true };
  }

  // Captcha management (simple in-memory for now)
  ensureCaptchaStore() {
    if (!this.bot._captchaStore) this.bot._captchaStore = new Map(); // key: guildId:userId -> { code, expires }
    return this.bot._captchaStore;
  }

  async requestCaptcha(guildId, userId, actorId = null, source = 'system') {
    const cfg = await this.assertEnabled(guildId);
    const profile = cfg.verification_profile || 'standard';
    if (profile === 'standard') {
      return { success: false, error: 'Captcha not required for standard profile' };
    }
    const current = await this.getPrevStatus(guildId, userId);
    if (current !== 'captcha_required') {
      return { success: false, error: 'Not in captcha_required state' };
    }
    const store = this.ensureCaptchaStore();
    const code = Math.random().toString().slice(2, 8); // 6 digits
    store.set(`${guildId}:${userId}`, { code, expires: Date.now() + 10 * 60 * 1000 });
    this.notify(guildId, 'CAPTCHA_ISSUED', { event: 'CAPTCHA_ISSUED', userId, group: 'verification', source });
    // Send DM with captcha prompt (still returning code for dashboard demo)
    try {
      const guild = this.bot.client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      const lang = cfg.verification_language || 'en';
      const promptMsg = t(lang, 'captcha.prompt', { code });
      await member?.send({ content: promptMsg }).catch(() => {});
    } catch {}
    return { success: true, code };
  }

  async submitCaptcha(guildId, userId, providedCode, actorId = null, source = 'user') {
    const cfg = await this.assertEnabled(guildId);
    const store = this.ensureCaptchaStore();
    const entry = store.get(`${guildId}:${userId}`);
    if (!entry) return { success: false, error: 'Captcha not requested' };
    if (Date.now() > entry.expires) {
      store.delete(`${guildId}:${userId}`);
      await this.setStatus(guildId, userId, 'expired', { source: 'captcha' });
      return { success: false, error: 'Captcha expired' };
    }
    if (entry.code !== providedCode) {
      return { success: false, error: 'Invalid code' };
    }
    store.delete(`${guildId}:${userId}`);
    await this.setStatus(guildId, userId, 'captcha_passed', { source });
    this.notify(guildId, 'CAPTCHA_PASSED', { event: 'CAPTCHA_PASSED', userId, group: 'verification', source });
    // DM user about result
    try {
      const guild = this.bot.client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      const lang = cfg.verification_language || 'en';
      const profileMsgKey = profile === 'ultra' ? 'verification.dm.captcha_passed_ultra' : 'verification.dm.captcha_passed_high';
      const msg = t(lang, profileMsgKey, { server: guild?.name || '' });
      await member?.send({ content: msg }).catch(() => {});
    } catch {}
    // For ultra move to awaiting_approval, for high directly verify
    const profile = cfg.verification_profile || 'standard';
    if (profile === 'ultra') {
      await this.setStatus(guildId, userId, 'awaiting_approval', { source: 'captcha' });
      this.notify(guildId, 'AWAITING_APPROVAL', { event: 'AWAITING_APPROVAL', userId, group: 'verification', source: 'captcha' });
    } else if (profile === 'high') {
      // auto verify
      await this.verifyUser(guildId, userId, actorId, 'captcha');
    }
    return { success: true };
  }

  // Notes System
  async appendNote(guildId, userId, actorId, noteText, source) {
    if (!noteText || !noteText.trim()) return { success: false, error: 'Empty note' };
    const can = await this.canAct(guildId, actorId);
    if (!can) return { success: false, error: 'Forbidden' };
    const existing = await this.bot.database.get(`SELECT notes FROM verification_records WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);
    const timestamp = new Date().toISOString().replace('T',' ').slice(0,19);
    const line = `[${timestamp}] (${actorId}) ${noteText.trim()}`;
    const combined = existing?.notes ? `${existing.notes}\n${line}` : line;
    await this.bot.database.run(`UPDATE verification_records SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?`, [combined, guildId, userId]);
    this.notify(guildId, 'NOTE_ADDED', { event: 'NOTE_ADDED', userId, actorId, source, noteText: noteText.trim(), group: 'verification' });
    return { success: true, notes: combined };
  }

  async updateNote(guildId, userId, actorId, noteText, source) {
    if (!noteText || !noteText.trim()) return { success: false, error: 'Empty note' };
    // Admin-only (reuse canAct)
    const can = await this.canAct(guildId, actorId);
    if (!can) return { success: false, error: 'Forbidden' };
    const timestamp = new Date().toISOString().replace('T',' ').slice(0,19);
    const newBlock = `[${timestamp}] (${actorId}) REPLACED:\n${noteText.trim()}`;
    await this.bot.database.run(`UPDATE verification_records SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND user_id = ?`, [newBlock, guildId, userId]);
    this.notify(guildId, 'NOTE_UPDATED', { event: 'NOTE_UPDATED', userId, actorId, source, noteText: noteText.trim(), group: 'verification' });
    return { success: true, notes: newBlock };
  }

  async addNote(guildId, userId, actorId, noteText, source) {
    return this.appendNote(guildId, userId, actorId, noteText, source);
  }

  async sendDeferredWelcome(guild, member, config) {
    try {
      const channelId = config.welcome_channel;
      const channel = channelId ? guild.channels.cache.get(channelId) : null;
      if (!channel || !channel.isTextBased()) return;

      let customization;
      try {
        customization = JSON.parse(config.welcome_message);
      } catch (e) {
        customization = { message: config.welcome_message || 'Welcome {user} to **{server}**! You are member #{memberCount}! 🎉' };
      }

      // Replace placeholders
      const message = customization.message
        .replace(/{user}/g, member.user.toString())
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, guild.name)
        .replace(/{memberCount}/g, guild.memberCount.toString());

      const { EmbedBuilder } = require('discord.js');

      // Build embed if customization exists
      if (customization.embedTitle || customization.embedColor || customization.imageUrl) {
        const embed = new EmbedBuilder()
          .setColor(customization.embedColor || '#00d4ff')
          .setDescription(message)
          .setTimestamp();

        if (customization.embedTitle) embed.setTitle(customization.embedTitle);
        if (customization.imageUrl) embed.setImage(customization.imageUrl);

        await channel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: message });
      }

      this.bot.logger?.info(`[WELCOME] Sent deferred welcome for ${member.user.tag} after verification`);
    } catch (e) {
      this.bot.logger?.warn('[WELCOME] sendDeferredWelcome error:', e.message);
    }
  }
}

module.exports = VerificationActions;
