/* ──────────────────────────────────────────────────────────
 *  E2EE Session Manager — X3DH key agreement + Double Ratchet
 *
 *  Manages per-conversation ratchet sessions. Handles both
 *  initiating (sender X3DH) and responding (receiver X3DH),
 *  then ongoing ratchet encrypt / decrypt.
 *
 *  Sessions are held in memory (wiped on lock).
 *  CRIT-2: Replaces plaintext JSON payloads with real E2EE.
 * ────────────────────────────────────────────────────────── */

import {
  initCrypto,
  x3dhSender, x3dhReceiver,
  initSenderRatchet, initReceiverRatchet,
  ratchetEncrypt, ratchetDecrypt,
  fromBase64, toBase64, toHex, hash, pad, unpad, wipe,
  encrypt, decrypt,
  computeSafetyNumber,
  type RatchetState, type X3DHHeader, type EncryptedMessage,
  type PreKeyBundle, type Bytes, type X25519KeyPair, type Envelope,
} from '@darklock/channel-crypto';
import { useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useConnectionStore } from '../stores/connectionStore.js';
import { updateVault, type VaultKeyMaterial } from './vault.js';
import {
  type PeerIdentityTrustRecord,
  evaluatePeerIdentityObservation,
  acceptObservedIdentityKey,
  canSendSecureMessage,
} from './identityTrust.js';
import { createLogger } from '../utils/logger';

const log = createLogger('e2ee');

/** Active ratchet sessions: recipientUserId → RatchetState */
const sessions = new Map<string, RatchetState>();

/** Pending X3DH headers to attach on first message to a new session */
const pendingHeaders = new Map<string, X3DHHeader>();

/** Vault-loaded pre-key secrets for X3DH receiver path */
let spkSecret: Bytes | null = null;
let spkKeyId: number | null = null;
let spkPublicKey: Bytes | null = null;
const opkSecrets = new Map<number, Bytes>();

/** Public bundle data retained from vault load — used for startup key re-registration. */
interface BundleRegistrationData {
  identityKey: string;        // base64 Ed25519 public key
  signedPreKey: { keyId: number; publicKey: string; signature: string; };
  oneTimePreKeys: { keyId: number; publicKey: string; }[];
}
let localBundle: BundleRegistrationData | null = null;

function isBundleUpToDate(
  local: Pick<BundleRegistrationData, 'identityKey' | 'signedPreKey'>,
  remoteRaw: any,
): boolean {
  const remote = remoteRaw?.bundle ?? remoteRaw;
  if (!remote?.identityKey || !remote?.signedPreKey) return false;
  const sameIdentity = remote.identityKey === local.identityKey;
  const sameSpk =
    Number(remote.signedPreKey.keyId) === Number(local.signedPreKey.keyId)
    && remote.signedPreKey.publicKey === local.signedPreKey.publicKey;
  return sameIdentity && sameSpk;
}

let cryptoReady = false;

/** Per-peer TOFU trust map persisted inside the encrypted local vault. */
const peerIdentityPins = new Map<string, PeerIdentityTrustRecord>();

export interface PeerVerificationDisplay {
  peerUserId: string;
  keyChangePending: boolean;
  localFingerprint: string;
  pinnedFingerprint: string;
  observedFingerprint: string;
  safetyNumber: string;
  pinnedIdentityKey: string;
  observedIdentityKey: string;
}

/** Cache of failed bundle lookups → timestamp. Prevents retry storms against IDS. */
const failedBundleCache = new Map<string, number>();
const BUNDLE_FAIL_TTL = 5 * 60_000; // 5 minutes

/** Users known to have no keys registered on IDS (4xx from bundle endpoint) → expiry timestamp. */
const noBundleUsers = new Map<string, number>();
const NO_BUNDLE_TTL = BUNDLE_FAIL_TTL; // align with failedBundleCache — re-check after 5 min

/** Returns true if a recent bundle fetch for this user returned 4xx (no keys registered). */
export function recipientHasNoBundle(userId: string): boolean {
  const exp = noBundleUsers.get(userId);
  if (exp === undefined) return false;
  if (Date.now() > exp) { noBundleUsers.delete(userId); return false; }
  return true;
}

export function recipientRequiresVerification(userId: string): boolean {
  return !!peerIdentityPins.get(userId)?.keyChangePending;
}

export function getPeerTrustRecord(userId: string): PeerIdentityTrustRecord | null {
  return peerIdentityPins.get(userId) ?? null;
}

