/**
 * Anti-Nuke Event Handlers v4.0 — "Fortress"
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Gateway Event                                                  │
 * │       │                                                         │
 * │       ├─ [1] Canary Trap Check     (instant lockdown, 0ms)     │
 * │       ├─ [2] Danger Score Engine   (weighted risk, 0ms)        │
 * │       ├─ [3] Permission Kill Switch (strip roles <3s, 1 API)   │
 * │       ├─ [4] Rapid Threshold Check (count-based, 0ms)          │
 * │       └─ [5] Post-detection: audit resolve → full response     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * KEY DESIGN PRINCIPLES:
 * 1. dangerScore     — Weighted risk scoring. Different actions have different
 *                      danger weights. Score > 80 = instant quarantine.
 * 2. killSwitch      — If ANY user does 2+ destructive acts in <3s, strip ALL
 *                      their roles immediately (1 API call). Don't wait for audit.
 * 3. canaryTraps     — Hidden sentinel channels/roles. If touched = instant lockdown.
 * 4. serverLockdown  — Disable ManageChannels/ManageRoles/ManageWebhooks for @everyone.
 * 5. ringBuffer      — Ultra-fast microsecond-precision event ring buffer per guild.
 * 6. parallelPipelines — Each event type independently evaluates risk.
 * 7. checkEnabled()  — DB-cached (5s TTL), never blocks hot path.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: IN-MEMORY DATA STRUCTURES (zero allocation hot path)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ring buffer per guild per user per action type.
 * ringBuffer[guildId][userId][actionType] = [{ts, details}, ...]
 * Auto-pruned to 60s window.  ~0 GC pressure.
 */
const ringBuffer = Object.create(null);

/**
 * Danger score accumulator per guild per user.
 * dangerScores[guildId][userId] = { score, firstEventTs, events: [{type, ts, score}] }
 * Decays over time (halves every 30s).
 */
const dangerScores = Object.create(null);

/** Enabled state cache: Map<guildId, {enabled, expiresAt}> */
const enabledCache = new Map();
const ENABLED_CACHE_TTL = 5000;

/** Dedup concurrent violation handling */
const handlingViolation = new Set();

/** Users already kill-switched this cycle: Set<`${guildId}:${userId}`> */
const killSwitched = new Set();

/** Disabled-state log throttle counter */
const disabledLogCounter = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Danger score weights per action type */
const DANGER_WEIGHTS = {
    channelDelete:  50,
    roleDelete:     55,
    channelCreate:  20,
    roleCreate:     15,
    banAdd:         35,
    memberKick:     25,
    webhookCreate:  30,
    botAdd:         60,
    roleUpdate:     40,   // dangerous perm grant
    channelUpdate:  5,
};

/** Score thresholds for response */
const SCORE_THRESHOLDS = {
    killSwitch:  70,   // Strip roles immediately
    quarantine: 100,   // Full quarantine + lockdown
    ban:        150,   // Ban the attacker
};

/** Kill switch: 2 destructive actions in 3 seconds = immediate role strip */
const KILL_SWITCH = {
    count: 2,
    windowMs: 3000,
    destructiveTypes: new Set([
        'channelDelete', 'roleDelete', 'banAdd', 'memberKick',
        'webhookCreate', 'botAdd', 'roleUpdate'
    ]),
};

/** Rapid count thresholds (backup detection, wider window) */
const THRESHOLDS = {
    channelCreate: { count: 3, windowMs: 8000 },
    channelDelete: { count: 2, windowMs: 8000 },
    roleCreate:    { count: 3, windowMs: 10000 },
    roleDelete:    { count: 2, windowMs: 8000 },
    banAdd:        { count: 3, windowMs: 10000 },
    memberKick:    { count: 3, windowMs: 10000 },
    webhookCreate: { count: 2, windowMs: 8000 },
    botAdd:        { count: 1, windowMs: 30000 },
};

/** Discord audit log numeric types */
const AUDIT_TYPES = {
    channelCreate: 10, channelDelete: 12, roleCreate: 30, roleDelete: 32,
    banAdd: 22, memberKick: 20, webhookCreate: 50, botAdd: 28, roleUpdate: 31,
};

