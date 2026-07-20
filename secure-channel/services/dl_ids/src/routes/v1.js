import { Router } from 'express';
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import {
  areFriends,
  areUsersBlocked,
  canAccessUserRelationshipData,
  normalizeUserId,
  resolveUserIdByIdOrUsername,
  sharesServerMembership,
  userExists,
} from '../security/relationship-policy.js';
import { hitFixedWindowLimit } from '../security/rate-buckets.js';
import { RIDGELINE_SECURITY_CAPABILITIES } from '@darklock/ridgeline-security-capabilities';
import {
  argon2idHashNeedsUpgrade,
  hashPasswordArgon2id,
  isArgon2idHash,
  verifyPasswordArgon2id,
} from '@darklock/ridgeline-secure-storage';

export const v1Router = Router();
v1Router.get('/security/capabilities', (req, res) => {
  const serverStorageVerified = req.secureFields?.configured === true;
  const encryptedBackupVerified = serverStorageVerified
    && req.db.prepare("SELECT 1 FROM secure_storage_state WHERE key = 'encrypted_backup_verified' AND value = ?").get(
      req.secureFields.keyFingerprint,
    ) !== undefined;
  res.json({
    ...RIDGELINE_SECURITY_CAPABILITIES,
    encryptedSyncSupported: serverStorageVerified,
    totpEnvelopeEncryptionSupported: serverStorageVerified,
    serverDataEncryptedAtRestSupported: false,
    encryptedBackupsSupported: encryptedBackupVerified,
    privateBetaSecureStorageMode: serverStorageVerified,
  });
});

const USER_ID_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ACCESS_TOKEN_EXPIRY = '15m';
const ACCESS_TOKEN_ISSUER = 'dl-ids';
const ACCESS_TOKEN_AUDIENCE = 'ridgeline-services';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW_STEPS = 1;
const TOTP_REPLAY_CACHE_MS = 3 * TOTP_STEP_SECONDS * 1000;
const TWO_FA_PENDING_LOGIN_TTL_MS = 5 * 60 * 1000;
const TWO_FA_EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 12;
const BACKUP_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECURITY_ACTION_TOKEN_TTL_MS = Math.max(
  5 * 60 * 1000,
  parseInt(process.env.IDS_SECURITY_ACTION_TOKEN_TTL_MS ?? String(60 * 60 * 1000), 10) || (60 * 60 * 1000),
);
const LOGIN_ACTIVITY_LIMIT = Math.max(
  5,
  parseInt(process.env.IDS_LOGIN_ACTIVITY_LIMIT ?? '8', 10) || 8,
);
const EMAIL_PROVIDER = String(process.env.IDS_EMAIL_PROVIDER ?? '').trim().toLowerCase();
const EMAIL_FROM = String(process.env.IDS_EMAIL_FROM ?? process.env.EMAIL_FROM ?? '').trim();
const EMAIL_WEBHOOK_URL = String(process.env.IDS_EMAIL_WEBHOOK_URL ?? '').trim();
const EMAIL_API_KEY = String(process.env.IDS_EMAIL_API_KEY ?? '').trim();
const IDS_PUBLIC_BASE_URL = String(process.env.IDS_PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
const APP_SECURITY_URL = String(process.env.IDS_APP_SECURITY_URL ?? process.env.APP_SECURITY_URL ?? '').trim().replace(/\/$/, '');
const RELAY_PERMIT_TYPE = 'relay_send_permit';
const RELAY_PERMIT_AUDIENCE = 'dl-rly';
const RELAY_PERMIT_ISSUER = 'dl-ids';
const RELAY_PERMIT_TTL_SECONDS = Math.max(
  15,
  Math.min(parseInt(process.env.IDS_RELAY_PERMIT_TTL_SECONDS ?? '60', 10) || 60, 300),
);
const MAX_RELAY_RECIPIENTS = Math.max(
  1,
  Math.min(parseInt(process.env.IDS_RELAY_MAX_RECIPIENTS ?? '64', 10) || 64, 256),
);
const TURN_CREDENTIAL_TTL_SECONDS = Math.max(
  15,
  Math.min(parseInt(process.env.IDS_TURN_CREDENTIAL_TTL_SECONDS ?? '60', 10) || 60, 120),
);
const TURN_SHARED_SECRET = String(
  process.env.IDS_TURN_SHARED_SECRET
  ?? process.env.TURN_SHARED_SECRET
  ?? '',
).trim();
const TURN_URLS = String(
  process.env.IDS_TURN_URIS
  ?? process.env.IDS_TURN_URLS
  ?? process.env.TURN_URLS
  ?? process.env.TURN_URL
  ?? '',
)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const CALL_EVENT_TYPES = new Set([
  'call_invite',
  'call_accept',
  'call_reject',
  'call_end',
  'call_signal',
  'call_media',
]);

const DIRECT_PERMIT_EVENT_TYPES = new Set([
  'message',
  'friend_request',
  'typing',
  'delete_message',
  'edit_message',
  'receipt',
  'friend_accept',
  'open_dm',
  'tag_update',
  ...CALL_EVENT_TYPES,
]);

const GROUP_RECIPIENT_PERMIT_EVENT_TYPES = new Set([
  'group_message',
  'group_invite',
  'group_settings_update',
]);

const METADATA_RECIPIENT_PERMIT_EVENT_TYPES = new Set([
  'subscribe_presence',
  'profile_request',
]);

const PERMIT_EVENT_TYPES = new Set([
  ...DIRECT_PERMIT_EVENT_TYPES,
  ...GROUP_RECIPIENT_PERMIT_EVENT_TYPES,
  ...METADATA_RECIPIENT_PERMIT_EVENT_TYPES,
]);

const EXISTS_RATE_LIMIT_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_EXISTS_RATE_WINDOW_MS ?? String(15 * 60 * 1000), 10) || (15 * 60 * 1000),
);
const EXISTS_RATE_LIMIT_IP_MAX = Math.max(
  1,
  parseInt(process.env.IDS_EXISTS_RATE_LIMIT_IP_MAX ?? '30', 10) || 30,
);
const EXISTS_RATE_LIMIT_REQUESTER_MAX = Math.max(
  1,
  parseInt(process.env.IDS_EXISTS_RATE_LIMIT_REQUESTER_MAX ?? '30', 10) || 30,
);
const AVAILABILITY_RATE_LIMIT_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_AVAILABILITY_RATE_WINDOW_MS ?? String(15 * 60 * 1000), 10) || (15 * 60 * 1000),
);
const AVAILABILITY_RATE_LIMIT_IP_MAX = Math.max(
  1,
  parseInt(process.env.IDS_AVAILABILITY_RATE_LIMIT_IP_MAX ?? '30', 10) || 30,
);
const BUNDLE_RATE_LIMIT_WINDOW_MS = Math.max(
  30_000,
  parseInt(process.env.IDS_BUNDLE_RATE_WINDOW_MS ?? String(15 * 60 * 1000), 10) || (15 * 60 * 1000),
);
const BUNDLE_RATE_LIMIT_REQUESTER_MAX = Math.max(
  1,
  parseInt(process.env.IDS_BUNDLE_RATE_LIMIT_REQUESTER_MAX ?? '60', 10) || 60,
);
const BUNDLE_RATE_LIMIT_IP_MAX = Math.max(
  1,
  parseInt(process.env.IDS_BUNDLE_RATE_LIMIT_IP_MAX ?? '90', 10) || 90,
);
const BUNDLE_RATE_LIMIT_TARGET_MAX = Math.max(
  1,
  parseInt(process.env.IDS_BUNDLE_RATE_LIMIT_TARGET_MAX ?? '20', 10) || 20,
);
const BUNDLE_RATE_LIMIT_TARGET_OPK_MAX = Math.max(
  1,
  parseInt(process.env.IDS_BUNDLE_RATE_LIMIT_TARGET_OPK_MAX ?? '8', 10) || 8,
);

