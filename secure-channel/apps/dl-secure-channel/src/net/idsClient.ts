/* ──────────────────────────────────────────────────────────
 *  IDS Client — communicate with Identity & Key Distribution
 * ────────────────────────────────────────────────────────── */

import { useConnectionStore } from '../stores/connectionStore.js';
import type { PreKeyBundle, SignedPreKey, OneTimePreKey } from '../types.js';

export interface TurnCredentialsResponse {
  username: string;
  credential: string;
  urls: string[];
  expires_at: number;
  expires_in_seconds: number;
}

export interface RelaySendPermitRequest {
  type: string;
  to?: string;
  recipients?: string[];
  groupId?: string;
}

export interface RelaySendPermitResponse {
  permit: string;
  expires_in_seconds: number;
}

async function idsRequest(path: string, options?: RequestInit) {
  const { idsUrl } = useConnectionStore.getState();
  const res = await fetch(`${idsUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `IDS request failed: ${res.status}`);
  }
  return res.json();
}

export async function registerKeys(
  userId: string,
  identityKey: string,
  signedPreKey: SignedPreKey,
  oneTimePreKeys: OneTimePreKey[],
) {
  return idsRequest('/v1/keys/register', {
    method: 'POST',
    body: JSON.stringify({ userId, identityKey, signedPreKey, oneTimePreKeys }),
  });
}

export async function fetchPreKeyBundle(userId: string): Promise<PreKeyBundle> {
  return idsRequest(`/v1/keys/bundle/${encodeURIComponent(userId)}`);
}

export async function replenishKeys(userId: string, oneTimePreKeys: OneTimePreKey[]) {
  return idsRequest('/v1/keys/replenish', {
    method: 'POST',
    body: JSON.stringify({ userId, oneTimePreKeys }),
  });
}

export async function getKeyCount(userId: string): Promise<number> {
  const result = await idsRequest(`/v1/keys/count/${encodeURIComponent(userId)}`);
  return result.remaining;
}

export async function updateSignedPreKey(userId: string, signedPreKey: SignedPreKey) {
  return idsRequest('/v1/keys/signed-prekey', {
    method: 'PUT',
    body: JSON.stringify({ userId, signedPreKey }),
  });
}

export async function checkIdsHealth(): Promise<boolean> {
  try {
    const result = await idsRequest('/health');
    return result.status === 'ok';
  } catch {
    return false;
  }
}

export async function fetchTurnCredentials(sessionToken: string): Promise<TurnCredentialsResponse> {
  return idsRequest('/v1/turn/credentials', {
    method: 'GET',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

export async function fetchRelaySendPermit(
  sessionToken: string,
  payload: RelaySendPermitRequest,
): Promise<RelaySendPermitResponse> {
  return idsRequest('/v1/relay/permit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(payload),
  });
}