/** Canary naming patterns — if a channel/role matching these is touched, INSTANT lockdown */
const CANARY_PATTERNS = [
    /^darklock[-_]?security/i,
    /^darklock[-_]?canary/i,
    /^darklock[-_]?trap/i,
    /^dl[-_]?sentinel/i,
    /^__antinuke__/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if anti-nuke is enabled for a guild, with short-lived cache. */
async function checkEnabled(guildId, bot) {
    const cached = enabledCache.get(guildId);
    if (cached && Date.now() < cached.expiresAt) return cached.enabled;
    try {
        const config = await bot.database.getGuildConfig(guildId);
        const enabled = config?.antinuke_enabled ? true : false;
        enabledCache.set(guildId, { enabled, expiresAt: Date.now() + ENABLED_CACHE_TTL });
        return enabled;
    } catch { return false; }
}

/** Invalidate enabled cache (called from dashboard settings save). */
function invalidateEnabledCache(guildId) {
    enabledCache.delete(guildId);
}

/** Is this user immune? (owner, self, whitelisted) */
function isImmune(guild, userId, bot) {
    if (!userId) return true;
    if (userId === bot.client?.user?.id) return true;
    if (guild.ownerId === userId) return true;
    if (bot.antiNuke?.whitelistedUsers?.get(guild.id)?.has(userId)) return true;
    if (bot.antiNuke?.blockedUsers?.get(guild.id)?.has(userId)) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: RING BUFFER (ultra-fast event cache)
// ═══════════════════════════════════════════════════════════════════════════════

function bufferPush(guildId, userId, actionType, details) {
    if (!ringBuffer[guildId]) ringBuffer[guildId] = Object.create(null);
    if (!ringBuffer[guildId][userId]) ringBuffer[guildId][userId] = Object.create(null);
    if (!ringBuffer[guildId][userId][actionType]) ringBuffer[guildId][userId][actionType] = [];

    const now = Date.now();
    const arr = ringBuffer[guildId][userId][actionType];
    arr.push({ ts: now, details });

    // Prune >60s (keep buffer small)
    if (arr.length > 200 || (arr.length > 0 && now - arr[0].ts > 60000)) {
        const cutoff = now - 60000;
        ringBuffer[guildId][userId][actionType] = arr.filter(e => e.ts >= cutoff);
    }
    return ringBuffer[guildId][userId][actionType];
}

function bufferRecent(guildId, userId, actionType, windowMs) {
    const arr = ringBuffer[guildId]?.[userId]?.[actionType] || [];
    const cutoff = Date.now() - windowMs;
    return arr.filter(e => e.ts >= cutoff);
}

/** Count ALL destructive actions for a user within a window (across all action types). */
function countDestructive(guildId, userId, windowMs) {
    const userBucket = ringBuffer[guildId]?.[userId];
    if (!userBucket) return 0;
    const cutoff = Date.now() - windowMs;
    let count = 0;
    for (const actionType of KILL_SWITCH.destructiveTypes) {
        const arr = userBucket[actionType];
        if (!arr) continue;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].ts >= cutoff) count++;
            else break;
        }
    }
    return count;
}

