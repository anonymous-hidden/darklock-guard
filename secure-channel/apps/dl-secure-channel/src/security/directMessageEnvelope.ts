import type { EncryptedMessage, X3DHHeader } from '@darklock/channel-crypto';

export const UNSUPPORTED_DIRECT_MESSAGE_NOTICE =
  'Unable to display this unsupported or unauthenticated message.';

type ParsedDirectMessageEnvelope = {
  ok: true;
  ciphertext: EncryptedMessage;
  x3dh?: X3DHHeader;
} | {
  ok: false;
  reason: 'plaintext' | 'malformed' | 'unsupported-version';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseDirectMessageEnvelope(raw: unknown): ParsedDirectMessageEnvelope {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512 * 1024) {
    return { ok: false, reason: 'malformed' };
  }

  let outer: unknown;
  try {
    outer = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'plaintext' };
  }
  if (!isRecord(outer) || outer.e2ee !== true || !isRecord(outer.ciphertext)) {
    return { ok: false, reason: 'plaintext' };
  }

  const ciphertext = outer.ciphertext;
  if (!isRecord(ciphertext.header) || !isRecord(ciphertext.envelope)) {
    return { ok: false, reason: 'malformed' };
  }
  const { header, envelope } = ciphertext;
  if (envelope.v !== 1 || envelope.alg !== 'xchacha20-poly1305') {
    return { ok: false, reason: 'unsupported-version' };
  }
  if (typeof envelope.nonce !== 'string' || typeof envelope.ct !== 'string'
    || typeof envelope.ad !== 'string' || typeof header.ratchetPub !== 'string'
    || !isNonNegativeInteger(header.messageNum) || !isNonNegativeInteger(header.prevChainLen)) {
    return { ok: false, reason: 'malformed' };
  }

  let x3dh: X3DHHeader | undefined;
  if (outer.x3dh !== undefined) {
    if (!isRecord(outer.x3dh)
      || typeof outer.x3dh.identityKey !== 'string'
      || typeof outer.x3dh.ephemeralKey !== 'string'
      || !isNonNegativeInteger(outer.x3dh.signedPreKeyId)
      || (outer.x3dh.usedOneTimeKeyId !== undefined
        && !isNonNegativeInteger(outer.x3dh.usedOneTimeKeyId))) {
      return { ok: false, reason: 'malformed' };
    }
    x3dh = outer.x3dh as unknown as X3DHHeader;
  }

  return {
    ok: true,
    ciphertext: ciphertext as unknown as EncryptedMessage,
    ...(x3dh ? { x3dh } : {}),
  };
}

interface InvalidAttemptState {
  windowStartedAt: number;
  failures: number;
  blockedUntil: number;
}

export class InvalidEnvelopeRateLimiter {
  private readonly attempts = new Map<string, InvalidAttemptState>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000,
    private readonly blockMs = 5 * 60_000,
    private readonly maxEntries = 1_000,
  ) {}

  canAttempt(senderId: string, now = Date.now()): boolean {
    const state = this.attempts.get(senderId);
    if (!state) return true;
    if (state.blockedUntil > now) return false;
    if (now - state.windowStartedAt >= this.windowMs) this.attempts.delete(senderId);
    return true;
  }

  recordFailure(senderId: string, now = Date.now()): void {
    const existing = this.attempts.get(senderId);
    const state = !existing || now - existing.windowStartedAt >= this.windowMs
      ? { windowStartedAt: now, failures: 0, blockedUntil: 0 }
      : existing;
    state.failures += 1;
    if (state.failures >= this.maxFailures) state.blockedUntil = now + this.blockMs;
    this.attempts.set(senderId, state);

    if (this.attempts.size > this.maxEntries) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (oldest) this.attempts.delete(oldest);
    }
  }
}
