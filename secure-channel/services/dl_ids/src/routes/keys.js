/**
 * IDS Key management routes: /keys/upload
 */
import { createPublicKey, randomBytes, randomUUID, verify } from 'crypto';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const keysRouter = Router();

const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');
const IDENTITY_ROTATION_CHALLENGE_TTL_SECONDS = 5 * 60;

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return Buffer.from(value.trim(), 'base64url');
  } catch {
    return null;
  }
}

function buildIdentityRotationSignaturePayload({
  userId,
  oldIdentityPubkey,
  newIdentityPubkey,
  previousKeyVersion,
  newKeyVersion,
  nonce,
}) {
  return [
    userId,
    oldIdentityPubkey,
    newIdentityPubkey,
    String(previousKeyVersion),
    String(newKeyVersion),
    nonce,
  ].join('\n');
}

function verifyIdentityRotationSignature({
  userId,
  oldIdentityPubkey,
  newIdentityPubkey,
  previousKeyVersion,
  newKeyVersion,
  nonce,
  signature,
}) {
  const oldIdentityRaw = decodeBase64Url(oldIdentityPubkey);
  const signatureRaw = decodeBase64Url(signature);
  if (!oldIdentityRaw || oldIdentityRaw.length !== 32) return false;
  if (!signatureRaw || signatureRaw.length !== 64) return false;

  let oldIdentityPublicKey;
  try {
    oldIdentityPublicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_HEADER, oldIdentityRaw]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return false;
  }

  const payload = buildIdentityRotationSignaturePayload({
    userId,
    oldIdentityPubkey,
    newIdentityPubkey,
    previousKeyVersion,
    newKeyVersion,
    nonce,
  });

  try {
    return verify(null, Buffer.from(payload, 'utf8'), oldIdentityPublicKey, signatureRaw);
  } catch {
    return false;
  }
}

// ── POST /keys/upload — upload new one-time prekeys ──────────────────────────
keysRouter.post('/upload', requireAuth, (req, res) => {
  try {
    const { one_time_prekeys } = req.body;
    if (!one_time_prekeys || !Array.isArray(one_time_prekeys) || one_time_prekeys.length === 0) {
      return res.status(400).json({ error: 'Provide an array of one_time_prekeys', code: 'bad_request' });
    }

    const db = req.db;
    const userId = req.userId;

    // Find user's current device
    const device = db.prepare('SELECT device_id FROM devices WHERE user_id = ? LIMIT 1').get(userId);
    if (!device) {
      return res.status(404).json({ error: 'No enrolled device found', code: 'not_found' });
    }

    const stmt = db.prepare('INSERT INTO one_time_prekeys (device_id, opk_pub) VALUES (?, ?)');
    const insertMany = db.transaction((keys) => {
      for (const key of keys) {
        stmt.run(device.device_id, key);
      }
    });
    insertMany(one_time_prekeys);

    const remaining = db.prepare(
      'SELECT COUNT(*) as count FROM one_time_prekeys WHERE device_id = ? AND used = 0'
    ).get(device.device_id);

    res.json({ uploaded: one_time_prekeys.length, remaining: remaining.count });
  } catch (err) {
    console.error('Key upload error:');
    res.status(500).json({ error: 'Key upload failed', code: 'internal' });
  }
});

// ── PUT /keys/spk — replace the signed prekey for the current device ─────────
// Called at login time to refresh keys and fix any previously corrupted SPK.
keysRouter.put('/spk', requireAuth, (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const { spk_pubkey, spk_sig, one_time_prekeys } = body;
    if (!spk_pubkey || !spk_sig) {
      return res.status(400).json({ error: 'spk_pubkey and spk_sig are required', code: 'bad_request' });
    }

    // SPK refresh must not rotate the user's identity key.
    if (Object.prototype.hasOwnProperty.call(body, 'identity_pubkey')) {
      return res.status(400).json({
        error: 'identity_pubkey cannot be updated via /keys/spk',
        code: 'bad_request',
      });
    }

    const db = req.db;
    const userId = req.userId;

    const device = db.prepare('SELECT device_id FROM devices WHERE user_id = ? LIMIT 1').get(userId);
    if (!device) {
      return res.status(404).json({ error: 'No enrolled device found', code: 'not_found' });
    }

    // Upsert the SPK
    db.prepare(`
      INSERT OR REPLACE INTO signed_prekeys (device_id, spk_pubkey, spk_sig)
      VALUES (?, ?, ?)
    `).run(device.device_id, spk_pubkey, spk_sig);

    // Optionally replenish OPKs at the same time
    if (one_time_prekeys && Array.isArray(one_time_prekeys) && one_time_prekeys.length > 0) {
      const stmt = db.prepare('INSERT INTO one_time_prekeys (device_id, opk_pub) VALUES (?, ?)');
      const insertMany = db.transaction((keys) => {
        for (const key of keys) stmt.run(device.device_id, key);
      });
      insertMany(one_time_prekeys);
    }

    console.log('[IDS_SPK_REFRESHED]');
    res.json({ ok: true });
  } catch (err) {
    console.error('SPK refresh error:');
    res.status(500).json({ error: 'SPK refresh failed', code: 'internal' });
  }
});