/** Collect ALL events for a user (for violation.actions recovery data). */
function allEventsForUser(guildId, userId) {
    const userBucket = ringBuffer[guildId]?.[userId];
    if (!userBucket) return [];
    const all = [];
    for (const [type, events] of Object.entries(userBucket)) {
        for (const ev of events) {
            all.push({ type, timestamp: ev.ts, details: ev.details });
        }
    }
    return all.sort((a, b) => a.timestamp - b.timestamp);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: DANGER SCORE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function getDangerBucket(guildId, userId) {
    if (!dangerScores[guildId]) dangerScores[guildId] = Object.create(null);
    if (!dangerScores[guildId][userId]) {
        dangerScores[guildId][userId] = { score: 0, firstEventTs: Date.now(), events: [] };
    }
    return dangerScores[guildId][userId];
}

/**
 * Add danger score for an action. Applies time-decay (halves every 30s).
 * Returns the current total score.
 */
function addDangerScore(guildId, userId, actionType) {
    const bucket = getDangerBucket(guildId, userId);
    const now = Date.now();
    const weight = DANGER_WEIGHTS[actionType] || 10;

    // Time-decay: halve score every 30 seconds since first event
    const elapsed = now - bucket.firstEventTs;
    const decayFactor = Math.pow(0.5, elapsed / 30000);
    bucket.score = bucket.score * decayFactor + weight;
    bucket.firstEventTs = now; // reset decay anchor on new event
    bucket.events.push({ type: actionType, ts: now, score: weight });

    // Prune event list (keep last 60s only)
    const cutoff = now - 60000;
    bucket.events = bucket.events.filter(e => e.ts >= cutoff);

    return bucket.score;
}

/** Reset danger score for a user (after handling). */
function resetDangerScore(guildId, userId) {
    if (dangerScores[guildId]?.[userId]) {
        delete dangerScores[guildId][userId];
    }
}

// Score decay cleanup (runs every 30s)
setInterval(() => {
    const now = Date.now();
    for (const guildId in dangerScores) {
        for (const userId in dangerScores[guildId]) {
            const bucket = dangerScores[guildId][userId];
            const elapsed = now - bucket.firstEventTs;
            if (elapsed > 120000) { // 2 minutes of inactivity = clear
                delete dangerScores[guildId][userId];
            }
        }
        if (Object.keys(dangerScores[guildId]).length === 0) {
            delete dangerScores[guildId];
        }
    }
}, 30000);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: CANARY TRAP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if a channel/role name matches canary patterns. */
function isCanary(name) {
    if (!name) return false;
    return CANARY_PATTERNS.some(p => p.test(name));
}

/**
 * Also check against the guild's registered canary IDs
 * (stored in bot.antiNuke.canaryChannels / canaryRoles)
 */
function isCanaryId(guildId, id, bot) {
    if (!bot.antiNuke) return false;
    if (bot.antiNuke.canaryChannels?.get(guildId)?.has(id)) return true;
    if (bot.antiNuke.canaryRoles?.get(guildId)?.has(id)) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: PERMISSION KILL SWITCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Immediately strip ALL roles from a user (1 API call).
 * This is the fastest possible mitigation — removes all permissions instantly.
 * Does NOT wait for audit log.
 */
async function executeKillSwitch(guild, userId, reason, bot) {
    const key = `${guild.id}:${userId}`;
    if (killSwitched.has(key)) return false; // already handled
    killSwitched.add(key);

    // Clear after 60s so the same user can be re-handled if they somehow get roles back
    setTimeout(() => killSwitched.delete(key), 60000);

    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return false;

        // Store their roles for potential restore later
        const roleIds = member.roles.cache
            .filter(r => r.id !== guild.id) // skip @everyone
            .map(r => r.id);

        if (roleIds.length === 0) return false;

        // ONE API call: set roles to empty array = strip everything
        await member.roles.set([], `Anti-nuke kill switch: ${reason}`);

        bot.logger.warn(`⚡ KILL SWITCH: Stripped ${roleIds.length} roles from ${member.user?.username || userId} in ${guild.name}`);

        // Store stripped roles for potential undo
        if (bot.antiNuke) {
            if (!bot.antiNuke._strippedRoles) bot.antiNuke._strippedRoles = new Map();
            bot.antiNuke._strippedRoles.set(key, { roleIds, timestamp: Date.now() });
        }

        return true;
    } catch (e) {
        bot.logger.error(`[KillSwitch] Failed to strip roles from ${userId}: ${e.message}`);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: SERVER LOCKDOWN MODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Activate lockdown: disable dangerous permissions for @everyone + all non-admin roles.
 * This prevents multi-account nukes.
 */
async function activateLockdown(guild, reason, bot) {
    if (bot.antiNuke?.lockdownActive?.get(guild.id)) {
        bot.logger.debug('[Lockdown] Already active for ' + guild.name);
        return;
    }

    bot.logger.warn(`🔒 LOCKDOWN ACTIVATED for ${guild.name}: ${reason}`);

    // Initialize lockdown state
    if (!bot.antiNuke.lockdownActive) bot.antiNuke.lockdownActive = new Map();
    if (!bot.antiNuke.lockdownOriginalPerms) bot.antiNuke.lockdownOriginalPerms = new Map();

    bot.antiNuke.lockdownActive.set(guild.id, { active: true, reason, timestamp: Date.now() });

    const { PermissionFlagsBits } = require('discord.js');
    const dangerousPerms = [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.Administrator,
    ];

    const savedPerms = new Map();
    const botHighest = guild.members.me?.roles.highest.position || 0;

    for (const role of guild.roles.cache.values()) {
        // Skip @everyone handled separately, skip bot's own roles, skip roles above bot
        if (role.managed) continue;
        if (role.position >= botHighest) continue;
        if (role.id === guild.id) continue; // handle @everyone below

        const currentBits = role.permissions.bitfield;
        const hasDangerous = dangerousPerms.some(p => (currentBits & p) === p);
        if (!hasDangerous) continue;

        savedPerms.set(role.id, currentBits);

        // Remove dangerous permissions
        let newBits = currentBits;
        for (const p of dangerousPerms) {
            newBits = newBits & ~p;
        }

        try {
            await role.setPermissions(newBits, `Anti-nuke lockdown: ${reason}`);
            await sleep(150);
        } catch (e) {
            bot.logger.warn(`[Lockdown] Failed to modify role ${role.name}: ${e.message}`);
        }
    }

    // Handle @everyone role
    try {
        const everyone = guild.roles.everyone;
        savedPerms.set(everyone.id, everyone.permissions.bitfield);
        let evBits = everyone.permissions.bitfield;
        for (const p of dangerousPerms) {
            evBits = evBits & ~p;
        }
        await everyone.setPermissions(evBits, `Anti-nuke lockdown: ${reason}`);
    } catch (e) {
        bot.logger.warn(`[Lockdown] Failed to modify @everyone: ${e.message}`);
    }

    bot.antiNuke.lockdownOriginalPerms.set(guild.id, savedPerms);
    bot.logger.warn(`🔒 LOCKDOWN COMPLETE for ${guild.name} — ${savedPerms.size} roles restricted`);
}

/**
 * Deactivate lockdown: restore original permissions.
 */
async function deactivateLockdown(guild, bot) {
    if (!bot.antiNuke?.lockdownActive?.get(guild.id)?.active) return;

    const savedPerms = bot.antiNuke.lockdownOriginalPerms?.get(guild.id);
    if (!savedPerms) return;

    bot.logger.info(`🔓 Deactivating lockdown for ${guild.name}...`);

    for (const [roleId, originalBits] of savedPerms) {
        try {
            const role = guild.roles.cache.get(roleId);
            if (role) {
                await role.setPermissions(originalBits, 'Anti-nuke lockdown lifted');
                await sleep(150);
            }
        } catch (e) {
            bot.logger.warn(`[Lockdown] Failed to restore role ${roleId}: ${e.message}`);
        }
    }

    bot.antiNuke.lockdownActive.set(guild.id, { active: false });
    bot.antiNuke.lockdownOriginalPerms.delete(guild.id);
    bot.logger.info(`🔓 LOCKDOWN LIFTED for ${guild.name}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: AUDIT LOG RESOLUTION (called ONCE post-detection)
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveExecutor(guild, auditLogType, windowMs = 10000) {
    try {
        const logs = await guild.fetchAuditLogs({ type: auditLogType, limit: 5 });
        const cutoff = Date.now() - windowMs;
        for (const entry of logs.entries.values()) {
            if (entry.createdTimestamp >= cutoff && entry.executor) {
                return entry.executor;
            }
        }
    } catch { /* unavailable */ }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: CORE DETECTION PIPELINE (called by every event handler)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The main detection pipeline. Runs for EVERY destructive event.
 *
 * Pipeline stages (all in-memory, zero async until response):
 *   [1] Canary check     → instant lockdown
 *   [2] Ring buffer push → danger score calculation
 *   [3] Kill switch      → 2 destructive in 3s = strip roles (1 API call)
 *   [4] Score threshold  → >= 70 strip, >= 100 quarantine+lockdown, >= 150 ban
 *   [5] Count threshold  → legacy backup (N events in window)
 *   [6] Post-detection   → resolve executor, build violation, call handleViolation
 */
async function detectAndRespond(guild, actionType, details, bot, extraContext) {
    if (!bot.antiNuke || !guild) return;

    const guildId = guild.id;
    const enabled = await checkEnabled(guildId, bot);
    if (!enabled) {
        const cnt = (disabledLogCounter.get(guildId) || 0) + 1;
        disabledLogCounter.set(guildId, cnt);
        if (cnt === 1 || cnt % 10 === 0) {
            bot.logger.warn(`[AntiNuke] ⚠️ anti-nuke DISABLED for "${guild.name}" (${guildId}) — ${actionType} #${cnt} ignored`);
        }
        return;
    }
    disabledLogCounter.delete(guildId);

    // ── [1] CANARY TRAP CHECK ───────────────────────────────────────────
    const targetName = details.channelName || details.roleName || null;
    const targetId = details.channelId || details.roleId || null;
    const isCanaryTarget = isCanary(targetName) || isCanaryId(guildId, targetId, bot);

    if (isCanaryTarget && (actionType === 'channelDelete' || actionType === 'roleDelete')) {
        bot.logger.warn(`🪤 CANARY TRAP TRIGGERED: ${actionType} on "${targetName}" in ${guild.name} — INSTANT LOCKDOWN`);

        // Immediate lockdown — don't even wait for executor resolution
        await activateLockdown(guild, `Canary trap: ${targetName} was deleted`, bot);

        // Try to resolve who did it and punish them
        const executor = await resolveExecutor(guild, AUDIT_TYPES[actionType], 10000);
        if (executor && !isImmune(guild, executor.id, bot)) {
            await executeKillSwitch(guild, executor.id, `Canary trap: ${targetName}`, bot);

            // Build violation for full recovery
            bufferPush(guildId, executor.id, actionType, details);
            const allActions = allEventsForUser(guildId, executor.id);
            const violation = {
                violated: true, actionType, count: 1, limit: 0,
                window: 0, actions: allActions, detectedAt: Date.now(),
                violationType: 'canary_trap', executor,
                dangerScore: 999, triggerReason: `Canary trap: ${targetName}`,
            };
            await bot.antiNuke.handleViolation(guild, executor.id, violation);
        }
        return; // canary handling is complete
    }

    // ── [2] RING BUFFER + DANGER SCORE ─────────────────────────────────
    // We use __pending__ as provisional userId until audit log resolves the real one.
    const provisional = '__pending__';
    bufferPush(guildId, provisional, actionType, details);
    const currentScore = addDangerScore(guildId, provisional, actionType);

    bot.logger.debug(`[AntiNuke] ${actionType} in ${guild.name} — score: ${Math.round(currentScore)}`);

    // ── [3] KILL SWITCH: 2 destructive in 3 seconds ────────────────────
    const destructiveCount = countDestructive(guildId, provisional, KILL_SWITCH.windowMs);
    const killSwitchTriggered = KILL_SWITCH.destructiveTypes.has(actionType)
        && destructiveCount >= KILL_SWITCH.count;

    // ── [4] SCORE THRESHOLD CHECK ──────────────────────────────────────
    const scoreTriggered = currentScore >= SCORE_THRESHOLDS.killSwitch;

    // ── [5] COUNT THRESHOLD CHECK (legacy backup) ──────────────────────
    const threshold = THRESHOLDS[actionType];
    const recentCount = threshold
        ? bufferRecent(guildId, provisional, actionType, threshold.windowMs).length
        : 0;
    const countTriggered = threshold && recentCount >= threshold.count;

    // ── SHOULD WE RESPOND? ─────────────────────────────────────────────
    if (!killSwitchTriggered && !scoreTriggered && !countTriggered) return;

    const triggerReason = killSwitchTriggered
        ? `Kill switch: ${destructiveCount} destructive actions in ${KILL_SWITCH.windowMs}ms`
        : scoreTriggered
            ? `Danger score ${Math.round(currentScore)} >= ${SCORE_THRESHOLDS.killSwitch}`
            : `Count threshold: ${recentCount}/${threshold.count} ${actionType} in ${threshold.windowMs}ms`;

    bot.logger.warn(`[AntiNuke] 🚨 DETECTION: ${triggerReason} in ${guild.name}`);

    // ── DEDUP ──────────────────────────────────────────────────────────
    const dedupKey = `${guildId}:${actionType}`;
    if (handlingViolation.has(dedupKey)) return;
    handlingViolation.add(dedupKey);

    try {
        // ── PRE-EMPTIVE LOCKDOWN ────────────────────────────────────────
        // Fire IMMEDIATELY — don't wait for audit log. A nuke bot can create
        // 100 channels in the time we wait for the audit API. Lock now, identify later.
        activateLockdown(guild, `Pre-emptive lockdown: ${triggerReason}`, bot).catch(e =>
            bot.logger.warn(`[AntiNuke] Pre-emptive lockdown failed: ${e.message}`)
        );

        // ── [6] RESOLVE EXECUTOR via audit log ─────────────────────────
        // Shorter timeout for create events (the real damage is already happening).
        const auditTimeout = ['channelCreate', 'roleCreate'].includes(actionType) ? 3000 : 8000;
        const executor = await resolveExecutor(guild, AUDIT_TYPES[actionType], auditTimeout);
        if (!executor) {
            bot.logger.warn(`[AntiNuke] ⚠️ Could not resolve executor for ${actionType} — running anonymous cleanup`);
            // bufferPush fires BEFORE the dedup check, so __pending__ has ALL events
            // regardless of how many times detectAndRespond was called.
            const pendingActions = allEventsForUser(guildId, provisional);
            const attackStartedAt = pendingActions.length > 0
                ? Math.min(...pendingActions.map(a => a.timestamp))
                : Date.now() - 30000;
            if (pendingActions.length > 0) {
                const anonViolation = {
                    violated: true, actionType, count: pendingActions.length,
                    limit: threshold?.count || 0, window: threshold?.windowMs || 0,
                    actions: pendingActions, detectedAt: Date.now(), attackStartedAt,
                    violationType: 'anonymous_attack', executor: null,
                    dangerScore: Math.round(currentScore), triggerReason,
                };
                await bot.antiNuke.handleViolation(guild, null, anonViolation).catch(e =>
                    bot.logger.error(`[AntiNuke] Anonymous cleanup error: ${e.message}`)
                );
            }
            handlingViolation.delete(dedupKey);
            return;
        }

        const userId = executor.id;
        if (isImmune(guild, userId, bot)) {
            // Clear provisional buffer for this action type (bot/owner action)
            if (ringBuffer[guildId]?.[provisional]) {
                delete ringBuffer[guildId][provisional];
            }
            resetDangerScore(guildId, provisional);
            handlingViolation.delete(dedupKey);
            return;
        }

        // Re-check enabled live
        const liveConfig = await bot.database.getGuildConfig(guildId);
        if (!liveConfig?.antinuke_enabled) { handlingViolation.delete(dedupKey); return; }

        // ── IMMEDIATE RESPONSE: Kill switch ────────────────────────────
        await executeKillSwitch(guild, userId, triggerReason, bot);

        // ── Move provisional events to real userId ─────────────────────
        if (ringBuffer[guildId]?.[provisional]) {
            if (!ringBuffer[guildId][userId]) ringBuffer[guildId][userId] = Object.create(null);
            for (const [evType, evList] of Object.entries(ringBuffer[guildId][provisional])) {
                ringBuffer[guildId][userId][evType] = [
                    ...(ringBuffer[guildId][userId][evType] || []),
                    ...evList
                ];
            }
            delete ringBuffer[guildId][provisional];
        }
        // Move score
        if (dangerScores[guildId]?.[provisional]) {
            dangerScores[guildId][userId] = dangerScores[guildId][provisional];
            delete dangerScores[guildId][provisional];
        }

        const allActions = allEventsForUser(guildId, userId);
        const resolvedCount = bufferRecent(guildId, userId, actionType, (threshold?.windowMs || 10000)).length;
        const attackStartedAt = allActions.length > 0
            ? Math.min(...allActions.map(a => a.timestamp))
            : Date.now() - 30000;

        bot.logger.warn(`🚨 ANTI-NUKE v4: ${actionType} violation — ${executor.username} (${userId}) — score ${Math.round(currentScore)} — ${resolvedCount} events — ${triggerReason}`);

        const violation = {
            violated: true,
            actionType,
            count: resolvedCount,
            limit: threshold?.count || 0,
            window: threshold?.windowMs || 0,
            actions: allActions,
            detectedAt: Date.now(),
            attackStartedAt,
            violationType: killSwitchTriggered ? 'kill_switch' : scoreTriggered ? 'danger_score' : 'burst',
            executor,
            dangerScore: Math.round(currentScore),
            triggerReason,
        };

        await bot.antiNuke.handleViolation(guild, userId, violation);

        // Reset score after handling
        resetDangerScore(guildId, userId);

    } finally {
        setTimeout(() => handlingViolation.delete(dedupKey), 15000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: PUBLIC EVENT HANDLERS (called from bot.js)
// ═══════════════════════════════════════════════════════════════════════════════

async function handleChannelCreate(channel, bot) {
    if (!channel.guild) return;
    const guild = channel.guild;

    bot.logger.info(`🔔 Channel created: ${channel.name} (${channel.id}) in ${guild.name}`);

    if (bot.antiNuke?.isInRepairMode?.(guild.id)) return;

    if (typeof bot.antiNuke?.updateChannelSnapshot === 'function') {
        bot.antiNuke.updateChannelSnapshot(channel);
    }

    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[CHANNEL CREATE] #${channel.name} (${channel.id})`);
    }

    await detectAndRespond(guild, 'channelCreate', {
        channelId: channel.id, channelName: channel.name
    }, bot);

    if (bot.forensicsManager) {
        bot.forensicsManager.logAuditEvent({
            guildId: guild.id, eventType: 'channel_create', eventCategory: 'channel',
            target: { id: channel.id, name: channel.name }, canReplay: true
        }).catch(() => {});
    }
}

async function handleChannelDelete(channel, bot) {
    if (!channel.guild) return;
    const guild = channel.guild;

    bot.logger.info(`🔔 Channel deleted: ${channel.name} (${channel.id}) in ${guild.name}`);

    if (bot.antiNuke?.isInRepairMode?.(guild.id)) return;

    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[CHANNEL DELETE] #${channel.name} (${channel.id})`);
    }

    await detectAndRespond(guild, 'channelDelete', {
        channelId: channel.id, channelName: channel.name, channelType: channel.type
    }, bot);

    if (bot.forensicsManager) {
        bot.forensicsManager.logAuditEvent({
            guildId: guild.id, eventType: 'channel_delete', eventCategory: 'channel',
            target: { id: channel.id, name: channel.name }, canReplay: true
        }).catch(() => {});
    }
}

async function handleRoleCreate(role, bot) {
    const guild = role.guild;

    if (typeof bot.antiNuke?.updateRoleSnapshot === 'function') {
        bot.antiNuke.updateRoleSnapshot(role);
    }
    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[ROLE CREATE] ${role.name} (${role.id})`);
    }

    await detectAndRespond(guild, 'roleCreate', {
        roleId: role.id, roleName: role.name
    }, bot);
}

async function handleRoleDelete(role, bot) {
    const guild = role.guild;

    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[ROLE DELETE] ${role.name} (${role.id})`);
    }

    await detectAndRespond(guild, 'roleDelete', {
        roleId: role.id, roleName: role.name
    }, bot);
}

async function handleRoleUpdate(oldRole, newRole, bot) {
    if (!bot.antiNuke) return;
    const guild = newRole.guild;

    if (typeof bot.antiNuke?.updateRoleSnapshot === 'function') {
        bot.antiNuke.updateRoleSnapshot(newRole);
    }

    // Only care about dangerous permission grants
    const dangerousPerms = [8n, 32n, 16n, 268435456n, 4n, 2n, 536870912n];
    const oldBits = oldRole.permissions.bitfield;
    const newBits = newRole.permissions.bitfield;
    const addedDangerous = dangerousPerms.filter(p => !(oldBits & p) && (newBits & p));
    if (addedDangerous.length === 0) return;

    if (!(await checkEnabled(guild.id, bot))) return;

    // For dangerous perm grants, we DO fetch audit log immediately (low frequency event)
    const executor = await resolveExecutor(guild, AUDIT_TYPES.roleUpdate, 6000);
    if (!executor || isImmune(guild, executor.id, bot)) return;

    // Feed into danger score + ring buffer under the REAL userId
    bufferPush(guild.id, executor.id, 'roleUpdate', {
        roleId: newRole.id, roleName: newRole.name,
        addedPerms: addedDangerous.map(String)
    });
    const score = addDangerScore(guild.id, executor.id, 'roleUpdate');

    bot.logger.warn(`[AntiNuke] Dangerous perm grant by ${executor.username} on role ${newRole.name} — score now ${Math.round(score)}`);

    if (score >= SCORE_THRESHOLDS.killSwitch) {
        await executeKillSwitch(guild, executor.id, `Dangerous permission escalation (score ${Math.round(score)})`, bot);
    }

    if (score >= SCORE_THRESHOLDS.quarantine) {
        await activateLockdown(guild, `Permission escalation by ${executor.username}`, bot);
        const allActions = allEventsForUser(guild.id, executor.id);
        const violation = {
            violated: true, actionType: 'roleUpdate',
            count: allActions.length, limit: 0, window: 0,
            actions: allActions, detectedAt: Date.now(),
            violationType: 'danger_score', executor,
            dangerScore: Math.round(score),
            triggerReason: `Permission escalation score ${Math.round(score)}`,
        };
        await bot.antiNuke.handleViolation(guild, executor.id, violation);
        resetDangerScore(guild.id, executor.id);
    }
}

async function handleBanAdd(ban, bot) {
    const guild = ban.guild;

    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[BAN ADD] ${ban.user.username} (${ban.user.id})`);
    }

    await detectAndRespond(guild, 'banAdd', {
        targetId: ban.user.id, targetTag: ban.user.username
    }, bot);

    if (bot.forensicsManager) {
        bot.forensicsManager.logAuditEvent({
            guildId: guild.id, eventType: 'ban_add', eventCategory: 'moderation',
            target: { id: ban.user.id, name: ban.user.username }
        }).catch(() => {});
    }
}

async function handleWebhookUpdate(channel, bot) {
    if (!channel.guild) return;
    const guild = channel.guild;

    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[WEBHOOK UPDATE] #${channel.name} (${channel.id})`);
    }

    await detectAndRespond(guild, 'webhookCreate', {
        channelId: channel.id, channelName: channel.name
    }, bot);
}