function formatFingerprint(hex: string): string {
  const upper = hex.toUpperCase();
  const groups = upper.match(/.{1,4}/g);
  return groups ? groups.join(' ') : upper;
}

async function keyFingerprintFromBase64(identityKeyB64: string): Promise<string> {
  try {
    const digest = await hash(fromBase64(identityKeyB64));
    return formatFingerprint(toHex(digest).slice(0, 40));
  } catch {
    return '';
  }
}

async function computePinnedSafetyNumber(pinnedIdentityKey: string): Promise<string> {
  const local = useAuthStore.getState().identityKeyPair?.publicKey;
  if (!local) return '';
  try {
    return await computeSafetyNumber(local, fromBase64(pinnedIdentityKey));
  } catch {
    return '';
  }
}

function syncContactTrustState(
  peerUserId: string,
  pin: PeerIdentityTrustRecord,
  forceVerified = false,
): void {
  const chat = useChatStore.getState();
  const existing = chat.contacts[peerUserId];
  const nextTrustLevel = forceVerified
    ? 'verified'
    : pin.keyChangePending
      ? 'unverified'
      : existing?.trustLevel === 'verified'
        ? 'verified'
        : 'trusted';

  chat.setContactSecurityState(peerUserId, {
    observedIdentityKey: pin.observedIdentityKey,
    pinnedIdentityKey: pin.pinnedIdentityKey,
    keyChangePending: pin.keyChangePending,
    keyChangedAt: pin.changedAt,
    safetyNumber: pin.safetyNumber,
    trustLevel: nextTrustLevel,
  });
}

async function persistPeerPin(peerUserId: string, pin: PeerIdentityTrustRecord): Promise<void> {
  const auth = useAuthStore.getState();
  if (!auth.userId || !auth.encryptionKey) return;

  try {
    await updateVault(auth.userId, auth.encryptionKey, (keys) => ({
      ...keys,
      peerIdentityPins: {
        ...(keys.peerIdentityPins ?? {}),
        [peerUserId]: pin,
      },
    }));
  } catch (err) {
    log.warn('failed to persist peer pin for', peerUserId, err instanceof Error ? err.message : String(err));
  }
}

async function observePeerIdentity(
  peerUserId: string,
  observedIdentityKey: string,
  commit = true,
): Promise<{ allowSecureSession: boolean; keyChanged: boolean; record: PeerIdentityTrustRecord }> {
  const current = peerIdentityPins.get(peerUserId) ?? null;
  const evaluated = evaluatePeerIdentityObservation(current, observedIdentityKey);
  let next = evaluated.next;

  if (!next.safetyNumber || next.pinnedIdentityKey !== current?.pinnedIdentityKey) {
    const safetyNumber = await computePinnedSafetyNumber(next.pinnedIdentityKey);
    if (safetyNumber) {
      next = { ...next, safetyNumber };
    }
  }

  const stateChanged = evaluated.stateChanged || next.safetyNumber !== current?.safetyNumber;
  const effective = stateChanged ? next : (current ?? next);
  if (commit) {
    peerIdentityPins.set(peerUserId, effective);
    if (stateChanged) await persistPeerPin(peerUserId, effective);
    syncContactTrustState(peerUserId, effective);
  }

  return {
    allowSecureSession: canSendSecureMessage(effective),
    keyChanged: effective.keyChangePending,
    record: effective,
  };
}

export async function confirmPeerIdentity(peerUserId: string): Promise<boolean> {
  const current = peerIdentityPins.get(peerUserId);
  if (!current) return false;

  let next = current.keyChangePending ? acceptObservedIdentityKey(current) : current;
  const safetyNumber = await computePinnedSafetyNumber(next.pinnedIdentityKey);
  if (safetyNumber) {
    next = { ...next, safetyNumber };
  }

  peerIdentityPins.set(peerUserId, next);
  await persistPeerPin(peerUserId, next);
  syncContactTrustState(peerUserId, next, true);
  resetSession(peerUserId);
  return true;
}

