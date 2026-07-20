import { createHash, X509Certificate } from 'crypto';

export const CERT_VERIFY_OK = 0;
export const CERT_VERIFY_FAIL = -3;

export interface SpkiPinningConfig {
  enabled: boolean;
  enforce: boolean;
  hostPins: Map<string, Set<string>>;
  allowInDev: boolean;
}

export interface CertificateLike {
  data?: string;
  raw?: Buffer;
}

export interface CertificateVerifyRequestLike {
  hostname: string;
  verificationResult?: string;
  certificate?: CertificateLike | null;
}

export interface CertificateVerifyResult {
  decision: number;
  reason: string;
}

export interface CertificateVerifySessionLike {
  setCertificateVerifyProc(
    handler: (request: CertificateVerifyRequestLike, callback: (verificationResult: number) => void) => void,
  ): void;
}

function normalizePin(value: string): string {
  return String(value || '').trim();
}

function toHostname(host: string): string {
  return String(host || '').trim().toLowerCase();
}

function insertPin(target: Map<string, Set<string>>, host: string, pin: string) {
  const normalizedHost = toHostname(host);
  const normalizedPin = normalizePin(pin);
  if (!normalizedHost || !normalizedPin) return;
  if (!normalizedPin.startsWith('sha256/')) return;

  let hostSet = target.get(normalizedHost);
  if (!hostSet) {
    hostSet = new Set();
    target.set(normalizedHost, hostSet);
  }
  hostSet.add(normalizedPin);
}

export function parseSpkiPins(raw: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const entries = String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) continue;

    const host = entry.slice(0, separatorIndex).trim();
    const pins = entry.slice(separatorIndex + 1).split('|');
    for (const pin of pins) {
      insertPin(map, host, pin);
    }
  }

  return map;
}

export function parseSpkiPinsJson(rawJson: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!rawJson || !rawJson.trim()) return map;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return map;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return map;
  }

  for (const [host, pins] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof pins === 'string') {
      insertPin(map, host, pins);
      continue;
    }
    if (!Array.isArray(pins)) continue;

    for (const pin of pins) {
      if (typeof pin === 'string') {
        insertPin(map, host, pin);
      }
    }
  }

  return map;
}

export function mergeSpkiPinMaps(...maps: Array<Map<string, Set<string>>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();

  for (const map of maps) {
    for (const [host, pins] of map.entries()) {
      for (const pin of pins.values()) {
        insertPin(out, host, pin);
      }
    }
  }

  return out;
}

export function loadSpkiPinningConfig(
  env: NodeJS.ProcessEnv,
  isDev: boolean,
): SpkiPinningConfig {
  const fromInline = parseSpkiPins(String(env.DL_SPKI_PINS || ''));
  const fromJson = parseSpkiPinsJson(String(env.DL_SPKI_PINS_JSON || ''));
  const hostPins = mergeSpkiPinMaps(fromInline, fromJson);

  const allowInDev = String(env.DL_SPKI_ALLOW_IN_DEV || '') === '1';
  const enforce = String(env.DL_SPKI_ENFORCE || '') === '1';
  const enabled = hostPins.size > 0 && (!isDev || allowInDev);

  return {
    enabled,
    enforce,
    hostPins,
    allowInDev,
  };
}

export function extractSpkiPinFromCertificate(certificate?: CertificateLike | null): string | null {
  if (!certificate) return null;

  try {
    const source = typeof certificate.data === 'string' && certificate.data.trim().length > 0
      ? certificate.data
      : certificate.raw;
    if (!source) return null;

    const x509 = new X509Certificate(source);
    const spkiDer = x509.publicKey.export({ type: 'spki', format: 'der' });
    const hash = createHash('sha256').update(spkiDer).digest('base64');
    return `sha256/${hash}`;
  } catch {
    return null;
  }
}

export function evaluateSpkiPinningDecision(
  request: CertificateVerifyRequestLike,
  config: SpkiPinningConfig,
  options: {
    extractPin?: (certificate?: CertificateLike | null) => string | null;
  } = {},
): CertificateVerifyResult {
  if (!config.enabled) {
    return { decision: CERT_VERIFY_OK, reason: 'pinning_disabled' };
  }

  const host = toHostname(request.hostname);
  if (!host) {
    return {
      decision: config.enforce ? CERT_VERIFY_FAIL : CERT_VERIFY_OK,
      reason: 'missing_hostname',
    };
  }

  const pins = config.hostPins.get(host);
  if (!pins || pins.size === 0) {
    return { decision: CERT_VERIFY_OK, reason: 'host_not_pinned' };
  }

  if (request.verificationResult && request.verificationResult !== 'net::OK') {
    return {
      decision: config.enforce ? CERT_VERIFY_FAIL : CERT_VERIFY_OK,
      reason: 'tls_verification_failed',
    };
  }

  const extractPin = options.extractPin ?? extractSpkiPinFromCertificate;
  const observedPin = extractPin(request.certificate);
  if (!observedPin) {
    return {
      decision: config.enforce ? CERT_VERIFY_FAIL : CERT_VERIFY_OK,
      reason: 'missing_observed_pin',
    };
  }

  if (pins.has(observedPin)) {
    return { decision: CERT_VERIFY_OK, reason: 'pin_match' };
  }

  return {
    decision: config.enforce ? CERT_VERIFY_FAIL : CERT_VERIFY_OK,
    reason: 'pin_mismatch',
  };
}

export function installSpkiPinning(
  session: CertificateVerifySessionLike,
  config: SpkiPinningConfig,
): boolean {
  if (!config.enabled) {
    return false;
  }

  session.setCertificateVerifyProc((request, callback) => {
    const result = evaluateSpkiPinningDecision(request, config);
    callback(result.decision);
  });

  return true;
}
