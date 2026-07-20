/**
 * Security Channel Rules Engine
 *
 * Declarative rule engine that enforces security policies on secure channels.
 * Rules are evaluated in priority order and produce allow/deny/audit decisions.
 *
 * Built-in rules:
 *  - lockdown_block:         Block all access during lockdown (except owner/co_owner)
 *  - secure_view_logs:       Only security_admin+ can view secure channel audit logs
 *  - secure_trigger_lockdown: Only admin+ can trigger/release lockdown
 *  - owner_override:         Only owner can override security settings
 *  - rate_limit:             Per-user rate limiting on secure channel sends
 *  - block_unauthorized_delete: Block message deletion unless MANAGE_MESSAGES + security_admin+
 *
 * Custom rules can be registered via registerRule().
 */

import {
  SecurityLevel,
  resolveSecurityLevel,
  canUserAccessChannel,
  logSecureAudit,
} from './channel-rbac-engine.js';

// ── Rule Registry ────────────────────────────────────────────────────────────

/**
 * @typedef {object} RuleResult
 * @property {'allow'|'deny'|'continue'} decision
 * @property {string} [reason]
 * @property {boolean} [audit] - Whether to log this decision
 */

/**
 * @typedef {object} Rule
 * @property {string} id         - Unique rule identifier
 * @property {number} priority   - Lower = evaluated first (0-999)
 * @property {string[]} actions  - Which action types this rule applies to ('*' for all)
 * @property {(ctx: RuleContext) => RuleResult} evaluate
 */

/**
 * @typedef {object} RuleContext
 * @property {string} userId
 * @property {string} serverId
 * @property {string} channelId
 * @property {string} action       - e.g. 'send_message', 'delete_message', 'view_logs', 'trigger_lockdown'
 * @property {object} channel      - Channel row from DB (id, is_secure, lockdown, type)
 * @property {number} securityLevel - Pre-resolved security level for the user
 * @property {object} db           - Database instance
 * @property {string} [ip]         - Client IP
 * @property {object} [extra]      - Additional context from the caller
 */

const rules = [];

/**
 * Register a custom security rule.
 * @param {Rule} rule
 */
export function registerRule(rule) {
  rules.push(rule);
  rules.sort((a, b) => a.priority - b.priority);
}

// ── Built-In Rules ───────────────────────────────────────────────────────────

registerRule({
  id: 'lockdown_block',
  priority: 0,
  actions: ['*'],
  evaluate: (ctx) => {
    if (!ctx.channel.lockdown) return { decision: 'continue' };
    if (ctx.securityLevel >= SecurityLevel.CO_OWNER) {
      return { decision: 'allow', reason: 'lockdown_bypass_co_owner+', audit: true };
    }
    return { decision: 'deny', reason: 'channel_is_locked_down', audit: true };
  },
});

registerRule({
  id: 'secure_view_logs',
  priority: 10,
  actions: ['view_logs'],
  evaluate: (ctx) => {
    if (!ctx.channel.is_secure) {
      return { decision: 'deny', reason: 'not_a_secure_channel' };
    }
    if (ctx.securityLevel >= SecurityLevel.SECURITY_ADMIN) {
      return { decision: 'allow', reason: 'security_admin+', audit: true };
    }
    return { decision: 'deny', reason: 'requires_security_admin', audit: true };
  },
});

registerRule({
  id: 'secure_trigger_lockdown',
  priority: 10,
  actions: ['trigger_lockdown', 'release_lockdown'],
  evaluate: (ctx) => {
    if (!ctx.channel.is_secure) {
      return { decision: 'deny', reason: 'not_a_secure_channel' };
    }
    if (ctx.securityLevel >= SecurityLevel.ADMIN) {
      return { decision: 'allow', reason: 'admin+', audit: true };
    }
    return { decision: 'deny', reason: 'requires_admin', audit: true };
  },
});

registerRule({
  id: 'owner_override',
  priority: 10,
  actions: ['override_security', 'set_secure', 'remove_secure'],
  evaluate: (ctx) => {
    if (ctx.securityLevel >= SecurityLevel.OWNER) {
      return { decision: 'allow', reason: 'owner_only', audit: true };
    }
    return { decision: 'deny', reason: 'requires_owner', audit: true };
  },
});

registerRule({
  id: 'block_unauthorized_delete',
  priority: 20,
  actions: ['delete_message'],
  evaluate: (ctx) => {
    if (!ctx.channel.is_secure) return { decision: 'continue' };
    // In secure channels, deletion requires security_admin+ in addition to normal MANAGE_MESSAGES
    if (ctx.securityLevel >= SecurityLevel.SECURITY_ADMIN) {
      return { decision: 'continue' }; // Let normal RBAC handle the rest
    }
    // Allow users to delete their own messages
    if (ctx.extra?.isOwnMessage) {
      return { decision: 'continue' };
    }
    return { decision: 'deny', reason: 'secure_channel_delete_requires_security_admin', audit: true };
  },
});

// ── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimitStore = new Map(); // key: `${userId}:${channelId}` → { count, resetAt }

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_SENDS = 10;     // max messages per window in secure channels

registerRule({
  id: 'secure_rate_limit',
  priority: 50,
  actions: ['send_message'],
  evaluate: (ctx) => {
    if (!ctx.channel.is_secure) return { decision: 'continue' };
    // Security admin+ are exempt from rate limiting
    if (ctx.securityLevel >= SecurityLevel.SECURITY_ADMIN) return { decision: 'continue' };

    const key = `${ctx.userId}:${ctx.channelId}`;
    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateLimitStore.set(key, entry);
    }

    entry.count++;
    if (entry.count > RATE_LIMIT_MAX_SENDS) {
      return {
        decision: 'deny',
        reason: `secure_rate_limited (${entry.count}/${RATE_LIMIT_MAX_SENDS} per min)`,
        audit: true,
      };
    }

    return { decision: 'continue' };
  },
});

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now >= entry.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60_000).unref();

// ── Rule Engine Evaluator ────────────────────────────────────────────────────

/**
 * Evaluate all applicable rules for a given action context.
 *
 * @param {{ userId: string, serverId: string, channelId: string, action: string, db: object, ip?: string, extra?: object }} params
 * @returns {{ allowed: boolean, reason: string, ruleId?: string, audited: boolean }}
 */
export function evaluateSecurityRules({ userId, serverId, channelId, action, db, ip, extra }) {
  // Load channel metadata
  const channel = db.prepare('SELECT id, is_secure, lockdown, type FROM channels WHERE id = ? AND server_id = ?')
    .get(channelId, serverId);

  if (!channel) {
    return { allowed: false, reason: 'channel_not_found', audited: false };
  }

  // Pre-resolve security level
  const securityLevel = resolveSecurityLevel({ userId, serverId, db });

  const ctx = {
    userId,
    serverId,
    channelId,
    action,
    channel,
    securityLevel,
    db,
    ip,
    extra: extra ?? {},
  };

  let audited = false;

  for (const rule of rules) {
    // Check if rule applies to this action
    if (!rule.actions.includes('*') && !rule.actions.includes(action)) {
      continue;
    }

    const result = rule.evaluate(ctx);

    // Audit if requested
    if (result.audit) {
      audited = true;
      logSecureAudit(db, {
        serverId,
        channelId,
        userId,
        action,
        permissionChecked: rule.id,
        result: result.decision === 'allow' ? 'allowed' : 'denied',
        metadata: { rule_id: rule.id, reason: result.reason, extra },
        ip,
      });
    }

    if (result.decision === 'allow') {
      return { allowed: true, reason: result.reason, ruleId: rule.id, audited };
    }

    if (result.decision === 'deny') {
      return { allowed: false, reason: result.reason, ruleId: rule.id, audited };
    }

    // 'continue' — move to next rule
  }

  // No rule made a definitive decision → default ALLOW for non-secure channels
  // For secure channels, default DENY
  if (channel.is_secure) {
    return { allowed: false, reason: 'secure_channel_default_deny', audited };
  }

  return { allowed: true, reason: 'no_rule_blocked', audited };
}

/**
 * Full security check combining RBAC engine + rule engine.
 *
 * 1. Evaluate security rules first (lockdown, rate limit, etc.)
 * 2. If rules allow, check RBAC permission
 * 3. Log to secure audit if it's a secure channel
 *
 * @param {{ userId: string, serverId: string, channelId: string, permissionKey: string, action: string, db: object, ip?: string, extra?: object }} params
 * @returns {{ allowed: boolean, reason: string }}
 */
export function checkSecureChannelAccess({ userId, serverId, channelId, permissionKey, action, db, ip, extra }) {
  // 1. Security rule evaluation
  const ruleResult = evaluateSecurityRules({ userId, serverId, channelId, action, db, ip, extra });

  if (!ruleResult.allowed) {
    return { allowed: false, reason: ruleResult.reason };
  }

  // If rules explicitly allowed (via a rule, not just passthrough), skip RBAC
  if (ruleResult.ruleId && ruleResult.reason !== 'no_rule_blocked') {
    // A specific rule said ALLOW — still check RBAC for safety
  }

  // 2. RBAC permission check
  const rbacResult = canUserAccessChannel({ userId, serverId, channelId, permissionKey, db });

  // Audit the combined result for secure channels
  if (rbacResult.isSecure && !ruleResult.audited) {
    logSecureAudit(db, {
      serverId,
      channelId,
      userId,
      action,
      permissionChecked: permissionKey,
      result: rbacResult.allowed ? 'allowed' : 'denied',
      metadata: { rbac_reason: rbacResult.reason },
      ip,
    });
  }

  return {
    allowed: rbacResult.allowed,
    reason: rbacResult.reason,
  };
}
