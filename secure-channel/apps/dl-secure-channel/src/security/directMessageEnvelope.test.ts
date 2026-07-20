import { describe, expect, it } from 'vitest';
import { InvalidEnvelopeRateLimiter, parseDirectMessageEnvelope } from './directMessageEnvelope';

const validEnvelope = JSON.stringify({
  e2ee: true,
  ciphertext: {
    header: { ratchetPub: 'public-key', messageNum: 0, prevChainLen: 0 },
    envelope: {
      v: 1,
      alg: 'xchacha20-poly1305',
      nonce: 'nonce',
      ct: 'ciphertext',
      ad: 'associated-data',
    },
  },
});

describe('direct-message envelope boundary', () => {
  it('accepts the current authenticated ratchet envelope version', () => {
    expect(parseDirectMessageEnvelope(validEnvelope).ok).toBe(true);
  });

  it('rejects plaintext and unknown versions', () => {
    expect(parseDirectMessageEnvelope('hello')).toEqual({ ok: false, reason: 'plaintext' });
    const unknown = JSON.parse(validEnvelope);
    unknown.ciphertext.envelope.v = 2;
    expect(parseDirectMessageEnvelope(JSON.stringify(unknown))).toEqual({
      ok: false,
      reason: 'unsupported-version',
    });
  });

  it('rate-limits repeated invalid envelopes without blocking other senders', () => {
    const limiter = new InvalidEnvelopeRateLimiter(2, 1_000, 5_000);
    limiter.recordFailure('sender-a', 100);
    expect(limiter.canAttempt('sender-a', 101)).toBe(true);
    limiter.recordFailure('sender-a', 102);
    expect(limiter.canAttempt('sender-a', 103)).toBe(false);
    expect(limiter.canAttempt('sender-b', 103)).toBe(true);
    expect(limiter.canAttempt('sender-a', 5_103)).toBe(true);
  });
});
