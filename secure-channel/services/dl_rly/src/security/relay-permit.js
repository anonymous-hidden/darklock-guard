import jwt from 'jsonwebtoken';

const RELAY_SEND_PERMIT_TYPE = 'relay_send_permit';
const RELAY_SEND_PERMIT_AUDIENCE = 'dl-rly';
const RELAY_SEND_PERMIT_ISSUER = 'dl-ids';

function normalizeUserId(value) {
  return String(value ?? '').trim();
}

function normalizeRecipients(rawRecipients, fromUserId) {
  if (!Array.isArray(rawRecipients)) return [];
  return [...new Set(rawRecipients
    .map(normalizeUserId)
    .filter((userId) => userId && userId !== fromUserId))].sort();
}

export function verifyRelaySendPermit({
  secret,
  permitToken,
  fromUserId,
  eventType,
  toUserId = '',
  recipients = [],
  groupId = '',
}) {
  if (typeof secret !== 'string' || secret.trim().length < 32) throw new Error('relay_auth_misconfigured');
  if (typeof permitToken !== 'string' || permitToken.trim().length === 0) throw new Error('missing_permit');

  let payload;
  try {
    payload = jwt.verify(permitToken, secret.trim(), {
      algorithms: ['HS256'],
      audience: RELAY_SEND_PERMIT_AUDIENCE,
      issuer: RELAY_SEND_PERMIT_ISSUER,
    });
  } catch (error) {
    if (error?.name === 'TokenExpiredError') throw new Error('expired_permit');
    throw new Error('invalid_permit');
  }

  if (!payload || typeof payload !== 'object' || payload.type !== RELAY_SEND_PERMIT_TYPE) {
    throw new Error('invalid_permit');
  }
  if (normalizeUserId(payload.sub) !== normalizeUserId(fromUserId)) throw new Error('permit_sender_mismatch');
  if (String(payload.eventType ?? '') !== eventType) throw new Error('permit_event_mismatch');
  if (toUserId && normalizeUserId(payload.to) !== normalizeUserId(toUserId)) {
    throw new Error('permit_recipient_mismatch');
  }

  if (recipients.length > 0) {
    const expected = normalizeRecipients(recipients, fromUserId);
    const permitted = normalizeRecipients(payload.recipients, fromUserId);
    if (expected.length !== permitted.length || expected.some((value, index) => value !== permitted[index])) {
      throw new Error('permit_recipients_mismatch');
    }
  }
  if (eventType.startsWith('group_')) {
    if (!groupId || normalizeUserId(payload.groupId) !== normalizeUserId(groupId)) {
      throw new Error('permit_group_mismatch');
    }
  }

  return payload;
}
