/* ──────────────────────────────────────────────────────────
 *  Vault — Encrypted local key storage
 *
 *  Stores identity keys, signed pre-key secrets, and one-time
 *  pre-key secrets in the user's Electron userData directory.
 *  All data is encrypted with the user's Argon2id-derived
 *  encryption key using XChaCha20-Poly1305 (AEAD).
 *
 *  Vault files:
 *    {userId}.vault.json     — AEAD-encrypted key material
 *    {userId}.kdf.json       — KDF params (salt, etc.) — NOT secret
 *    {userId}.recovery.json  — AEAD-encrypted identity backup (MED-1)
 * ────────────────────────────────────────────────────────── */

import {
  encrypt, decrypt, toBase64, fromBase64,
  type Bytes, type Envelope, type KdfParams,
} from '@darklock/channel-crypto';
import type { PeerIdentityTrustRecord } from './identityTrust.js';

// ── Electron IPC bridge ──────────────────────────────────

// Fallback for web/PWA when pwaAdapter hasn't injected window.electronAPI yet,
// or when running without the adapter (e.g. stale service worker cache).
const _VAULT_PREFIX = 'darklock_vault_';
const _webVaultFallback = {
  vaultWrite: async (f: string, d: string) => { localStorage.setItem(_VAULT_PREFIX + f, d); },
  vaultRead:  async (f: string) => localStorage.getItem(_VAULT_PREFIX + f),
  vaultExists: async (f: string) => localStorage.getItem(_VAULT_PREFIX + f) !== null,
  vaultDelete: async (f: string) => { localStorage.removeItem(_VAULT_PREFIX + f); },
};

function api(): {
  vaultWrite: (f: string, d: string) => Promise<void>;
  vaultRead: (f: string) => Promise<string | null>;
  vaultExists: (f: string) => Promise<boolean>;
  vaultDelete: (f: string) => Promise<void>;
} {
  return (window as any).electronAPI ?? _webVaultFallback;
}

// ── Vault data shape ─────────────────────────────────────

export interface VaultKeyMaterial {
  identityKeyPair: { publicKey: string; secretKey: string }; // base64
  signedPreKey: {
    keyId: number;
    publicKey: string;   // base64
    secretKey: string;   // base64
    signature: string;   // base64
  };
  oneTimePreKeys: Array<{
    keyId: number;
    publicKey: string;   // base64
    secretKey: string;   // base64
  }>;
  peerIdentityPins?: Record<string, PeerIdentityTrustRecord>;
  onboarding?: OnboardingCompletionRecord;
}

export interface OnboardingCompletionRecord {
  schemaVersion: 1;
  completed: true;
  completedAt: string;
  appVersion: string;
  completedSteps: string[];
}

// ── Core operations ──────────────────────────────────────

/**
 * Encrypt and persist key material to the local vault.
 */
export async function saveVault(
  userId: string,
  keys: VaultKeyMaterial,
  encryptionKey: Bytes,
): Promise<void> {
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const envelope = await encrypt(plaintext, encryptionKey);
  await api().vaultWrite(`${userId}.vault.json`, JSON.stringify(envelope));
}

/**
 * Load and decrypt key material from the local vault.
 */
export async function loadVault(
  userId: string,
  encryptionKey: Bytes,
): Promise<VaultKeyMaterial | null> {
  const raw = await api().vaultRead(`${userId}.vault.json`);
  if (!raw) return null;
  try {
    const envelope: Envelope = JSON.parse(raw);
    const plaintext = await decrypt(envelope, encryptionKey);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as VaultKeyMaterial;
    if (!parsed.peerIdentityPins || typeof parsed.peerIdentityPins !== 'object') {
      parsed.peerIdentityPins = {};
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if a vault exists for a given user.
 */
export async function vaultExists(userId: string): Promise<boolean> {
  return api().vaultExists(`${userId}.vault.json`);
}

/**
 * Remove local vault artifacts for a user.
 * Intended for recovery flows when local data is stale/corrupted.
 */
export async function clearLocalVaultArtifacts(userId: string): Promise<void> {
  const files = [
    `${userId}.vault.json`,
    `${userId}.kdf.json`,
    `${userId}.recovery.json`,
    `${userId}.sessions.json`,
    `${userId}.sessions.v2.json`,
  ];
  for (const file of files) {
    try {
      await api().vaultDelete(file);
    } catch {
      // Best-effort cleanup; missing files are fine.
    }
  }
}

/**
 * Update the vault (e.g. after consuming a one-time pre-key).
 * Reads, modifies, re-encrypts, and writes back.
 */
export async function updateVault(
  userId: string,
  encryptionKey: Bytes,
  updater: (keys: VaultKeyMaterial) => VaultKeyMaterial,
): Promise<void> {
  const current = await loadVault(userId, encryptionKey);
  if (!current) throw new Error('vault_not_found');
  const updated = updater(current);
  await saveVault(userId, updated, encryptionKey);
}

export async function saveOnboardingCompletion(
  userId: string,
  encryptionKey: Bytes,
  record: OnboardingCompletionRecord,
): Promise<void> {
  await updateVault(userId, encryptionKey, (keys) => ({ ...keys, onboarding: record }));
}

// ── KDF params persistence (not secret — stored in cleartext) ──

export async function saveKdfParams(userId: string, params: KdfParams): Promise<void> {
  await api().vaultWrite(`${userId}.kdf.json`, JSON.stringify(params));
}

export async function loadKdfParams(userId: string): Promise<KdfParams | null> {
  const raw = await api().vaultRead(`${userId}.kdf.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Recovery phrase backup (MED-1) ───────────────────────

/**
 * Encrypt and store identity key pair using a recovery-derived key.
 * The recoveryKey is derived from the mnemonic phrase via Argon2id
 * with a DIFFERENT salt than the login KDF.
 */
export async function saveRecoveryBackup(
  userId: string,
  identityKeyPair: { publicKey: Bytes; secretKey: Bytes },
  recoveryKey: Bytes,
): Promise<void> {
  const payload = JSON.stringify({
    publicKey: toBase64(identityKeyPair.publicKey),
    secretKey: toBase64(identityKeyPair.secretKey),
  });
  const plaintext = new TextEncoder().encode(payload);
  const envelope = await encrypt(plaintext, recoveryKey);
  await api().vaultWrite(`${userId}.recovery.json`, JSON.stringify(envelope));
}

/**
 * Decrypt and restore identity key pair from recovery backup.
 */
export async function loadRecoveryBackup(
  userId: string,
  recoveryKey: Bytes,
): Promise<{ publicKey: Bytes; secretKey: Bytes } | null> {
  const raw = await api().vaultRead(`${userId}.recovery.json`);
  if (!raw) return null;
  try {
    const envelope: Envelope = JSON.parse(raw);
    const plaintext = await decrypt(envelope, recoveryKey);
    const data = JSON.parse(new TextDecoder().decode(plaintext));
    return {
      publicKey: fromBase64(data.publicKey),
      secretKey: fromBase64(data.secretKey),
    };
  } catch {
    return null;
  }
}

export async function recoveryBackupExists(userId: string): Promise<boolean> {
  return api().vaultExists(`${userId}.recovery.json`);
}
