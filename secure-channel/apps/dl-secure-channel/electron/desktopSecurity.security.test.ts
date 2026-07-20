import { describe, expect, it } from 'vitest';
import {
  MAX_VAULT_FILE_BYTES,
  isApprovedExternalUrl,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  isValidVaultFilename,
  validateIpcArguments,
} from './desktopSecurity';

describe('desktop security boundary', () => {
  it('rejects unapproved external schemes and hosts', () => {
    expect(isApprovedExternalUrl('https://docs.darklock.net/security')).toBe(true);
    expect(isApprovedExternalUrl('https://open.spotify.com/track/example')).toBe(true);
    expect(isApprovedExternalUrl('http://docs.darklock.net/security')).toBe(false);
    expect(isApprovedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isApprovedExternalUrl('data:text/html,hello')).toBe(false);
    expect(isApprovedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isApprovedExternalUrl('https://docs.darklock.net.evil.example/security')).toBe(false);
    expect(isApprovedExternalUrl('https://user:password@docs.darklock.net/security')).toBe(false);
    expect(isApprovedExternalUrl('https://example.com/')).toBe(false);
  });

  it('accepts only the main renderer origins for each mode', () => {
    expect(isTrustedRendererUrl('http://localhost:1421/settings', true)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:1421/settings', true)).toBe(true);
    expect(isTrustedRendererUrl('https://localhost:1421/settings', true)).toBe(false);
    expect(isTrustedRendererUrl('file:///C:/Ridgeline/resources/app.asar/dist/index.html', false)).toBe(true);
    expect(isTrustedRendererUrl('file:///C:/Ridgeline/resources/app.asar/evil.html', false)).toBe(false);
    expect(isTrustedRendererUrl('https://darklock.net/index.html', false)).toBe(false);
  });

  it('rejects IPC from a non-main renderer even at a trusted URL', () => {
    expect(isTrustedIpcSender(7, 7, 'http://localhost:1421/settings', true)).toBe(true);
    expect(isTrustedIpcSender(8, 7, 'http://localhost:1421/settings', true)).toBe(false);
    expect(isTrustedIpcSender(7, 7, 'https://evil.example/settings', true)).toBe(false);
    expect(isTrustedIpcSender(7, null, 'http://localhost:1421/settings', true)).toBe(false);
  });

  it('rejects unknown IPC channels and malformed arguments', () => {
    expect(validateIpcArguments('win:minimize', [])).toBe(true);
    expect(validateIpcArguments('win:minimize', ['unexpected'])).toBe(false);
    expect(validateIpcArguments('unknown:channel', [])).toBe(false);
    expect(validateIpcArguments('security:clipboardClear', [30])).toBe(true);
    expect(validateIpcArguments('security:clipboardClear', [-1])).toBe(false);
    expect(validateIpcArguments('security:setContentProtection', ['true'])).toBe(false);
  });

  it('limits vault operations to known encrypted files and bounded values', () => {
    expect(isValidVaultFilename('user-123.vault.json')).toBe(true);
    expect(isValidVaultFilename('user-123.sessions.v2.json')).toBe(true);
    expect(isValidVaultFilename('../secret.vault.json')).toBe(false);
    expect(isValidVaultFilename('arbitrary.json')).toBe(false);
    expect(validateIpcArguments('vault:write', ['user-123.vault.json', 'ciphertext'])).toBe(true);
    expect(validateIpcArguments('vault:write', [
      'user-123.vault.json',
      'x'.repeat(MAX_VAULT_FILE_BYTES + 1),
    ])).toBe(false);
  });
});
