import { describe, expect, it } from 'vitest';
import {
  CERT_VERIFY_FAIL,
  CERT_VERIFY_OK,
  evaluateSpkiPinningDecision,
  loadSpkiPinningConfig,
  parseSpkiPins,
} from './spkiPinning';

describe('SPKI pinning scaffolding', () => {
  it('parses inline host pin definitions', () => {
    const pins = parseSpkiPins(
      'ids.darklock.net=sha256/aaa|sha256/bbb,rly.darklock.net=sha256/ccc',
    );

    expect(pins.get('ids.darklock.net')?.has('sha256/aaa')).toBe(true);
    expect(pins.get('ids.darklock.net')?.has('sha256/bbb')).toBe(true);
    expect(pins.get('rly.darklock.net')?.has('sha256/ccc')).toBe(true);
  });

  it('fails closed on pinned host mismatch when enforce mode is enabled', () => {
    const config = loadSpkiPinningConfig({
      DL_SPKI_PINS: 'ids.darklock.net=sha256/goodpin',
      DL_SPKI_ENFORCE: '1',
    }, false);

    const result = evaluateSpkiPinningDecision(
      {
        hostname: 'ids.darklock.net',
        verificationResult: 'net::OK',
        certificate: { data: 'unused-in-test' },
      },
      config,
      { extractPin: () => 'sha256/badpin' },
    );

    expect(result.decision).toBe(CERT_VERIFY_FAIL);
    expect(result.reason).toBe('pin_mismatch');
  });

  it('allows pinned host mismatch in report-only mode', () => {
    const config = loadSpkiPinningConfig({
      DL_SPKI_PINS: 'ids.darklock.net=sha256/goodpin',
      DL_SPKI_ENFORCE: '0',
    }, false);

    const result = evaluateSpkiPinningDecision(
      {
        hostname: 'ids.darklock.net',
        verificationResult: 'net::OK',
        certificate: { data: 'unused-in-test' },
      },
      config,
      { extractPin: () => 'sha256/badpin' },
    );

    expect(result.decision).toBe(CERT_VERIFY_OK);
    expect(result.reason).toBe('pin_mismatch');
  });

  it('does not enable pinning in dev unless explicitly allowed', () => {
    const devConfig = loadSpkiPinningConfig({
      DL_SPKI_PINS: 'ids.darklock.net=sha256/goodpin',
      DL_SPKI_ENFORCE: '1',
    }, true);

    expect(devConfig.enabled).toBe(false);

    const devAllowedConfig = loadSpkiPinningConfig({
      DL_SPKI_PINS: 'ids.darklock.net=sha256/goodpin',
      DL_SPKI_ENFORCE: '1',
      DL_SPKI_ALLOW_IN_DEV: '1',
    }, true);

    expect(devAllowedConfig.enabled).toBe(true);
  });
});