const existsIpRateState = new Map();
const existsRequesterRateState = new Map();
const availabilityIpRateState = new Map();
const bundleIpRateState = new Map();
const bundleRequesterRateState = new Map();
const bundleRequesterTargetRateState = new Map();
const usedTotpCodes = new Map();

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function deriveUserIdFromEmail(email) {
  const localPart = String(email || '').split('@')[0] ?? '';
  const cleaned = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');

  const base = cleaned.length >= 3 ? cleaned.slice(0, 24) : 'user';
  const suffix = randomBytes(2).toString('hex');
  return `${base}-${suffix}`.slice(0, 30);
}

function ensureUniqueUserId(db, initialUserId) {
  const base = String(initialUserId || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24) || 'user';

  for (let attempt = 0; attempt < 25; attempt++) {
    const suffix = randomBytes(2).toString('hex');
    const candidate = `${base}-${suffix}`.slice(0, 30);
    const exists = db.prepare('SELECT 1 FROM users WHERE id = ? OR username = ? LIMIT 1').get(candidate, candidate);
    if (!exists) return candidate;
  }

  throw new Error('user_id_generation_failed');
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [local = '', domain = ''] = normalized.split('@');
  if (!local || !domain) return 'hidden';
  const localMasked = local.length <= 2
    ? `${local[0] ?? '*'}*`
    : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${localMasked}@${domain}`;
}

function base32Decode(value) {
  let bits = '';
  for (const ch of String(value || '').toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_CHARS[parseInt(chunk, 2)];
  }
  return output;
}

function computeTotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = (
    ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3]
  );
  const code = binary % (10 ** TOTP_DIGITS);
  return code.toString().padStart(TOTP_DIGITS, '0');
}

function verifyTotp(secretBase32, token, userId) {
  const normalizedToken = String(token || '').trim();
  if (!/^\d{6}$/.test(normalizedToken)) return false;

  const nowCounter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset++) {
    const candidateCounter = nowCounter + offset;
    const expected = computeTotp(secretBase32, candidateCounter);
    if (expected !== normalizedToken) continue;

    const replayKey = `${normalizedToken}:${candidateCounter}`;
    if (!usedTotpCodes.has(userId)) usedTotpCodes.set(userId, new Set());
    const usedSet = usedTotpCodes.get(userId);
    if (usedSet.has(replayKey)) return false;
    usedSet.add(replayKey);
    setTimeout(() => {
      usedSet.delete(replayKey);
      if (usedSet.size === 0) usedTotpCodes.delete(userId);
    }, TOTP_REPLAY_CACHE_MS);
    return true;
  }

  return false;
}

function randomFromAlphabet(length, alphabet) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generateSecureBackupCodes(count = BACKUP_CODE_COUNT) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = randomFromAlphabet(BACKUP_CODE_LENGTH, BACKUP_CODE_ALPHABET);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

function normalizeBackupCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashBackupCode(code) {
  return `sha256:${createHash('sha256')
    .update(`ridgeline-backup-code:${normalizeBackupCode(code)}`)
    .digest('hex')}`;
}

function backupCodeMatches(storedDigest, candidate) {
  const expected = Buffer.from(String(storedDigest || ''), 'utf8');
  const actual = Buffer.from(hashBackupCode(candidate), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function generateEmailVerificationCode() {
  const value = randomBytes(4).readUInt32BE(0) % 1000000;
  return value.toString().padStart(6, '0');
}

function hashEmailVerificationCode(userId, email, code, secret) {
  return createHash('sha256')
    .update(`${userId}:${normalizeEmail(email)}:${String(code || '').trim()}:${secret}`)
    .digest('hex');
}

function hashSecurityActionToken(token, secret) {
  return createHash('sha256')
    .update(`${String(token || '').trim()}:${secret}`)
    .digest('hex');
}

function detectClientDevice(req) {
  const ua = String(req.headers['user-agent'] ?? '').trim();
  const platformHint = String(req.headers['sec-ch-ua-platform'] ?? req.headers['x-device-platform'] ?? '').trim();
  const lang = String(req.headers['accept-language'] ?? '').trim();
  const suppliedDeviceId = String(req.headers['x-ridgeline-device-id'] ?? '').trim();
  const deviceId = /^[a-z0-9_-]{16,96}$/i.test(suppliedDeviceId) ? suppliedDeviceId : null;
  const material = deviceId ?? `${ua.toLowerCase()}|${platformHint.toLowerCase()}|${lang.toLowerCase()}`;
  const fingerprintHash = createHash('sha256').update(material).digest('hex');

  let label = 'Unknown device';
  if (/electron/i.test(ua)) label = 'Desktop App';
  else if (/iphone|ipad|ios/i.test(ua)) label = 'iOS';
  else if (/android/i.test(ua)) label = 'Android';
  else if (/windows/i.test(ua)) label = 'Windows';
  else if (/macintosh|mac os/i.test(ua)) label = 'macOS';
  else if (/linux/i.test(ua)) label = 'Linux';
  else if (/firefox/i.test(ua)) label = 'Firefox';
  else if (/chrome|chromium|crios/i.test(ua)) label = 'Chrome';
  else if (/safari/i.test(ua)) label = 'Safari';

  return {
    fingerprintHash,
    deviceId,
    deviceLabel: label,
    userAgent: ua,
  };
}

function maskIpAddress(ipValue) {
  const ip = String(ipValue ?? '').trim();
  if (!ip) return 'hidden';

  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
  }

  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}:${parts[1]}::*`;
  }

  return ip.slice(0, 10);
}

function detectLocationLabel(req) {
  const country = String(req.headers['cf-ipcountry'] ?? req.headers['x-vercel-ip-country'] ?? '').trim();
  const region = String(req.headers['x-vercel-ip-country-region'] ?? '').trim();
  const city = String(req.headers['x-vercel-ip-city'] ?? '').trim();

  if (city && country) return `${city}, ${country}`;
  if (region && country) return `${region}, ${country}`;
  if (country) return country;

  return maskIpAddress(getRequestIp(req));
}