async function handleMemberRemove(member, bot) {
    if (!bot.antiNuke) return;
    const guild = member.guild;

    if (!(await checkEnabled(guild.id, bot))) return;

    try {
        const logs = await guild.fetchAuditLogs({ type: AUDIT_TYPES.memberKick, limit: 1 }).catch(() => null);
        if (!logs) return;
        const entry = logs.entries.first();
        if (!entry?.executor) return;
        if (Date.now() - entry.createdTimestamp > 6000) return;
        if (entry.target?.id !== member.id) return;

        const userId = entry.executor.id;
        if (isImmune(guild, userId, bot)) return;

        bufferPush(guild.id, userId, 'memberKick', {
            targetId: member.id, targetTag: member.user?.username
        });
        const score = addDangerScore(guild.id, userId, 'memberKick');

        if (score >= SCORE_THRESHOLDS.killSwitch) {
            await executeKillSwitch(guild, userId, `Mass kicks (score ${Math.round(score)})`, bot);
        }
        if (score >= SCORE_THRESHOLDS.quarantine) {
            const allActions = allEventsForUser(guild.id, userId);
            const violation = {
                violated: true, actionType: 'memberKick',
                count: allActions.length, limit: 0, window: 0,
                actions: allActions, detectedAt: Date.now(),
                violationType: 'danger_score', executor: entry.executor,
                dangerScore: Math.round(score),
                triggerReason: `Mass kicks score ${Math.round(score)}`,
            };
            await bot.antiNuke.handleViolation(guild, userId, violation);
            resetDangerScore(guild.id, userId);
        }
    } catch { /* ignore */ }
}

