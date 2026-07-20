import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { collectPhase1TamperViolations, sha256FileHex } from './tamper';

function withTempPreloadFile(contents: string, run: (filePath: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dl-electron-tamper-test-'));
  const filePath = path.join(dir, 'preload.js');
  writeFileSync(filePath, contents, 'utf8');
  try {
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('phase-1 tamper checks', () => {
  it('flags dangerous production runtime arguments', () => {
    withTempPreloadFile('// preload', (preloadPath) => {
      const violations = collectPhase1TamperViolations({
        isDev: false,
        argv: ['electron', '--inspect=9229'],
        env: {},
        preloadPath,
      });

      expect(violations.some((v) => v.startsWith('dangerous_argv_flag:--inspect'))).toBe(true);
    });
  });

  it('flags preload hash mismatch when expected hash is configured', () => {
    withTempPreloadFile('console.log("secure preload");', (preloadPath) => {
      const wrongHash = 'a'.repeat(64);
      const actualHash = sha256FileHex(preloadPath);
      expect(actualHash).not.toBe(wrongHash);

      const violations = collectPhase1TamperViolations({
        isDev: false,
        argv: ['electron'],
        env: {},
        preloadPath,
        expectedPreloadSha256: wrongHash,
      });

      expect(violations).toContain('preload_hash_mismatch');
    });
  });

  it('does not block common debugger flags in dev mode', () => {
    withTempPreloadFile('// preload', (preloadPath) => {
      const violations = collectPhase1TamperViolations({
        isDev: true,
        argv: ['electron', '--inspect=9229'],
        env: { NODE_OPTIONS: '--inspect' },
        preloadPath,
      });

      expect(violations.some((v) => v.startsWith('dangerous_argv_flag:'))).toBe(false);
      expect(violations.some((v) => v.startsWith('dangerous_node_option:'))).toBe(false);
    });
  });
});