export async function getPeerVerificationDisplay(peerUserId: string): Promise<PeerVerificationDisplay | null> {
  const pin = peerIdentityPins.get(peerUserId);
  const local = useAuthStore.getState().identityKeyPair?.publicKey;
  if (!pin || !local) return null;

  const localIdentityB64 = toBase64(local);
  // When a key change is pending, compute the safety number against the *observed* (new) key
  // so the user can compare the correct value with their contact out-of-band.
  const safetyNumberKey = pin.keyChangePending ? pin.observedIdentityKey : pin.pinnedIdentityKey;
  const safetyNumber = await computePinnedSafetyNumber(safetyNumberKey);

  return {
    peerUserId,
    keyChangePending: pin.keyChangePending,
    localFingerprint: await keyFingerprintFromBase64(localIdentityB64),
    pinnedFingerprint: await keyFingerprintFromBase64(pin.pinnedIdentityKey),
    observedFingerprint: await keyFingerprintFromBase64(pin.observedIdentityKey),
    safetyNumber,
    pinnedIdentityKey: pin.pinnedIdentityKey,
    observedIdentityKey: pin.observedIdentityKey,
  };
}

// ── Session persistence ──────────────────────────────────
// Ratchet sessions are encrypted with the user's vault key and stored
// alongside the vault file so they survive page refreshes.

const _VAULT_PREFIX = 'darklock_vault_';
const _webVaultFallback = {
  vaultWrite: async (f: string, d: string) => { localStorage.setItem(_VAULT_PREFIX + f, d); },
  vaultRead:  async (f: string) => localStorage.getItem(_VAULT_PREFIX + f),
};
function sessionApi() {
  const ea = (window as any).electronAPI;
  return ea ?? _webVaultFallback;
}

const SESSION_STORE_VERSION = 'v2';
function sessionStoreFile(userId: string): string {
  return `${userId}.sessions.${SESSION_STORE_VERSION}.json`;
}

interface SerializedRatchetState {
  rootKey: string;
  sendChainKey: string | null;
  recvChainKey: string | null;
  sendRatchetKey: { publicKey: string; secretKey: string } | null;
  recvRatchetPub: string | null;
  sendMessageNum: number;
  recvMessageNum: number;
  prevSendCount: number;
  skippedKeys: [string, string][]; // [label, base64]
}

interface SerializedSessionStore {
  sessions: [string, SerializedRatchetState][];
  pendingHeaders: [string, X3DHHeader][];
}

function serializeState(state: RatchetState): SerializedRatchetState {
  return {
    rootKey: toBase64(state.rootKey),
    sendChainKey: state.sendChainKey ? toBase64(state.sendChainKey) : null,
    recvChainKey: state.recvChainKey ? toBase64(state.recvChainKey) : null,
    sendRatchetKey: state.sendRatchetKey
      ? { publicKey: toBase64(state.sendRatchetKey.publicKey), secretKey: toBase64(state.sendRatchetKey.secretKey) }
      : null,
    recvRatchetPub: state.recvRatchetPub ? toBase64(state.recvRatchetPub) : null,
    sendMessageNum: state.sendMessageNum,
    recvMessageNum: state.recvMessageNum,
    prevSendCount: state.prevSendCount,
    skippedKeys: Array.from(state.skippedKeys.entries()).map(([k, v]) => [k, toBase64(v)]),
  };
}

function deserializeState(s: SerializedRatchetState): RatchetState {
  return {
    rootKey: fromBase64(s.rootKey),
    sendChainKey: s.sendChainKey ? fromBase64(s.sendChainKey) : null,
    recvChainKey: s.recvChainKey ? fromBase64(s.recvChainKey) : null,
    sendRatchetKey: s.sendRatchetKey
      ? { publicKey: fromBase64(s.sendRatchetKey.publicKey), secretKey: fromBase64(s.sendRatchetKey.secretKey) }
      : null,
    recvRatchetPub: s.recvRatchetPub ? fromBase64(s.recvRatchetPub) : null,
    sendMessageNum: s.sendMessageNum,
    recvMessageNum: s.recvMessageNum,
    prevSendCount: s.prevSendCount,
    skippedKeys: new Map(s.skippedKeys.map(([k, v]) => [k, fromBase64(v)])),
  };
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist sessions to encrypted storage (debounced — max 2s delay). */
function schedulePersist() {
  if (_persistTimer) return; // already scheduled
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persistSessions().catch(err =>
      log.warn('session persist failed:', err instanceof Error ? err.message : String(err)));
  }, 500);
}

