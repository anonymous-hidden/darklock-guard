export type KeyDomain = 'authentication' | 'profile' | 'settings' | 'sync' | 'integrations' | 'media' | 'audit' | 'backup' | 'blindIndex';

export interface EncryptionAad {
  application?: 'ridgeline';
  environment?: 'development' | 'test' | 'staging' | 'production';
  service?: string;
  encryptionDomain?: KeyDomain;
  userId: string;
  collection: string;
  recordId: string;
  fieldName: string;
  schemaVersion?: 1;
}

export interface SecureStorage {
  readonly environment: string;
  readonly service: string;
  readonly keyFingerprint: string;
  encryptBytes(domain: Exclude<KeyDomain, 'blindIndex'>, plaintext: Uint8Array, aad: EncryptionAad): string;
  decryptBytes(domain: Exclude<KeyDomain, 'blindIndex'>, envelope: string, aad: EncryptionAad): Buffer;
  encryptText(domain: Exclude<KeyDomain, 'blindIndex'>, plaintext: string, aad: EncryptionAad): string;
  decryptText(domain: Exclude<KeyDomain, 'blindIndex'>, envelope: string, aad: EncryptionAad): string;
  blindIndex(value: string, context?: string): string;
  isEncryptedRecord(value: unknown): boolean;
  createSecretStreamEncryptor(domain: 'backup' | 'media', aad: EncryptionAad): {
    header: string;
    push(chunk: Uint8Array, final?: boolean): Buffer;
  };
  createSecretStreamDecryptor(domain: 'backup' | 'media', header: string, aad: EncryptionAad): {
    pull(chunk: Uint8Array): { plaintext: Buffer; final: boolean };
  };
  destroy(): void;
}

export const SERVER_MASTER_KEY_BYTES: 32;
export const ENVELOPE_VERSION: 1;
export const ENVELOPE_ALGORITHM: 'xchacha20-poly1305';
export const SECRETSTREAM_ALGORITHM: 'xchacha20-poly1305-secretstream';
export const KEY_DOMAINS: Readonly<Record<KeyDomain, string>>;
export function fingerprintKey(key: Uint8Array): string;
export function loadServerMasterKey(options?: {
  keyPath?: string;
  environment?: string;
  expectedOwnerUid?: number | string | null;
  deniedFingerprints?: string;
  platform?: NodeJS.Platform;
}): Buffer;
export function validatePrivatePath(path: string, options?: {
  expectedOwnerUid?: number | string | null;
  kind?: 'key' | 'directory';
  platform?: NodeJS.Platform;
}): import('node:fs').Stats;
export function createSecureStorage(options: {
  masterKey: Buffer;
  environment: string;
  service: string;
  maxPlaintextBytes?: number;
}): Promise<SecureStorage>;
export function isArgon2idHash(value: unknown): boolean;
export function hashPasswordArgon2id(password: string, options?: { environment?: string }): Promise<string>;
export function verifyPasswordArgon2id(hash: string, password: string): Promise<boolean>;
export function argon2idHashNeedsUpgrade(hash: string, options?: { environment?: string }): Promise<boolean>;