// ── POST /keys/identity/rotate/challenge — issue one-time nonce ────────────
keysRouter.post('/identity/rotate/challenge', requireAuth, (req, res) => {
  try {
    const db = req.db;
    const userId = req.userId;

    const user = db.prepare('SELECT id, key_version FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    const nonce = randomBytes(32).toString('base64url');
    db.prepare(`
      INSERT INTO identity_key_rotation_challenges (id, user_id, nonce, expires_at)
      VALUES (?, ?, ?, datetime('now', '+5 minutes'))
    `).run(randomUUID(), userId, nonce);

    // Opportunistic cleanup of stale/used challenges for this user.
    db.prepare(`
      DELETE FROM identity_key_rotation_challenges
      WHERE user_id = ?
        AND (used_at IS NOT NULL OR expires_at <= datetime('now'))
    `).run(userId);

    res.json({
      nonce,
      previous_key_version: user.key_version,
      expires_in_seconds: IDENTITY_ROTATION_CHALLENGE_TTL_SECONDS,
    });
  } catch (err) {
    console.error('Identity key rotation challenge error:');
    res.status(500).json({ error: 'Failed to issue rotation challenge', code: 'internal' });
  }
});

// ── POST /keys/identity/rotate — rotate identity key with signed proof ─────
keysRouter.post('/identity/rotate', requireAuth, (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const {
      new_identity_pubkey,
      new_key_version,
      nonce,
      signature,
    } = body;

    if (!new_identity_pubkey || !nonce || !signature || new_key_version === undefined) {
      return res.status(400).json({
        error: 'new_identity_pubkey, new_key_version, nonce, and signature are required',
        code: 'bad_request',
      });
    }

    const parsedNewKeyVersion = Number(new_key_version);
    if (!Number.isInteger(parsedNewKeyVersion)) {
      return res.status(400).json({ error: 'new_key_version must be an integer', code: 'bad_request' });
    }

    const newIdentityRaw = decodeBase64Url(new_identity_pubkey);
    if (!newIdentityRaw || newIdentityRaw.length !== 32) {
      return res.status(400).json({ error: 'new_identity_pubkey must be a valid Ed25519 public key', code: 'bad_request' });
    }

    const db = req.db;
    const userId = req.userId;
    const user = db.prepare('SELECT id, identity_pubkey, key_version FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'not_found' });
    }

    const previousKeyVersion = Number(user.key_version);
    if (parsedNewKeyVersion !== previousKeyVersion + 1) {
      return res.status(400).json({
        error: 'new_key_version must equal previous key_version + 1',
        code: 'bad_request',
      });
    }

    if (new_identity_pubkey === user.identity_pubkey) {
      return res.status(400).json({ error: 'new_identity_pubkey must differ from current key', code: 'bad_request' });
    }

    const challenge = db.prepare(`
      SELECT id
      FROM identity_key_rotation_challenges
      WHERE user_id = ?
        AND nonce = ?
        AND used_at IS NULL
        AND expires_at > datetime('now')
      LIMIT 1
    `).get(userId, nonce);

    if (!challenge) {
      return res.status(400).json({ error: 'Invalid or expired rotation challenge', code: 'bad_request' });
    }

    const signatureValid = verifyIdentityRotationSignature({
      userId,
      oldIdentityPubkey: user.identity_pubkey,
      newIdentityPubkey: new_identity_pubkey,
      previousKeyVersion,
      newKeyVersion: parsedNewKeyVersion,
      nonce,
      signature,
    });

    if (!signatureValid) {
      return res.status(400).json({ error: 'Invalid identity rotation signature', code: 'bad_request' });
    }

    const rotateIdentityKey = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET identity_pubkey = ?, key_version = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(new_identity_pubkey, parsedNewKeyVersion, userId);

      db.prepare(`
        UPDATE identity_key_rotation_challenges
        SET used_at = datetime('now')
        WHERE id = ?
      `).run(challenge.id);

      db.prepare(`
        INSERT INTO identity_key_history (
          id,
          user_id,
          old_identity_pubkey,
          new_identity_pubkey,
          previous_key_version,
          new_key_version,
          nonce,
          signature,
          rotated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        randomUUID(),
        userId,
        user.identity_pubkey,
        new_identity_pubkey,
        previousKeyVersion,
        parsedNewKeyVersion,
        nonce,
        signature,
      );
    });

    rotateIdentityKey();

    res.json({ ok: true, key_version: parsedNewKeyVersion });
  } catch (err) {
    console.error('Identity key rotation error:');
    res.status(500).json({ error: 'Identity key rotation failed', code: 'internal' });
  }
});