function ensureSecurityActionToken(db, secureFields, userId, action, secret, metadata = {}) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashSecurityActionToken(token, secret);
  const expiresAt = Date.now() + SECURITY_ACTION_TOKEN_TTL_MS;
  const actionId = randomUUID();

  db.prepare(`
    INSERT INTO account_security_actions (id, user_id, action, token_hash, expires_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    actionId,
    userId,
    action,
    tokenHash,
    expiresAt,
    secureFields.encodeJson('audit', userId, 'account_security_actions', actionId, 'metadata_json', metadata),
  );

  return { token, expiresAt };
}

function consumeSecurityActionToken(db, token, action, secret) {
  const tokenHash = hashSecurityActionToken(token, secret);
  const now = Date.now();
  const row = db.prepare(`
    SELECT id, user_id
    FROM account_security_actions
    WHERE token_hash = ?
      AND action = ?
      AND expires_at > ?
      AND used_at IS NULL
    LIMIT 1
  `).get(tokenHash, action, now);

  if (!row) return null;

  db.prepare('UPDATE account_security_actions SET used_at = ? WHERE id = ?').run(now, row.id);
  return row;
}

function revokeAllRefreshTokensForUser(db, userId) {
  const before = db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = ?').get(userId)?.count ?? 0;
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
  return Number(before) || 0;
}

function upsertLoginActivityAndDetectAnomaly(db, secureFields, userId, deviceFingerprintHash, deviceLabel, locationLabel, ipHint) {
  const previous = db.prepare(`
    SELECT id, fingerprint_hash, device_label, location_label, last_seen_at
    FROM login_activity
    WHERE user_id = ?
    ORDER BY datetime(last_seen_at) DESC
    LIMIT 1
  `).get(userId);

  const existing = db.prepare(`
    SELECT id, location_label
    FROM login_activity
    WHERE user_id = ? AND fingerprint_hash = ?
    LIMIT 1
  `).get(userId, deviceFingerprintHash);

  const previousLocation = previous?.location_label
    ? secureFields.decode('authentication', userId, 'login_activity', previous.id, 'location_label', previous.location_label)
    : '';

  if (existing) {
    db.prepare(`
      UPDATE login_activity
      SET device_label = ?,
          location_label = ?,
          ip_hint = ?,
          login_count = login_count + 1,
          last_seen_at = datetime('now')
      WHERE id = ?
    `).run(
      secureFields.encode('authentication', userId, 'login_activity', existing.id, 'device_label', deviceLabel),
      secureFields.encode('authentication', userId, 'login_activity', existing.id, 'location_label', locationLabel),
      secureFields.encode('authentication', userId, 'login_activity', existing.id, 'ip_hint', ipHint),
      existing.id,
    );
  } else {
    const activityId = randomUUID();
    db.prepare(`
      INSERT INTO login_activity (
        id, user_id, fingerprint_hash, device_label, location_label, ip_hint,
        first_seen_at, last_seen_at, login_count
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `).run(
      activityId,
      userId,
      deviceFingerprintHash,
      secureFields.encode('authentication', userId, 'login_activity', activityId, 'device_label', deviceLabel),
      secureFields.encode('authentication', userId, 'login_activity', activityId, 'location_label', locationLabel),
      secureFields.encode('authentication', userId, 'login_activity', activityId, 'ip_hint', ipHint),
    );
  }

  const newDevice = !existing;
  const locationChanged = !!previousLocation && previousLocation !== locationLabel;
  const hasHistory = !!previous;

  return {
    newDevice,
    locationChanged,
    shouldAlert: hasHistory && (newDevice || locationChanged),
  };
}

function buildSecureAccountLinks(token) {
  const apiPath = `/v1/auth/security/secure-account/${encodeURIComponent(token)}`;
  const fallbackApiLink = IDS_PUBLIC_BASE_URL ? `${IDS_PUBLIC_BASE_URL}${apiPath}` : null;
  const appLink = APP_SECURITY_URL
    ? `${APP_SECURITY_URL}${APP_SECURITY_URL.includes('?') ? '&' : '?'}secure_account_token=${encodeURIComponent(token)}`
    : null;

  return {
    appLink,
    fallbackApiLink,
  };
}

function buildSecurityAlertEmail({ displayName, deviceLabel, locationLabel, ipHint, when, secureLink, fallbackLink }) {
  const safeName = String(displayName || 'there');
  const safeDevice = String(deviceLabel || 'Unknown device');
  const safeLocation = String(locationLabel || 'Unknown area');
  const safeIp = String(ipHint || 'hidden');
  const safeWhen = String(when || new Date().toISOString());

  const primaryHref = secureLink || fallbackLink || '#';
  const secondaryLine = fallbackLink && secureLink && fallbackLink !== secureLink
    ? `<p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Fallback link: <a href="${fallbackLink}" style="color:#4f46e5;">${fallbackLink}</a></p>`
    : '';

  return {
    subject: 'Ridgeline security alert: new login detected',
    text: [
      `Hi ${safeName},`,
      '',
      'We detected a login to your Ridgeline account from a new device or area.',
      `Device: ${safeDevice}`,
      `Location: ${safeLocation}`,
      `Network: ${safeIp}`,
      `Time: ${safeWhen}`,
      '',
      `If this was not you, secure your account immediately: ${primaryHref}`,
    ].join('\n'),
    html: `
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f4f6fb;padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">Ridgeline Security Alert</h2>
          <p style="margin:0 0 16px;color:#374151;font-size:14px;">Hi ${safeName}, we detected a login from a new device or area.</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;font-size:13px;color:#111827;line-height:1.6;">
            <div><strong>Device:</strong> ${safeDevice}</div>
            <div><strong>Location:</strong> ${safeLocation}</div>
            <div><strong>Network:</strong> ${safeIp}</div>
            <div><strong>Time:</strong> ${safeWhen}</div>
          </div>
          <a href="${primaryHref}" style="display:inline-block;margin-top:18px;padding:10px 16px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Secure account now</a>
          <p style="margin:14px 0 0;color:#6b7280;font-size:12px;">If this was you, no action is needed.</p>
          ${secondaryLine}
        </div>
      </div>
    `,
  };
}

async function dispatchSecurityEmail({ to, subject, text, html }) {
  const recipient = normalizeEmail(to);
  if (!recipient || !subject) return false;

  try {
    if (EMAIL_PROVIDER === 'resend' && EMAIL_API_KEY && EMAIL_FROM) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${EMAIL_API_KEY}`,
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [recipient],
          subject,
          html,
          text,
        }),
      });
      return response.ok;
    }

    if (EMAIL_WEBHOOK_URL) {
      const response = await fetch(EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, from: EMAIL_FROM || null, subject, text, html }),
      });
      return response.ok;
    }

    if (!IS_PRODUCTION) {
      console.log('[IDS_EMAIL_DELIVERY_NOT_CONFIGURED]');
    }
  } catch {
    return false;
  }

  return false;
}