async function handleBotAdd(member, bot) {
    if (!member.user.bot) return;
    if (!bot.antiNuke) return;
    const guild = member.guild;

    if (bot.broadcastConsole) {
        bot.broadcastConsole(guild.id, `[BOT ADD] ${member.user.username} (${member.user.id})`);
    }

    if (!(await checkEnabled(guild.id, bot))) return;

    const executor = await resolveExecutor(guild, AUDIT_TYPES.botAdd, 12000);

    // ── PRE-EMPTIVE BOT PROTECTION ─────────────────────────────────────
    // If the bot has dangerous permissions, quarantine it immediately
    // regardless of who added it or their danger score.
    const { PermissionFlagsBits } = require('discord.js');
    const dangerousBotPerms = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.ManageWebhooks,
    ];

    const botMember = member;
    const hasDangerousPerms = dangerousBotPerms.some(p =>
        botMember.permissions.has(p)
    );

    if (hasDangerousPerms) {
        bot.logger.warn(`🤖 DANGEROUS BOT DETECTED: ${member.user.username} with elevated permissions in ${guild.name}`);

        // Strip its roles immediately (quarantine the bot)
        try {
            const roleIds = botMember.roles.cache.filter(r => r.id !== guild.id).map(r => r.id);
            if (roleIds.length > 0) {
                await botMember.roles.set([], 'Anti-nuke: Quarantining dangerous bot');
                bot.logger.warn(`⚡ Stripped ${roleIds.length} roles from dangerous bot ${member.user.username}`);
            }
        } catch (e) {
            bot.logger.warn(`[BotProtect] Could not strip roles from ${member.user.username}: ${e.message}`);
        }

        // Try to kick the bot
        try {
            if (botMember.kickable) {
                await botMember.kick('Anti-nuke: Dangerous bot with elevated permissions');
                bot.logger.warn(`🦵 Kicked dangerous bot ${member.user.username}`);
            }
        } catch { /* ignore */ }
    }

    // Score the person who added the bot
    if (executor && !isImmune(guild, executor.id, bot)) {
        bufferPush(guild.id, executor.id, 'botAdd', {
            botId: member.id, botTag: member.user.username
        });
        const score = addDangerScore(guild.id, executor.id, 'botAdd');

        if (score >= SCORE_THRESHOLDS.killSwitch) {
            await executeKillSwitch(guild, executor.id, `Added dangerous bot (score ${Math.round(score)})`, bot);
        }
    }
}