async function persistSessions(): Promise<void> {
  const auth = useAuthStore.getState();
  if (!auth.userId || !auth.encryptionKey) return;

  const store: SerializedSessionStore = {
    sessions: Array.from(sessions.entries()).map(([id, state]) => [id, serializeState(state)]),
    pendingHeaders: Array.from(pendingHeaders.entries()),
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(store));
  const envelope = await encrypt(plaintext, auth.encryptionKey);
  await sessionApi().vaultWrite(sessionStoreFile(auth.userId), JSON.stringify(envelope));
}

/** Load persisted sessions from encrypted storage. Called after vault unlock. */
export async function loadPersistedSessions(
  userId: string,
  encryptionKey: Bytes,
): Promise<void> {
  try {
    const raw = await sessionApi().vaultRead(sessionStoreFile(userId));
    if (!raw) return;
    const envelope: Envelope = JSON.parse(raw);
    const plaintext = await decrypt(envelope, encryptionKey);
    const store: SerializedSessionStore = JSON.parse(new TextDecoder().decode(plaintext));

    for (const [id, s] of store.sessions) {
      if (!sessions.has(id)) {
        sessions.set(id, deserializeState(s));
      }
    }
    for (const [id, h] of store.pendingHeaders) {
      if (!pendingHeaders.has(id)) {
        pendingHeaders.set(id, h);
      }
    }
    log.info('Restored', store.sessions.length, 'persisted session(s)');
  } catch (err) {
    log.warn('Failed to load persisted sessions:', err instanceof Error ? err.message : String(err));
  }
}

/** localStorage key prefix for persisted public bundle — safe to store (public data only). */
const PUB_BUNDLE_PREFIX = 'darklock_pub_bundle_v1_';

function saveBundleToStorage(userId: string, bundle: BundleRegistrationData): void {
  try { localStorage.setItem(PUB_BUNDLE_PREFIX + userId, JSON.stringify(bundle)); } catch { /* ignore */ }
}

function loadBundleFromStorage(userId: string): BundleRegistrationData | null {
  try {
    const raw = localStorage.getItem(PUB_BUNDLE_PREFIX + userId);
    return raw ? JSON.parse(raw) as BundleRegistrationData : null;
  } catch { return null; }
}

/**
 * Load pre-key secrets from the decrypted vault.
 * Called from Login.tsx after vault decryption.
 */
export function loadVaultKeys(vault: VaultKeyMaterial, userId?: string): void {
  spkSecret = fromBase64(vault.signedPreKey.secretKey);
  spkKeyId = vault.signedPreKey.keyId;
  spkPublicKey = fromBase64(vault.signedPreKey.publicKey);

  peerIdentityPins.clear();
  for (const [peerUserId, pin] of Object.entries(vault.peerIdentityPins ?? {})) {
    peerIdentityPins.set(peerUserId, pin);
    syncContactTrustState(peerUserId, pin);
  }

  opkSecrets.clear();
  for (const opk of vault.oneTimePreKeys) {
    opkSecrets.set(opk.keyId, fromBase64(opk.secretKey));
  }

  // Retain public bundle data for startup re-registration check.
  // Skip placeholder keys (all-zero identity key → never onboarded on this device).
  const ikBytes = fromBase64(vault.identityKeyPair.publicKey);
  if (!ikBytes.every(b => b === 0)) {
    localBundle = {
      identityKey: vault.identityKeyPair.publicKey,
      signedPreKey: {
        keyId: vault.signedPreKey.keyId,
        publicKey: vault.signedPreKey.publicKey,
        signature: vault.signedPreKey.signature,
      },
      oneTimePreKeys: vault.oneTimePreKeys.map(k => ({ keyId: k.keyId, publicKey: k.publicKey })),
    };
    // Persist to localStorage so it survives page reloads where vault isn't re-unlocked.
    if (userId) saveBundleToStorage(userId, localBundle);
  }
}

/**
 * Check whether the user's pre-key bundle exists on IDS and re-register if missing
 * or if the remote identity key doesn't match the local vault.
 * Safe to call on every app startup — no-ops if bundle is already current.
 */
