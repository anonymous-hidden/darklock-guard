import { describe, expect, it } from 'vitest';
import {
  acceptObservedIdentityKey,
  canSendSecureMessage,
  evaluatePeerIdentityObservation,
  type PeerIdentityTrustRecord,
} from './identityTrust';

describe('identityTrust TOFU behavior', () => {
  it('pins the first observed identity key', () => {
    const result = evaluatePeerIdentityObservation(null, 'peer-key-a', 1_000);

    expect(result.firstObserved).toBe(true);
    expect(result.keyChanged).toBe(false);
    expect(result.allowSecureSession).toBe(true);
    expect(result.next.pinnedIdentityKey).toBe('peer-key-a');
    expect(result.next.observedIdentityKey).toBe('peer-key-a');
    expect(result.next.keyChangePending).toBe(false);
  });

  it('accepts the same pinned key and clears pending warning state', () => {
    const current: PeerIdentityTrustRecord = {
      pinnedIdentityKey: 'peer-key-a',
      observedIdentityKey: 'peer-key-b',
      keyChangePending: true,
      firstSeenAt: 1_000,
      updatedAt: 1_100,
      changedAt: 1_100,
      previousPinnedIdentityKey: 'peer-key-a',
    };

    const result = evaluatePeerIdentityObservation(current, 'peer-key-a', 1_200);

    expect(result.firstObserved).toBe(false);
    expect(result.keyChanged).toBe(false);
    expect(result.allowSecureSession).toBe(true);
    expect(result.next.keyChangePending).toBe(false);
    expect(result.next.changedAt).toBeUndefined();
    expect(result.next.previousPinnedIdentityKey).toBeUndefined();
  });

  it('flags a changed identity key as pending verification', () => {
    const current: PeerIdentityTrustRecord = {
      pinnedIdentityKey: 'peer-key-a',
      observedIdentityKey: 'peer-key-a',
      keyChangePending: false,
      firstSeenAt: 1_000,
      updatedAt: 1_000,
    };

    const result = evaluatePeerIdentityObservation(current, 'peer-key-b', 2_000);

    expect(result.firstObserved).toBe(false);
    expect(result.keyChanged).toBe(true);
    expect(result.next.keyChangePending).toBe(true);
    expect(result.next.previousPinnedIdentityKey).toBe('peer-key-a');
    expect(result.next.changedAt).toBe(2_000);
  });

  it('blocks silent secure sending while key change is pending', () => {
    const current: PeerIdentityTrustRecord = {
      pinnedIdentityKey: 'peer-key-a',
      observedIdentityKey: 'peer-key-a',
      keyChangePending: false,
      firstSeenAt: 1_000,
      updatedAt: 1_000,
    };

    const changed = evaluatePeerIdentityObservation(current, 'peer-key-b', 2_000);
    expect(changed.allowSecureSession).toBe(false);
    expect(canSendSecureMessage(changed.next)).toBe(false);

    const accepted = acceptObservedIdentityKey(changed.next, 2_100);
    expect(canSendSecureMessage(accepted)).toBe(true);
    expect(accepted.pinnedIdentityKey).toBe('peer-key-b');
  });
});