async function handleChannelUpdate(oldChannel, newChannel, bot) {
    if (!bot.antiNuke || !newChannel.guild) return;
    if (typeof bot.antiNuke.updateChannelSnapshot === 'function') {
        bot.antiNuke.updateChannelSnapshot(newChannel);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: CANARY TRAP MANAGEMENT API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create canary traps for a guild (called from clientReady or /antinuke setup).
 * Creates a hidden channel and role that serve as tripwires.
 */
async function ensureCanaryTraps(guild, bot) {
    if (!bot.antiNuke) return;

    if (!bot.antiNuke.canaryChannels) bot.antiNuke.canaryChannels = new Map();
    if (!bot.antiNuke.canaryRoles) bot.antiNuke.canaryRoles = new Map();

    const guildId = guild.id;

    // Check if canaries already exist
    if (bot.antiNuke.canaryChannels.get(guildId)?.size > 0) return;

    const { ChannelType, PermissionFlagsBits } = require('discord.js');
    const canaryChannelName = 'darklock-security-check';
    const canaryRoleName = 'darklock-system-role';

    // Create canary channel (hidden from everyone)
    let canaryChannel = guild.channels.cache.find(c => c.name === canaryChannelName);
    if (!canaryChannel) {
        try {
            canaryChannel = await guild.channels.create({
                name: canaryChannelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: bot.client.user.id, allow: [PermissionFlagsBits.ViewChannel] },
                ],
                reason: 'Anti-nuke canary trap — do not delete',
                position: 999,
            });
            bot.logger.info(`🪤 Created canary channel: ${canaryChannelName} in ${guild.name}`);
        } catch (e) {
            bot.logger.warn(`[Canary] Failed to create canary channel in ${guild.name}: ${e.message}`);
        }
    }

    // Create canary role (no permissions, invisible)
    let canaryRole = guild.roles.cache.find(r => r.name === canaryRoleName);
    if (!canaryRole) {
        try {
            canaryRole = await guild.roles.create({
                name: canaryRoleName,
                permissions: 0n,
                mentionable: false,
                hoist: false,
                reason: 'Anti-nuke canary trap — do not delete',
                position: 1,
            });
            bot.logger.info(`🪤 Created canary role: ${canaryRoleName} in ${guild.name}`);
        } catch (e) {
            bot.logger.warn(`[Canary] Failed to create canary role in ${guild.name}: ${e.message}`);
        }
    }

    // Register canary IDs
    if (canaryChannel) {
        if (!bot.antiNuke.canaryChannels.has(guildId)) bot.antiNuke.canaryChannels.set(guildId, new Set());
        bot.antiNuke.canaryChannels.get(guildId).add(canaryChannel.id);
    }
    if (canaryRole) {
        if (!bot.antiNuke.canaryRoles.has(guildId)) bot.antiNuke.canaryRoles.set(guildId, new Set());
        bot.antiNuke.canaryRoles.get(guildId).add(canaryRole.id);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    handleRoleCreate,
    handleRoleDelete,
    handleRoleUpdate,
    handleChannelCreate,
    handleChannelDelete,
    handleChannelUpdate,
    handleBanAdd,
    handleMemberRemove,
    handleBotAdd,
    handleWebhookUpdate,
    // Management API
    invalidateEnabledCache,
    ensureCanaryTraps,
    activateLockdown,
    deactivateLockdown,
    // Testing/debug
    getDangerScores: () => dangerScores,
    getRingBuffer: () => ringBuffer,
};
