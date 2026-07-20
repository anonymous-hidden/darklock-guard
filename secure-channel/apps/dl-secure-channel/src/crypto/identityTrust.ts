export interface PeerIdentityTrustRecord {
  pinnedIdentityKey: string;
  observedIdentityKey: string;
  keyChangePending: boolean;
  firstSeenAt: number;
  updatedAt: number;
  changedAt?: number;
  previousPinnedIdentityKey?: string;
  safetyNumber?: string;
}

export interface IdentityObservationResult {
  next: PeerIdentityTrustRecord;
  firstObserved: boolean;
  keyChanged: boolean;
  allowSecureSession: boolean;
  stateChanged: boolean;
}

function recordsEqual(a: PeerIdentityTrustRecord | null | undefined, b: PeerIdentityTrustRecord): boolean {
  if (!a) return false;
  return (
    a.pinnedIdentityKey === b.pinnedIdentityKey
    && a.observedIdentityKey === b.observedIdentityKey
    && a.keyChangePending === b.keyChangePending
    && a.firstSeenAt === b.firstSeenAt
    && a.changedAt === b.changedAt
    && a.previousPinnedIdentityKey === b.previousPinnedIdentityKey
    && a.safetyNumber === b.safetyNumber
  );
}

export function evaluatePeerIdentityObservation(
  current: PeerIdentityTrustRecord | null | undefined,
  observedIdentityKey: string,
  now = Date.now(),
): IdentityObservationResult {
  if (!observedIdentityKey || typeof observedIdentityKey !== 'string') {
    throw new Error('observed identity key is required');
  }

  if (!current) {
    const next: PeerIdentityTrustRecord = {
      pinnedIdentityKey: observedIdentityKey,
      observedIdentityKey,
      keyChangePending: false,
      firstSeenAt: now,
      updatedAt: now,
    };
    return {
      next,
      firstObserved: true,
      keyChanged: false,
      allowSecureSession: true,
      stateChanged: true,
    };
  }

  if (current.pinnedIdentityKey === observedIdentityKey) {
    const next: PeerIdentityTrustRecord = {
      ...current,
      observedIdentityKey,
      keyChangePending: false,
      changedAt: undefined,
      previousPinnedIdentityKey: undefined,
      updatedAt: now,
    };
    return {
      next,
      firstObserved: false,
      keyChanged: false,
      allowSecureSession: true,
      stateChanged: !recordsEqual(current, next),
    };
  }

  const next: PeerIdentityTrustRecord = {
    ...current,
    observedIdentityKey,
    keyChangePending: true,
    previousPinnedIdentityKey: current.pinnedIdentityKey,
    changedAt: current.changedAt ?? now,
    updatedAt: now,
  };

  return {
    next,
    firstObserved: false,
    keyChanged: true,
    allowSecureSession: false,
    stateChanged: !recordsEqual(current, next),
  };
}

export function acceptObservedIdentityKey(
  current: PeerIdentityTrustRecord,
  now = Date.now(),
): PeerIdentityTrustRecord {
  return {
    ...current,
    pinnedIdentityKey: current.observedIdentityKey,
    keyChangePending: false,
    previousPinnedIdentityKey: undefined,
    changedAt: undefined,
    updatedAt: now,
  };
}

export function canSendSecureMessage(current: PeerIdentityTrustRecord | null | undefined): boolean {
  return !current?.keyChangePending;
}