export async function ensureKeysRegistered(userId: string, sessionToken: string, idsUrl: string): Promise<void> {
  // Try in-memory first; fall back to localStorage for persisted sessions that
  // survived a page reload without going through vault unlock (Login.tsx).
  const bundle = localBundle ?? loadBundleFromStorage(userId);
  if (!bundle) {
    // No local bundle — try the cross-device sync store as a last resort.
    // The public bundle is persisted there by the primary (vault) device on every login.
    try {
      const syncRes = await fetch(
        `${idsUrl}/v1/sync/${encodeURIComponent(userId)}`,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (!syncRes.ok) {
        log.info('ensureKeysRegistered: no local bundle for', userId, '— skipping (no vault on this device)');
        return;
      }
      const syncData = await syncRes.json();
      const savedBundle = syncData?.data?.e2eeBundle;
      if (!savedBundle?.identityKey || !savedBundle?.signedPreKey?.publicKey) {
        log.info('ensureKeysRegistered: no local bundle for', userId, '— skipping (no vault on this device)');
        return;
      }
      // Check IDS bundle state
      const checkRes = await fetch(`${idsUrl}/v1/keys/bundle/${encodeURIComponent(userId)}`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (checkRes.ok) {
        const existing = await checkRes.json().catch(() => null);
        if (isBundleUpToDate(savedBundle, existing)) {
          log.info('ensureKeysRegistered: bundle OK (from sync) for', userId);
          return;
        }
      } else if (checkRes.status !== 404) {
        return;
      }
      const regRes = await fetch(`${idsUrl}/v1/keys/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({
          userId,
          identityKey: savedBundle.identityKey,
          signedPreKey: { ...savedBundle.signedPreKey, createdAt: Date.now() },
          oneTimePreKeys: savedBundle.oneTimePreKeys ?? [],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (regRes.ok) {
        log.info('ensureKeysRegistered: restored bundle from sync for', userId, '(no-vault device)');
      } else {
        log.error('ensureKeysRegistered: sync bundle restore failed for', userId, 'status', regRes.status);
      }
    } catch (err) {
      log.error('ensureKeysRegistered: sync restore error for', userId, err instanceof Error ? err.message : String(err));
    }
    return;
  }
  log.info('ensureKeysRegistered: checking bundle for', userId);
  try {
    const res = await fetch(`${idsUrl}/v1/keys/bundle/${encodeURIComponent(userId)}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    let needsRegister = res.status === 404;
    if (!needsRegister && res.ok) {
      const data = await res.json().catch(() => null);
      needsRegister = !isBundleUpToDate(bundle, data);
      if (needsRegister) log.info('ensureKeysRegistered: bundle mismatch for', userId, '— re-registering');
    } else if (needsRegister) {
      log.info('ensureKeysRegistered: bundle 404 for', userId, '— re-registering');
    }
    if (!needsRegister) {
      log.info('ensureKeysRegistered: bundle OK for', userId);
      // Still push to sync to keep secondary devices in sync (cheap PUT).
      fetch(`${idsUrl}/v1/sync/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify({ key: 'e2eeBundle', value: {
          identityKey: bundle.identityKey,
          signedPreKey: bundle.signedPreKey,
          oneTimePreKeys: bundle.oneTimePreKeys,
        }}),
        signal: AbortSignal.timeout(8_000),
      }).catch(() => { /* non-fatal */ });
      return;
    }
    const regRes = await fetch(`${idsUrl}/v1/keys/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
      body: JSON.stringify({
        userId,
        identityKey: bundle.identityKey,
        signedPreKey: { ...bundle.signedPreKey, createdAt: Date.now() },
        oneTimePreKeys: bundle.oneTimePreKeys,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (regRes.ok) {
      log.info('ensureKeysRegistered: re-registered bundle for', userId);
      // Also push to cross-device sync so secondary devices can restore it later.
      fetch(`${idsUrl}/v1/sync/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionToken}` },
        body: JSON.stringify({ key: 'e2eeBundle', value: {
          identityKey: bundle.identityKey,
          signedPreKey: bundle.signedPreKey,
          oneTimePreKeys: bundle.oneTimePreKeys,
        }}),
        signal: AbortSignal.timeout(8_000),
      }).then(r => {
        if (r.ok) log.info('ensureKeysRegistered: pushed bundle to sync for', userId);
      }).catch(() => { /* non-fatal */ });
    } else {
      log.error('ensureKeysRegistered: registration failed for', userId, 'status', regRes.status);
    }
  } catch (err) {
    log.error('ensureKeysRegistered: error for', userId, err instanceof Error ? err.message : String(err));
  }
}

async function ensureCrypto() {
  if (!cryptoReady) {
    await initCrypto();
    cryptoReady = true;
  }
}

/** Fetch a user's pre-key bundle from IDS — retries up to 3 times on failure */
async function fetchBundle(userId: string): Promise<PreKeyBundle | null> {
  // Check failure cache to avoid hammering IDS
  const lastFail = failedBundleCache.get(userId);
  if (lastFail && Date.now() - lastFail < BUNDLE_FAIL_TTL) return null;

  const { idsUrl } = useConnectionStore.getState();
  const sessionToken = useAuthStore.getState().sessionToken;
  const headers: Record<string, string> = sessionToken
    ? { Authorization: `Bearer ${sessionToken}` }
    : {};
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${idsUrl}/v1/keys/bundle/${encodeURIComponent(userId)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        // IDS returns the bundle at the top level; accept both shapes for compat
        const b = data.bundle ?? data;
        if (!b?.identityKey) return null; // account exists but no keys published

        const trust = await observePeerIdentity(userId, b.identityKey);
        if (!trust.allowSecureSession) {
          log.warn('blocked session setup for', userId, 'due to unverified identity-key change');
          return null;
        }

        return {
          identityKey: b.identityKey,
          signedPreKey: {
            keyId: b.signedPreKey.keyId,
            publicKey: b.signedPreKey.publicKey,
            signature: b.signedPreKey.signature,
            createdAt: b.signedPreKey.createdAt ?? Date.now(),
          },
          oneTimePreKeys: (b.oneTimePreKeys ?? []).map((k: any) => ({
            keyId: k.keyId,
            publicKey: k.publicKey,
          })),
        };
      }
      // 4xx means the user genuinely has no keys — cache briefly so sender
      // can retry automatically once recipient logs in and re-registers.
      // Also set failedBundleCache to prevent IDS hammering (5-min rate limit).
      if (res.status >= 400 && res.status < 500) {
        noBundleUsers.set(userId, Date.now() + NO_BUNDLE_TTL);
        failedBundleCache.set(userId, Date.now());
        return null;
      }
    } catch {
      // network error — fall through to retry
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  failedBundleCache.set(userId, Date.now());
  return null;
}

/**
 * Establish or retrieve a ratchet session with `recipientId`.
 * If no session exists, performs X3DH sender-side key agreement.
 * Returns null if identity keys aren't loaded or the recipient has no keys on IDS.
 */
export async function getOrCreateSession(recipientId: string): Promise<RatchetState | null> {
  if (recipientRequiresVerification(recipientId)) {
    log.warn('Cannot establish session: peer identity change requires verification for', recipientId);
    return null;
  }

  if (sessions.has(recipientId)) return sessions.get(recipientId)!;

  // Skip IDS entirely if we already know this user has no keys (within TTL window)
  if (recipientHasNoBundle(recipientId)) {
    log.debug('getOrCreateSession: skipping fetchBundle — known no-key user', recipientId);
    return null;
  }

  await ensureCrypto();

  const auth = useAuthStore.getState();
  if (!auth.identityKeyPair) {
    log.error('Cannot establish session: identity keys not loaded (vault locked?)');
    return null;
  }

  // Reject all-zero placeholder keys (no vault on this device — E2EE not available)
  if (auth.identityKeyPair.publicKey.every((b: number) => b === 0)) {
    log.error('Cannot establish session: identity key is placeholder (no vault). Re-onboard to generate real keys.');
    return null;
  }

  const bundle = await fetchBundle(recipientId);
  if (!bundle) {
    log.error('Cannot establish session: no pre-key bundle found for', recipientId);
    return null;
  }

  try {
    const { header, rootKey, chainKey } = await x3dhSender(
      auth.identityKeyPair.publicKey,
      auth.identityKeyPair.secretKey,
      bundle,
    );

    // Save the X3DH header so we can attach it to the first message
    pendingHeaders.set(recipientId, header);

    const ratchetState = await initSenderRatchet(rootKey, fromBase64(bundle.signedPreKey.publicKey));

    // Clean up derived secrets
    wipe(rootKey);
    wipe(chainKey);

    sessions.set(recipientId, ratchetState);
    schedulePersist();
    return ratchetState;
  } catch (err) {
    // Corrupt or incompatible keys on the remote side (e.g. fake/invalid signature).
    // Mark as noBundleUsers so the UI shows "recipient has no E2EE keys" rather
    // than silently failing. Also cache the failure to avoid hammering IDS.
    log.error('X3DH key agreement failed for', recipientId, err);
    noBundleUsers.set(recipientId, Date.now() + NO_BUNDLE_TTL);
    failedBundleCache.set(recipientId, Date.now());
    return null;
  }
}

/**
 * Process an incoming X3DH header from a new session initiator.
 * Establishes the receiver-side ratchet session using vault-loaded keys.
 */
export async function processIncomingSession(
  senderId: string,
  x3dhHeader: X3DHHeader,
): Promise<RatchetState | null> {
  await ensureCrypto();

  const auth = useAuthStore.getState();
  if (!auth.identityKeyPair) {
    log.error('processIncoming: no identityKeyPair in authStore');
    return null;
  }

  const trust = await observePeerIdentity(senderId, x3dhHeader.identityKey, false);
  if (!trust.allowSecureSession) {
    log.warn('SECURITY_X3DH_IDENTITY_CHANGE_BLOCKED');
    return null;
  }

  // Verify we have the SPK secret that the sender targeted
  if (!spkSecret || spkKeyId !== x3dhHeader.signedPreKeyId) {
    log.error('SECURITY_X3DH_SIGNED_PREKEY_MISMATCH');
    return null;
  }

  try {
    // Consume only a provisional map. The real OPK is committed after AEAD succeeds.
    const provisionalOpkSecrets = new Map(opkSecrets);
    const { rootKey, chainKey } = await x3dhReceiver(
      auth.identityKeyPair.publicKey,
      auth.identityKeyPair.secretKey,
      spkSecret,
      provisionalOpkSecrets,
      x3dhHeader,
    );

    // Build Bob's initial ratchet key pair from the SPK
    const localRatchetKeyPair: X25519KeyPair = {
      publicKey: spkPublicKey!.slice(),
      secretKey: spkSecret.slice(),
    };

    const ratchetState = await initReceiverRatchet(rootKey, localRatchetKeyPair);

    // NOTE: Do NOT wipe rootKey here — initReceiverRatchet stores it by
    // reference in ratchetState.rootKey. Wiping it would zero the ratchet's
    // root key and break all subsequent decrypt operations.
    // chainKey (from X3DH) is unused by the ratchet, safe to wipe.
    wipe(chainKey);

    return ratchetState;
  } catch (err) {
    log.error('SECURITY_X3DH_SESSION_REJECTED');
    return null;
  }
}

/**
 * Encrypt a plaintext message payload for a specific recipient.
 * Returns a wire-ready object with ciphertext + any X3DH header.
 */
export async function encryptPayload(
  recipientId: string,
  plaintext: string,
): Promise<{ encrypted: EncryptedMessage; x3dhHeader?: X3DHHeader } | null> {
  if (recipientRequiresVerification(recipientId)) {
    log.warn('encryptPayload blocked: identity-key change pending verification for', recipientId);
    return null;
  }

  const hadSession = sessions.has(recipientId);
  const state = await getOrCreateSession(recipientId);
  if (!state) {
    log.error('encryptPayload: no session for', recipientId, '(getOrCreateSession returned null)');
    return null;
  }

  await ensureCrypto();

  // Pad plaintext to resist traffic analysis
  const encoder = new TextEncoder();
  const padded = await pad(encoder.encode(plaintext));
  const encrypted = await ratchetEncrypt(state, padded);
  schedulePersist();

  // Always include X3DH header until receiver has responded — they need it
  // to establish their ratchet session if they missed the first message.
  const header = pendingHeaders.get(recipientId);
  log.info('encryptPayload for', recipientId,
    'newSession:', !hadSession, 'x3dhHeader:', !!header);
  if (header) {
    return { encrypted, x3dhHeader: header };
  }

  return { encrypted };
}

function discardRatchetState(state: RatchetState): void {
  wipe(state.rootKey);
  if (state.sendChainKey) wipe(state.sendChainKey);
  if (state.recvChainKey) wipe(state.recvChainKey);
  if (state.sendRatchetKey) {
    wipe(state.sendRatchetKey.publicKey);
    wipe(state.sendRatchetKey.secretKey);
  }
  if (state.recvRatchetPub) wipe(state.recvRatchetPub);
  for (const skipped of state.skippedKeys.values()) wipe(skipped);
  state.skippedKeys.clear();
}

async function commitIncomingSessionSecurityState(
  senderId: string,
  x3dhHeader: X3DHHeader,
): Promise<boolean> {
  const auth = useAuthStore.getState();
  const usedOpkId = x3dhHeader.usedOneTimeKeyId;
  if (usedOpkId !== undefined) {
    const consumedSecret = opkSecrets.get(usedOpkId);
    if (!consumedSecret || !auth.userId || !auth.encryptionKey) {
      log.error('SECURITY_X3DH_OPK_COMMIT_UNAVAILABLE');
      return false;
    }
    try {
      await updateVault(auth.userId, auth.encryptionKey, (keys) => ({
        ...keys,
        oneTimePreKeys: keys.oneTimePreKeys.filter((key) => key.keyId !== usedOpkId),
      }));
    } catch {
      log.error('SECURITY_X3DH_OPK_COMMIT_FAILED');
      return false;
    }
    opkSecrets.delete(usedOpkId);
    wipe(consumedSecret);
  }

  const trust = await observePeerIdentity(senderId, x3dhHeader.identityKey, true);
  return trust.allowSecureSession;
}

/**
 * Decrypt an incoming encrypted message.
 */
export async function decryptPayload(
  senderId: string,
  encrypted: EncryptedMessage,
  x3dhHeader?: X3DHHeader,
): Promise<string | null> {
  await ensureCrypto();

  const existingState = sessions.get(senderId);
  let state = existingState;
  let provisional = false;

  if (!state && x3dhHeader) {
    state = await processIncomingSession(senderId, x3dhHeader) ?? undefined;
    provisional = Boolean(state);
  }
  if (!state) {
    log.warn('SECURITY_DM_SESSION_UNAVAILABLE');
    return null;
  }

  try {
    const padded = await ratchetDecrypt(state, encrypted);
    const unpadded = unpad(padded);
    if (provisional) {
      if (!x3dhHeader || !(await commitIncomingSessionSecurityState(senderId, x3dhHeader))) {
        discardRatchetState(state);
        return null;
      }
      sessions.set(senderId, state);
    }
    schedulePersist();
    return new TextDecoder().decode(unpadded);
  } catch {
    if (provisional) discardRatchetState(state);
    log.warn('SECURITY_DM_CIPHERTEXT_REJECTED');
    return null;
  }
}

/**
 * Manually reset the ratchet session with a specific peer.
 * Call this when the user triggers "Reset Secure Session" from the UI.
 * The next message sent to this peer will perform a full X3DH re-exchange.
 */
export function resetSession(peerId: string): void {
  const state = sessions.get(peerId);
  if (state) {
    try {
      if (state.rootKey) state.rootKey.fill(0);
      if (state.sendChainKey) state.sendChainKey.fill(0);
      if (state.recvChainKey) state.recvChainKey.fill(0);
      if (state.sendRatchetKey?.secretKey) state.sendRatchetKey.secretKey.fill(0);
      for (const [, key] of state.skippedKeys) key.fill(0);
      state.skippedKeys.clear();
    } catch { /* silent */ }
  }
  sessions.delete(peerId);
  pendingHeaders.delete(peerId);
  noBundleUsers.delete(peerId);
  failedBundleCache.delete(peerId);
  schedulePersist();
  log.info('Session manually reset for', peerId);
}

/** Wipe all sessions and pre-key secrets — call on lock/logout */
export function wipeSessions() {
  // DARK-017: Properly wipe ratchet state key material before clearing
  for (const [, state] of sessions) {
    try {
      if (state.rootKey) state.rootKey.fill(0);
      if (state.sendChainKey) state.sendChainKey.fill(0);
      if (state.recvChainKey) state.recvChainKey.fill(0);
      if (state.sendRatchetKey?.secretKey) state.sendRatchetKey.secretKey.fill(0);
      for (const [, key] of state.skippedKeys) {
        key.fill(0);
      }
      state.skippedKeys.clear();
    } catch { /* silent */ }
  }
  sessions.clear();
  pendingHeaders.clear();
  failedBundleCache.clear();
  noBundleUsers.clear();
  peerIdentityPins.clear();

  // Clear persisted sessions file
  const auth = useAuthStore.getState();
  if (auth.userId) {
    sessionApi().vaultWrite(sessionStoreFile(auth.userId), '').catch(() => {});
  }

  // Wipe vault-loaded pre-key secrets
  if (spkSecret) { wipe(spkSecret); spkSecret = null; }
  if (spkPublicKey) { spkPublicKey = null; }
  spkKeyId = null;
  for (const [, sec] of opkSecrets) wipe(sec);
  opkSecrets.clear();

  cryptoReady = false;
}

/** Check if we have an active session with a user */
export function hasSession(recipientId: string): boolean {
  return sessions.has(recipientId);
}