function countBackupCodes(rawBackupCodes) {
  if (typeof rawBackupCodes !== 'string' || rawBackupCodes.length === 0) return 0;
  try {
    const parsed = JSON.parse(rawBackupCodes);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function computeSecurityPosture({
  totpEnabled,
  loginAlertsEnabled,
  backupCodesRemaining,
  knownDevices,
  uniqueLocations,
}) {
  let score = 35;

  if (totpEnabled) score += 30;
  if (loginAlertsEnabled) score += 20;
  if (backupCodesRemaining > 0) score += 10;
  score += knownDevices <= 3 ? 8 : 4;
  score += uniqueLocations <= 2 ? 8 : 2;

  const normalized = Math.max(0, Math.min(100, score));

  if (normalized >= 80) return { score: normalized, level: 'strong' };
  if (normalized >= 60) return { score: normalized, level: 'guarded' };
  if (normalized >= 40) return { score: normalized, level: 'watch' };
  return { score: normalized, level: 'risk' };
}

function performSecureAccountLockdown(db, userId) {
  const revokedSessions = revokeAllRefreshTokensForUser(db, userId);
  db.prepare('DELETE FROM pending_2fa_tokens WHERE user_id = ?').run(userId);
  return { revokedSessions };
}

function issueAccessToken(userId, username, secret) {
  return jwt.sign({ sub: userId, username, type: 'access' }, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: ACCESS_TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  });
}

function generateRefreshToken() {
  const refreshToken = randomBytes(48).toString('base64url');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 86400000).toISOString();
  return { refreshToken, tokenHash, expiresAt };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeDisplayName(userId, displayName) {
  const raw = (displayName ?? '').trim();
  return raw.length > 0 ? raw.slice(0, 64) : userId;
}

function normalizeIdentityPubkey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function detectIdentityKeyChange(storedIdentityPubkey, lastKnownIdentityPubkey) {
  const stored = normalizeIdentityPubkey(storedIdentityPubkey);
  const known = normalizeIdentityPubkey(lastKnownIdentityPubkey);
  if (!stored || !known) return false;
  return stored !== known;
}

function normalizeRecipients(rawRecipients, fromUserId) {
  if (!Array.isArray(rawRecipients)) return [];
  const out = [];
  const seen = new Set();

  for (const value of rawRecipients) {
    const userId = normalizeUserId(value);
    if (!userId || userId === fromUserId || seen.has(userId)) continue;
    seen.add(userId);
    out.push(userId);
  }

  return out;
}

function authorizeDirectSend(db, fromUserId, toUserId) {
  if (!userExists(db, toUserId)) {
    return { ok: false, status: 404, code: 'not_found', error: 'recipient_not_found' };
  }
  if (!areFriends(db, fromUserId, toUserId)) {
    return { ok: false, status: 403, code: 'not_friends', error: 'sender_not_allowed' };
  }
  if (areUsersBlocked(db, fromUserId, toUserId)) {
    return { ok: false, status: 403, code: 'blocked', error: 'blocked_pair' };
  }
  return { ok: true };
}

function issueRelayPermit(secret, claims) {
  return jwt.sign(
    {
      type: RELAY_PERMIT_TYPE,
      ...claims,
      jti: randomUUID(),
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: `${RELAY_PERMIT_TTL_SECONDS}s`,
      audience: RELAY_PERMIT_AUDIENCE,
      issuer: RELAY_PERMIT_ISSUER,
    },
  );
}

function getRequestIp(req) {
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function getExistsRateLimitResult(req) {
  const ipKey = `exists-ip:${getRequestIp(req)}`;
  if (hitFixedWindowLimit(existsIpRateState, ipKey, {
    limit: EXISTS_RATE_LIMIT_IP_MAX,
    windowMs: EXISTS_RATE_LIMIT_WINDOW_MS,
  })) {
    return { limited: true };
  }

  const requester = normalizeUserId(req.userId).toLowerCase();
  const requesterKey = `exists-requester:${requester || 'unknown'}`;
  if (hitFixedWindowLimit(existsRequesterRateState, requesterKey, {
    limit: EXISTS_RATE_LIMIT_REQUESTER_MAX,
    windowMs: EXISTS_RATE_LIMIT_WINDOW_MS,
  })) {
    return { limited: true };
  }

  return { limited: false };
}

function isAvailabilityRateLimited(req) {
  const ipKey = `availability-ip:${getRequestIp(req)}`;
  return hitFixedWindowLimit(availabilityIpRateState, ipKey, {
    limit: AVAILABILITY_RATE_LIMIT_IP_MAX,
    windowMs: AVAILABILITY_RATE_LIMIT_WINDOW_MS,
  });
}

function getBundlePairLimit() {
  return process.env.IDS_ENABLE_OPK === '1'
    ? BUNDLE_RATE_LIMIT_TARGET_OPK_MAX
    : BUNDLE_RATE_LIMIT_TARGET_MAX;
}

function isBundleRateLimited(req, requesterUserId, targetUserId) {
  const ipKey = `bundle-ip:${getRequestIp(req)}`;
  if (hitFixedWindowLimit(bundleIpRateState, ipKey, {
    limit: BUNDLE_RATE_LIMIT_IP_MAX,
    windowMs: BUNDLE_RATE_LIMIT_WINDOW_MS,
  })) {
    return true;
  }

  const requesterKey = `bundle-requester:${normalizeUserId(requesterUserId).toLowerCase() || 'unknown'}`;
  if (hitFixedWindowLimit(bundleRequesterRateState, requesterKey, {
    limit: BUNDLE_RATE_LIMIT_REQUESTER_MAX,
    windowMs: BUNDLE_RATE_LIMIT_WINDOW_MS,
  })) {
    return true;
  }

  const pairKey = `bundle-pair:${normalizeUserId(requesterUserId).toLowerCase()}->${normalizeUserId(targetUserId).toLowerCase()}`;
  return hitFixedWindowLimit(bundleRequesterTargetRateState, pairKey, {
    limit: getBundlePairLimit(),
    windowMs: BUNDLE_RATE_LIMIT_WINDOW_MS,
  });
}

v1Router.get('/auth/availability/:userId', (req, res) => {
  try {
    if (isAvailabilityRateLimited(req)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    const db = req.db;
    const userId = String(req.params.userId || '').toLowerCase().trim();

    if (!USER_ID_RE.test(userId)) {
      return res.json({ available: false });
    }

    const row = db
      .prepare('SELECT 1 FROM users WHERE id = ? OR username = ? LIMIT 1')
      .get(userId, userId);

    return res.json({ available: !row });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/auth/exists/:userId', requireAuth, (req, res) => {
  try {
    const existsRate = getExistsRateLimitResult(req);
    if (existsRate.limited) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    const db = req.db;
    const userId = String(req.params.userId || '').toLowerCase();
    const row = db
      .prepare('SELECT 1 FROM users WHERE id = ? OR username = ? LIMIT 1')
      .get(userId, userId);
    res.json({ exists: !!row });
  } catch {
    res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/register', async (req, res) => {
  try {
    const db = req.db;
    const requestedUserIdRaw = String(req.body?.userId || '').toLowerCase().trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const hasRequestedUserId = requestedUserIdRaw.length > 0;

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'invalid_email', code: 'bad_request' });
    }

    let userId = hasRequestedUserId ? requestedUserIdRaw : deriveUserIdFromEmail(email);

    if (!USER_ID_RE.test(userId)) {
      if (hasRequestedUserId) {
        return res.status(400).json({ error: 'invalid_user_id', code: 'bad_request' });
      }
      userId = ensureUniqueUserId(db, deriveUserIdFromEmail(email));
    }

    const displayName = normalizeDisplayName(userId, req.body?.displayName);

    if (password.length < 12) {
      return res.status(400).json({ error: 'password_too_short', code: 'bad_request' });
    }

    const emailBlindIndex = req.secureFields.configured ? req.secureFields.emailIndex(email) : null;
    const emailExists = req.secureFields.configured
      ? db.prepare('SELECT 1 FROM users WHERE email_blind_index = ? LIMIT 1').get(emailBlindIndex)
      : db.prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1').get(email);
    if (emailExists) {
      return res.status(409).json({ error: 'user_exists', code: 'conflict' });
    }

    if (hasRequestedUserId) {
      const userExists = db
        .prepare('SELECT 1 FROM users WHERE id = ? OR username = ? LIMIT 1')
        .get(userId, userId);
      if (userExists) {
        return res.status(409).json({ error: 'user_exists', code: 'conflict' });
      }
    } else {
      userId = ensureUniqueUserId(db, userId);
    }

    const passwordHash = await hashPasswordArgon2id(password, { environment: process.env.NODE_ENV });
    const identityPubkeyPlaceholder = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const storedEmail = req.secureFields.encodeUserField(userId, 'email', email);
    const storedDisplayName = req.secureFields.encodeUserField(userId, 'display_name', displayName);

    db.prepare(`
      INSERT INTO users (id, username, email, email_blind_index, password_hash, identity_pubkey, display_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, userId, storedEmail, emailBlindIndex, passwordHash, identityPubkeyPlaceholder, storedDisplayName);

    return res.status(201).json({ ok: true, userId, displayName, email });
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'user_exists', code: 'conflict' });
    }
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/login', async (req, res) => {
  try {
    const db = req.db;
    const identifier = normalizeEmail(req.body?.email || req.body?.userId);
    const password = String(req.body?.password || '');
    const lastKnownIdentityPubkey = req.body?.last_known_identity_pubkey;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'missing_fields', code: 'bad_request' });
    }

    const user = req.secureFields.configured
      ? db.prepare(`
          SELECT id, username, email, password_hash, display_name, system_role, identity_pubkey,
                 totp_enabled, totp_secret, backup_codes, login_alerts_enabled
          FROM users
          WHERE id = ? OR username = ? OR email_blind_index = ?
          LIMIT 1
        `).get(identifier, identifier, EMAIL_RE.test(identifier) ? req.secureFields.emailIndex(identifier) : '')
      : db.prepare(`
          SELECT id, username, email, password_hash, display_name, system_role, identity_pubkey,
                 totp_enabled, totp_secret, backup_codes, login_alerts_enabled
          FROM users
          WHERE id = ? OR username = ? OR email = ?
          LIMIT 1
        `).get(identifier, identifier, identifier);

    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials', code: 'invalid_credentials' });
    }

    const argon2id = isArgon2idHash(user.password_hash);
    const ok = argon2id
      ? await verifyPasswordArgon2id(user.password_hash, password)
      : await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials', code: 'invalid_credentials' });
    }
    if (!argon2id || await argon2idHashNeedsUpgrade(user.password_hash, { environment: process.env.NODE_ENV })) {
      const upgradedHash = await hashPasswordArgon2id(password, { environment: process.env.NODE_ENV });
      db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ? AND password_hash = ?')
        .run(upgradedHash, user.id, user.password_hash);
      console.info('[IDS_PASSWORD_HASH_UPGRADED]');
    }

    user.email = req.secureFields.decodeUserField(user.id, 'email', user.email);
    user.display_name = req.secureFields.decodeUserField(user.id, 'display_name', user.display_name);
    user.totp_secret = req.secureFields.decodeUserField(user.id, 'totp_secret', user.totp_secret);

    const keyChangeDetected = detectIdentityKeyChange(user.identity_pubkey, lastKnownIdentityPubkey);
    const { fingerprintHash: rawFingerprintHash, deviceId, deviceLabel, userAgent } = detectClientDevice(req);
    const fingerprintHash = req.secureFields.blindIndex(rawFingerprintHash, 'login_activity.fingerprint');
    const locationLabel = detectLocationLabel(req);
    const ipHint = maskIpAddress(getRequestIp(req));
    const anomaly = upsertLoginActivityAndDetectAnomaly(
      db,
      req.secureFields,
      user.id,
      fingerprintHash,
      deviceLabel,
      deviceId,
      locationLabel,
      ipHint,
    );

    if (Number(user.login_alerts_enabled ?? 1) === 1 && anomaly.shouldAlert && EMAIL_RE.test(normalizeEmail(user.email))) {
      try {
        const secureAction = ensureSecurityActionToken(db, req.secureFields, user.id, 'secure_account', req.jwtSecret, {
          source: 'login_alert',
          deviceLabel,
          locationLabel,
          ipHint,
        });
        const links = buildSecureAccountLinks(secureAction.token);
        const alertEmail = buildSecurityAlertEmail({
          displayName: user.display_name || user.username || user.id,
          deviceLabel,
          locationLabel,
          ipHint,
          when: new Date().toISOString(),
          secureLink: links.appLink,
          fallbackLink: links.fallbackApiLink,
        });
        void dispatchSecurityEmail({
          to: user.email,
          subject: alertEmail.subject,
          text: alertEmail.text,
          html: alertEmail.html,
        });
      } catch {
        // Security alerts should never block login.
      }
    }

    if (Number(user.totp_enabled) === 1 && typeof user.totp_secret === 'string' && user.totp_secret.length > 0) {
      const pendingToken = randomBytes(32).toString('base64url');
      const pendingExpiresAt = Date.now() + TWO_FA_PENDING_LOGIN_TTL_MS;
      db.prepare('DELETE FROM pending_2fa_tokens WHERE user_id = ?').run(user.id);
      db.prepare('INSERT INTO pending_2fa_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(hashToken(pendingToken), user.id, pendingExpiresAt);

      return res.json({
        requires2fa: true,
        pendingToken,
        userId: user.id,
        displayName: user.display_name || user.username || user.id,
      });
    }

    const token = issueAccessToken(user.id, user.username, req.jwtSecret);
    const { refreshToken, tokenHash, expiresAt } = generateRefreshToken();
    const sessionDeviceInfo = JSON.stringify({
      deviceLabel,
      locationLabel,
      ipHint,
      userAgent,
      lastLoginAt: Date.now(),
    });

    const sessionId = randomUUID();
    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, device_info) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sessionId,
      user.id,
      tokenHash,
      expiresAt,
      req.secureFields.encode('authentication', user.id, 'refresh_tokens', sessionId, 'device_info', sessionDeviceInfo),
    );

    return res.json({
      userId: user.id,
      displayName: user.display_name || user.username || user.id,
      token,
      access_token: token,
      refresh_token: refreshToken,
      systemRole: user.system_role ?? null,
      key_change_detected: keyChangeDetected,
      keyChangeDetected,
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/refresh', (req, res) => {
  try {
    const db = req.db;
    const refreshToken = String(req.body?.refresh_token ?? '').trim();
    if (!refreshToken) {
      return res.status(400).json({ error: 'missing_refresh_token', code: 'bad_request' });
    }

    const incomingHash = hashToken(refreshToken);
    const nextRefresh = generateRefreshToken();
    const rotate = db.transaction(() => {
      db.prepare("DELETE FROM refresh_tokens WHERE expires_at <= datetime('now')").run();
      const row = db.prepare(
        "SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now') LIMIT 1"
      ).get(incomingHash);

      if (!row) {
        const reused = db.prepare(
          "SELECT user_id FROM refresh_tokens WHERE token_hash = ? AND expires_at > datetime('now') LIMIT 1"
        ).get(`used:${incomingHash}`);
        if (reused) {
          db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(reused.user_id);
          return { status: 'reused' };
        }
        return { status: 'invalid' };
      }

      const user = db.prepare(
        'SELECT id, username, display_name FROM users WHERE id = ? LIMIT 1'
      ).get(row.user_id);
      if (!user) {
        db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
        return { status: 'invalid' };
      }
      user.display_name = req.secureFields.decodeUserField(user.id, 'display_name', user.display_name);

      let refreshedDeviceInfo = row.device_info ?? null;
      try {
        const decodedDeviceInfo = row.device_info
          ? req.secureFields.decode('authentication', user.id, 'refresh_tokens', row.id, 'device_info', row.device_info)
          : '{}';
        const parsed = JSON.parse(decodedDeviceInfo);
        if (parsed && typeof parsed === 'object') {
          parsed.lastActiveAt = Date.now();
          refreshedDeviceInfo = JSON.stringify(parsed);
        }
      } catch {
        return { status: 'invalid' };
      }

      db.prepare('UPDATE refresh_tokens SET token_hash = ? WHERE id = ?')
        .run(`used:${incomingHash}`, row.id);
      const nextSessionId = randomUUID();
      db.prepare(
        'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, device_info) VALUES (?, ?, ?, ?, ?)'
      ).run(
        nextSessionId,
        user.id,
        nextRefresh.tokenHash,
        nextRefresh.expiresAt,
        refreshedDeviceInfo
          ? req.secureFields.encode('authentication', user.id, 'refresh_tokens', nextSessionId, 'device_info', refreshedDeviceInfo)
          : null,
      );
      return { status: 'rotated', user };
    });
    const result = rotate();
    if (result.status === 'reused') {
      return res.status(401).json({ error: 'refresh_token_reuse_detected', code: 'invalid_token' });
    }
    if (result.status !== 'rotated') {
      return res.status(401).json({ error: 'invalid_refresh_token', code: 'invalid_token' });
    }

    const { user } = result;
    const accessToken = issueAccessToken(user.id, user.username, req.jwtSecret);
    return res.json({
      userId: user.id,
      displayName: user.display_name || user.username || user.id,
      token: accessToken,
      access_token: accessToken,
      refresh_token: nextRefresh.refreshToken,
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/auth/2fa/status/:userId', requireAuth, (req, res) => {
  try {
    const authUserId = normalizeUserId(req.userId);
    const requestedUserId = normalizeUserId(req.params.userId);

    if (!authUserId || !requestedUserId || authUserId !== requestedUserId) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    const db = req.db;
    const user = db.prepare('SELECT email, totp_enabled, backup_codes FROM users WHERE id = ? LIMIT 1').get(authUserId);
    if (!user) {
      return res.status(404).json({ error: 'not_found', code: 'not_found' });
    }
    user.email = req.secureFields.decodeUserField(authUserId, 'email', user.email);

    let backupCodesRemaining = 0;
    if (typeof user.backup_codes === 'string' && user.backup_codes.length > 0) {
      try {
        const parsed = JSON.parse(user.backup_codes);
        if (Array.isArray(parsed)) backupCodesRemaining = parsed.length;
      } catch {
        backupCodesRemaining = 0;
      }
    }

    return res.json({
      enabled: Number(user.totp_enabled) === 1,
      emailHint: maskEmail(user.email),
      backupCodesRemaining,
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/2fa/setup', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    const user = db.prepare('SELECT email FROM users WHERE id = ? LIMIT 1').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'not_found', code: 'not_found' });
    }
    user.email = req.secureFields.decodeUserField(userId, 'email', user.email);

    const secret = generateTotpSecret();
    const emailCode = generateEmailVerificationCode();
    const emailCodeHash = hashEmailVerificationCode(userId, user.email, emailCode, req.jwtSecret);
    const emailCodeExpiresAt = Date.now() + TWO_FA_EMAIL_CODE_TTL_MS;

    db.prepare(`
      UPDATE users
      SET twofa_pending_secret = ?,
          twofa_pending_backup_codes = ?,
          twofa_pending_email_code_hash = ?,
          twofa_pending_email_code_expires_at = ?
      WHERE id = ?
    `).run(
      req.secureFields.encodeUserField(userId, 'twofa_pending_secret', secret),
      null,
      emailCodeHash,
      emailCodeExpiresAt,
      userId,
    );

    const issuer = encodeURIComponent('Ridgeline');
    const label = encodeURIComponent(`${userId}`);
    const otpauthUri = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;

    if (IS_PRODUCTION) {
      void dispatchSecurityEmail({
        to: user.email,
        subject: 'Ridgeline two-factor verification code',
        text: `Your Ridgeline verification code is ${emailCode}. It expires in 10 minutes.`,
        html: `<p>Your Ridgeline verification code is <strong>${emailCode}</strong>. It expires in 10 minutes.</p>`,
      });
    } else {
      console.log('[IDS_2FA_VERIFICATION_CODE_ISSUED]');
    }

    return res.json({
      secret,
      otpauthUri,
      emailHint: maskEmail(user.email),
      ...(IS_PRODUCTION ? {} : { devEmailCode: emailCode }),
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/2fa/confirm', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    const totpCode = String(req.body?.code || '').trim();
    const emailCode = String(req.body?.emailCode || '').trim();

    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }
    if (!/^\d{6}$/.test(totpCode)) {
      return res.status(400).json({ error: 'invalid_totp_code', code: 'bad_request' });
    }
    if (!/^\d{6}$/.test(emailCode)) {
      return res.status(400).json({ error: 'invalid_email_code', code: 'bad_request' });
    }

    const user = db.prepare(`
      SELECT email,
             twofa_pending_secret,
             twofa_pending_backup_codes,
             twofa_pending_email_code_hash,
             twofa_pending_email_code_expires_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(userId);

    if (!user || typeof user.twofa_pending_secret !== 'string' || user.twofa_pending_secret.length === 0) {
      return res.status(400).json({ error: 'setup_required', code: 'bad_request' });
    }
    user.email = req.secureFields.decodeUserField(userId, 'email', user.email);
    user.twofa_pending_secret = req.secureFields.decodeUserField(
      userId,
      'twofa_pending_secret',
      user.twofa_pending_secret,
    );

    const expiresAt = Number(user.twofa_pending_email_code_expires_at || 0);
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(400).json({ error: 'email_code_expired', code: 'bad_request' });
    }

    if (!verifyTotp(user.twofa_pending_secret, totpCode, userId)) {
      return res.status(400).json({ error: 'invalid_totp_code', code: 'bad_request' });
    }

    const expectedHash = hashEmailVerificationCode(userId, user.email, emailCode, req.jwtSecret);
    if (expectedHash !== String(user.twofa_pending_email_code_hash || '')) {
      return res.status(400).json({ error: 'invalid_email_code', code: 'bad_request' });
    }

    const backupCodes = generateSecureBackupCodes();
    const backupCodeDigests = backupCodes.map(hashBackupCode);

    db.prepare(`
      UPDATE users
      SET totp_enabled = 1,
          totp_secret = ?,
          backup_codes = ?,
          twofa_pending_secret = NULL,
          twofa_pending_backup_codes = NULL,
          twofa_pending_email_code_hash = NULL,
          twofa_pending_email_code_expires_at = NULL
      WHERE id = ?
    `).run(
      req.secureFields.encodeUserField(userId, 'totp_secret', user.twofa_pending_secret),
      JSON.stringify(backupCodeDigests),
      userId,
    );

    return res.json({ ok: true, backupCodes });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/2fa/disable', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    db.prepare(`
      UPDATE users
      SET totp_enabled = 0,
          totp_secret = NULL,
          backup_codes = NULL,
          twofa_pending_secret = NULL,
          twofa_pending_backup_codes = NULL,
          twofa_pending_email_code_hash = NULL,
          twofa_pending_email_code_expires_at = NULL
      WHERE id = ?
    `).run(userId);

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/2fa/verify', (req, res) => {
  try {
    const db = req.db;
    const pendingToken = String(req.body?.pendingToken || '').trim();
    const code = String(req.body?.code || '').trim();

    if (!pendingToken || !code) {
      return res.status(400).json({ error: 'missing_fields', code: 'bad_request' });
    }

    const now = Date.now();
    db.prepare('DELETE FROM pending_2fa_tokens WHERE expires_at <= ?').run(now);

    const pendingTokenHash = hashToken(pendingToken);
    const pending = db.prepare(`
      SELECT user_id
      FROM pending_2fa_tokens
      WHERE token = ? AND expires_at > ?
      LIMIT 1
    `).get(pendingTokenHash, now);

    if (!pending) {
      return res.status(401).json({ error: 'invalid_pending_token', code: 'invalid_token' });
    }

    const user = db.prepare(`
      SELECT id, username, display_name, system_role, identity_pubkey,
             totp_enabled, totp_secret, backup_codes
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(pending.user_id);

    if (!user || Number(user.totp_enabled) !== 1 || typeof user.totp_secret !== 'string' || user.totp_secret.length === 0) {
      db.prepare('DELETE FROM pending_2fa_tokens WHERE token = ?').run(pendingTokenHash);
      return res.status(400).json({ error: '2fa_not_enabled', code: 'bad_request' });
    }

    user.display_name = req.secureFields.decodeUserField(user.id, 'display_name', user.display_name);
    user.totp_secret = req.secureFields.decodeUserField(user.id, 'totp_secret', user.totp_secret);

    let valid = verifyTotp(user.totp_secret, code, user.id);
    let nextBackupCodes = null;

    if (!valid && typeof user.backup_codes === 'string' && user.backup_codes.length > 0) {
      try {
        const parsed = JSON.parse(user.backup_codes);
        if (Array.isArray(parsed)) {
          const idx = parsed.findIndex((entry) => backupCodeMatches(entry, code));
          if (idx >= 0) {
            valid = true;
            parsed.splice(idx, 1);
            nextBackupCodes = parsed;
          }
        }
      } catch {
        // ignore malformed backup code list
      }
    }

    if (!valid) {
      return res.status(401).json({ error: 'invalid_code', code: 'invalid_credentials' });
    }

    if (nextBackupCodes) {
      db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?')
        .run(JSON.stringify(nextBackupCodes), user.id);
    }

    db.prepare('DELETE FROM pending_2fa_tokens WHERE token = ?').run(pendingTokenHash);

    const accessToken = issueAccessToken(user.id, user.username, req.jwtSecret);
    const { refreshToken, tokenHash, expiresAt } = generateRefreshToken();
    const keyChangeDetected = detectIdentityKeyChange(user.identity_pubkey, req.body?.last_known_identity_pubkey);
    const { deviceId, deviceLabel, userAgent } = detectClientDevice(req);
    const locationLabel = detectLocationLabel(req);
    const ipHint = maskIpAddress(getRequestIp(req));
    const sessionDeviceInfo = JSON.stringify({
      deviceLabel,
      deviceId,
      locationLabel,
      ipHint,
      userAgent,
      lastLoginAt: Date.now(),
    });

    const sessionId = randomUUID();
    db.prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, device_info) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sessionId,
      user.id,
      tokenHash,
      expiresAt,
      req.secureFields.encode('authentication', user.id, 'refresh_tokens', sessionId, 'device_info', sessionDeviceInfo),
    );

    return res.json({
      userId: user.id,
      displayName: user.display_name || user.username || user.id,
      token: accessToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      systemRole: user.system_role ?? null,
      key_change_detected: keyChangeDetected,
      keyChangeDetected: false,
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/auth/sessions', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    const suppliedDeviceId = String(req.headers['x-ridgeline-device-id'] ?? '').trim();
    const currentDeviceId = /^[a-z0-9_-]{16,96}$/i.test(suppliedDeviceId) ? suppliedDeviceId : null;
    const rows = db.prepare(`
      SELECT id, created_at, expires_at, device_info
      FROM refresh_tokens
      WHERE user_id = ?
        AND expires_at > datetime('now')
        AND token_hash NOT LIKE 'used:%'
      ORDER BY datetime(created_at) DESC
      LIMIT 24
    `).all(userId);

    const sessions = rows.map((row) => {
      let parsedDeviceInfo = null;
      if (typeof row.device_info === 'string' && row.device_info.length > 0) {
        try {
          parsedDeviceInfo = req.secureFields.decodeJson(
            'authentication',
            userId,
            'refresh_tokens',
            row.id,
            'device_info',
            row.device_info,
          );
        } catch {
          parsedDeviceInfo = null;
        }
      }

      return {
        id: row.id,
        token: row.id,
        createdAt: Number(Date.parse(row.created_at)) || Date.now(),
        expiresAt: Number(Date.parse(row.expires_at)) || null,
        isCurrent: currentDeviceId !== null && parsedDeviceInfo?.deviceId === currentDeviceId,
        deviceInfo: parsedDeviceInfo,
      };
    });

    return res.json({ sessions });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.delete('/auth/sessions/:sessionId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    const sessionId = String(req.params.sessionId || '').trim();
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }
    if (!sessionId) {
      return res.status(400).json({ error: 'missing_session_id', code: 'bad_request' });
    }

    const removed = db.prepare('DELETE FROM refresh_tokens WHERE id = ? AND user_id = ?').run(sessionId, userId);
    return res.json({ ok: true, removed: Number(removed.changes || 0) });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.put('/auth/security/login-alerts', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    const enabled = !!req.body?.enabled;
    db.prepare('UPDATE users SET login_alerts_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
    return res.json({ ok: true, loginAlertsEnabled: enabled });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/auth/security/status/:userId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const authUserId = normalizeUserId(req.userId);
    const requestedUserId = normalizeUserId(req.params.userId);
    if (!authUserId || !requestedUserId || authUserId !== requestedUserId) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    const user = db.prepare(`
      SELECT id, email, username, display_name, totp_enabled, backup_codes, login_alerts_enabled
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(authUserId);

    if (!user) {
      return res.status(404).json({ error: 'not_found', code: 'not_found' });
    }
    user.email = req.secureFields.decodeUserField(authUserId, 'email', user.email);
    user.display_name = req.secureFields.decodeUserField(authUserId, 'display_name', user.display_name);

    const knownDevices = Number(db.prepare(
      'SELECT COUNT(*) AS count FROM login_activity WHERE user_id = ?'
    ).get(authUserId)?.count || 0);

    const recentRows = db.prepare(`
      SELECT id, device_label, location_label, ip_hint, first_seen_at, last_seen_at, login_count
      FROM login_activity
      WHERE user_id = ?
      ORDER BY datetime(last_seen_at) DESC
      LIMIT ?
    `).all(authUserId, LOGIN_ACTIVITY_LIMIT);
    const decodedRecentRows = recentRows.map((row) => ({
      ...row,
      device_label: req.secureFields.decode(
        'authentication', authUserId, 'login_activity', row.id, 'device_label', row.device_label,
      ),
      location_label: req.secureFields.decode(
        'authentication', authUserId, 'login_activity', row.id, 'location_label', row.location_label,
      ),
      ip_hint: req.secureFields.decode(
        'authentication', authUserId, 'login_activity', row.id, 'ip_hint', row.ip_hint,
      ),
    }));
    const uniqueLocations = new Set(decodedRecentRows.map((row) => row.location_label || 'unknown')).size;

    const backupCodesRemaining = countBackupCodes(user.backup_codes);
    const posture = computeSecurityPosture({
      totpEnabled: Number(user.totp_enabled) === 1,
      loginAlertsEnabled: Number(user.login_alerts_enabled ?? 1) === 1,
      backupCodesRemaining,
      knownDevices,
      uniqueLocations,
    });

    return res.json({
      userId: user.id,
      displayName: user.display_name || user.username || user.id,
      emailHint: maskEmail(user.email),
      loginAlertsEnabled: Number(user.login_alerts_enabled ?? 1) === 1,
      posture,
      factors: {
        twoFactorEnabled: Number(user.totp_enabled) === 1,
        backupCodesRemaining,
        knownDevices,
        uniqueLocations,
      },
      recentLogins: decodedRecentRows.map((row) => ({
        deviceLabel: row.device_label || 'Unknown device',
        locationLabel: row.location_label || 'Unknown area',
        ipHint: row.ip_hint || 'hidden',
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        loginCount: Number(row.login_count || 0),
      })),
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/security/secure-account', requireAuth, async (req, res) => {
  try {
    const db = req.db;
    const userId = normalizeUserId(req.userId);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    const user = db.prepare(
      'SELECT id, email, username, display_name FROM users WHERE id = ? LIMIT 1'
    ).get(userId);
    if (!user) {
      return res.status(404).json({ error: 'not_found', code: 'not_found' });
    }
    user.email = req.secureFields.decodeUserField(userId, 'email', user.email);
    user.display_name = req.secureFields.decodeUserField(userId, 'display_name', user.display_name);

    const result = performSecureAccountLockdown(db, userId);
    db.prepare('DELETE FROM account_security_actions WHERE user_id = ? AND action = ?').run(userId, 'secure_account');

    if (EMAIL_RE.test(normalizeEmail(user.email))) {
      const subject = 'Ridgeline account secured';
      const text = `Hi ${user.display_name || user.username || user.id}, your account was secured and active sessions were revoked.`;
      const html = `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;padding:20px;"><h3 style="margin:0 0 10px;">Account secured</h3><p style="margin:0;color:#374151;">Your active sessions were revoked and pending sign-ins were cleared.</p></div>`;
      void dispatchSecurityEmail({ to: user.email, subject, text, html });
    }

    return res.json({ ok: true, revokedSessions: result.revokedSessions });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/auth/security/secure-account-token', (req, res) => {
  try {
    const db = req.db;
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'missing_token', code: 'bad_request' });
    }

    const action = consumeSecurityActionToken(db, token, 'secure_account', req.jwtSecret);
    if (!action) {
      return res.status(400).json({ error: 'invalid_or_expired_token', code: 'invalid_token' });
    }

    const result = performSecureAccountLockdown(db, action.user_id);
    return res.json({ ok: true, userId: action.user_id, revokedSessions: result.revokedSessions });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/auth/security/secure-account/:token', (req, res) => {
  try {
    const db = req.db;
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(400).type('text/plain').send('Missing security token.');
    }

    const action = consumeSecurityActionToken(db, token, 'secure_account', req.jwtSecret);
    if (!action) {
      return res.status(400).type('text/plain').send('This security link is invalid or expired.');
    }

    performSecureAccountLockdown(db, action.user_id);
    return res.status(200).type('text/html').send(`
      <!doctype html>
      <html><head><meta charset="utf-8" /><title>Ridgeline Account Secured</title></head>
      <body style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f4f6fb;padding:24px;">
        <div style="max-width:540px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
          <h2 style="margin:0 0 8px;">Account secured</h2>
          <p style="margin:0;color:#374151;">Your active sessions were revoked. Sign in again on trusted devices.</p>
        </div>
      </body></html>
    `);
  } catch {
    return res.status(500).type('text/plain').send('Internal error while securing account.');
  }
});

v1Router.get('/turn/credentials', requireAuth, (req, res) => {
  try {
    const userId = normalizeUserId(req.userId);
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    if (TURN_SHARED_SECRET.length < 16 || TURN_URLS.length === 0) {
      return res.status(503).json({ error: 'turn_not_configured', code: 'service_unavailable' });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL_SECONDS;
    const username = `${expiresAt}:${userId}`;
    const credential = createHmac('sha1', TURN_SHARED_SECRET)
      .update(username)
      .digest('base64');

    return res.json({
      username,
      credential,
      urls: TURN_URLS,
      expires_at: expiresAt,
      expires_in_seconds: TURN_CREDENTIAL_TTL_SECONDS,
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/relay/permit', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const fromUserId = normalizeUserId(req.userId);
    const eventType = String(req.body?.type ?? '').trim();

    if (!fromUserId) {
      return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
    }

    if (!PERMIT_EVENT_TYPES.has(eventType)) {
      return res.status(400).json({ error: 'invalid_event_type', code: 'bad_request' });
    }
    if (GROUP_RECIPIENT_PERMIT_EVENT_TYPES.has(eventType)
      && !RIDGELINE_SECURITY_CAPABILITIES.groupMessagingSupported) {
      return res.status(503).json({
        error: 'group_messaging_disabled_security',
        code: 'service_unavailable',
      });
    }
    if (eventType === 'edit_message' && !RIDGELINE_SECURITY_CAPABILITIES.messageEditsSupported) {
      return res.status(503).json({ error: 'message_edits_disabled_security', code: 'service_unavailable' });
    }
    if (eventType === 'delete_message' && !RIDGELINE_SECURITY_CAPABILITIES.messageDeletesSupported) {
      return res.status(503).json({ error: 'message_deletes_disabled_security', code: 'service_unavailable' });
    }

    const isGroupRecipientEvent = GROUP_RECIPIENT_PERMIT_EVENT_TYPES.has(eventType);
    const isMetadataRecipientEvent = METADATA_RECIPIENT_PERMIT_EVENT_TYPES.has(eventType);

    if (isGroupRecipientEvent || isMetadataRecipientEvent) {
      const recipients = normalizeRecipients(req.body?.recipients, fromUserId);

      if (recipients.length === 0) {
        return res.status(400).json({ error: 'recipients_required', code: 'bad_request' });
      }
      if (recipients.length > MAX_RELAY_RECIPIENTS) {
        return res.status(413).json({ error: 'recipients_too_many', code: 'payload_too_large' });
      }

      for (const recipient of recipients) {
        const allowed = isMetadataRecipientEvent
          ? canAccessUserRelationshipData(db, fromUserId, recipient, { allowSharedServer: true })
          : authorizeDirectSend(db, fromUserId, recipient);
        if (!allowed.ok) {
          if (isMetadataRecipientEvent) {
            return res.status(403).json({ error: 'target_not_allowed', code: 'forbidden' });
          }
          return res.status(allowed.status).json({ error: allowed.error, code: allowed.code });
        }
      }

      const permitClaims = {
        sub: fromUserId,
        eventType,
        recipients,
      };

      if (isGroupRecipientEvent) {
        const groupId = normalizeUserId(req.body?.groupId);
        if (!groupId) {
          return res.status(400).json({ error: 'group_id_required', code: 'bad_request' });
        }
        permitClaims.groupId = groupId;
      }

      const permit = issueRelayPermit(req.jwtSecret, permitClaims);

      return res.json({
        permit,
        expires_in_seconds: RELAY_PERMIT_TTL_SECONDS,
      });
    }

    const toUserId = normalizeUserId(req.body?.to);
    if (!toUserId || toUserId === fromUserId) {
      return res.status(400).json({ error: 'invalid_recipient', code: 'bad_request' });
    }

    if (eventType === 'friend_request') {
      if (!userExists(db, toUserId)) {
        return res.status(404).json({ error: 'recipient_not_found', code: 'not_found' });
      }
      if (areUsersBlocked(db, fromUserId, toUserId)) {
        return res.status(403).json({ error: 'blocked_pair', code: 'blocked' });
      }
    } else {
      const allowed = authorizeDirectSend(db, fromUserId, toUserId);
      if (!allowed.ok) {
        return res.status(allowed.status).json({ error: allowed.error, code: allowed.code });
      }
    }

    const permit = issueRelayPermit(req.jwtSecret, {
      sub: fromUserId,
      eventType,
      to: toUserId,
    });

    return res.json({
      permit,
      expires_in_seconds: RELAY_PERMIT_TTL_SECONDS,
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.post('/keys/register', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const authUser = req.userId;
    const userId = String(req.body?.userId || '');
    const identityKey = req.body?.identityKey;
    const signedPreKey = req.body?.signedPreKey;
    const oneTimePreKeys = req.body?.oneTimePreKeys ?? [];

    if (!userId || !identityKey || !signedPreKey?.publicKey || !Array.isArray(oneTimePreKeys)) {
      return res.status(400).json({ error: 'bad_request', code: 'bad_request' });
    }
    if (authUser !== userId) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    db.prepare(`
      INSERT INTO user_key_bundles (user_id, identity_key, signed_prekey_json, one_time_prekeys_json, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        identity_key = excluded.identity_key,
        signed_prekey_json = excluded.signed_prekey_json,
        one_time_prekeys_json = excluded.one_time_prekeys_json,
        updated_at = datetime('now')
    `).run(
      userId,
      String(identityKey),
      JSON.stringify(signedPreKey),
      JSON.stringify(oneTimePreKeys),
    );

    // Keep users.identity_pubkey in sync with bundle identity key.
    db.prepare('UPDATE users SET identity_pubkey = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(String(identityKey), userId);

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/keys/bundle/:userId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const requesterUserId = normalizeUserId(req.userId);
    const requestedUserId = String(req.params.userId || '');
    const userId = resolveUserIdByIdOrUsername(db, requestedUserId);

    if (!userId) {
      return res.status(404).json({ error: 'not_found', code: 'not_found' });
    }

    if (isBundleRateLimited(req, requesterUserId, userId)) {
      return res.status(429).json({ error: 'rate_limited', code: 'rate_limited' });
    }

    const relationship = canAccessUserRelationshipData(db, requesterUserId, userId, {
      allowSharedServer: true,
    });
    if (!relationship.ok) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    const row = db.prepare(`
      SELECT identity_key, signed_prekey_json, one_time_prekeys_json
      FROM user_key_bundles
      WHERE user_id = ?
      LIMIT 1
    `).get(userId);

    if (!row) {
      return res.status(404).json({ error: 'not_found', code: 'not_found' });
    }

    return res.json({
      identityKey: row.identity_key,
      signedPreKey: JSON.parse(row.signed_prekey_json),
      oneTimePreKeys: JSON.parse(row.one_time_prekeys_json),
    });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.get('/sync/:userId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const authUser = req.userId;
    const userId = String(req.params.userId || '');
    if (authUser !== userId) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    const rows = db.prepare(`
      SELECT key, value_json, updated_at
      FROM user_sync_kv
      WHERE user_id = ?
    `).all(userId);

    const data = {};
    for (const row of rows) {
      data[row.key] = {
        value: req.secureFields.decodeJson('sync', userId, 'user_sync_kv', row.key, 'value_json', row.value_json),
        updatedAt: row.updated_at,
      };
    }

    return res.json({ data });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});

v1Router.put('/sync/:userId', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const authUser = req.userId;
    const userId = String(req.params.userId || '');
    if (authUser !== userId) {
      return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
    }

    const oneKey = typeof req.body?.key === 'string';
    const hasData = req.body?.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data);

    if (!oneKey && !hasData) {
      return res.status(400).json({ error: 'bad_request', code: 'bad_request' });
    }

    const upsert = db.prepare(`
      INSERT INTO user_sync_kv (user_id, key, value_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = datetime('now')
    `);

    const tx = db.transaction(() => {
      if (oneKey) {
        upsert.run(
          userId,
          req.body.key,
          req.secureFields.encodeJson('sync', userId, 'user_sync_kv', req.body.key, 'value_json', req.body.value ?? null),
        );
      }
      if (hasData) {
        for (const [k, v] of Object.entries(req.body.data)) {
          upsert.run(userId, k, req.secureFields.encodeJson('sync', userId, 'user_sync_kv', k, 'value_json', v));
        }
      }
    });
    tx();

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'internal', code: 'internal' });
  }
});
