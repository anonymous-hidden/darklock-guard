import { createHash } from 'node:crypto';
import path from 'node:path';

export const CHANNELS = new Set(['stable', 'beta']);
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const SHA512 = /^[A-Za-z0-9+/]{86}==$/;
export const SHA256 = /^[a-f0-9]{64}$/i;

export function canonicalJson(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('policy contains an unsupported value');
}

export function sha256File(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha512File(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

export function safeSegment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(value)
    && path.basename(value) === value && value !== '.' && value !== '..';
}
