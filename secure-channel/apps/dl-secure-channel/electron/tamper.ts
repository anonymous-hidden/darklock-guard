import fs from 'fs';
import { createHash } from 'crypto';

const DANGEROUS_ARG_PREFIXES = [
  '--inspect',
  '--inspect-brk',
  '--remote-debugging-port',
  '--disable-web-security',
  '--allow-running-insecure-content',
  '--ignore-certificate-errors',
  '--ignore-certificate-errors-spki-list',
];

const DANGEROUS_NODE_OPTION_PREFIXES = [
  '--inspect',
  '--inspect-brk',
  '--require',
  '--loader',
];

export interface Phase1TamperContext {
  isDev: boolean;
  argv: string[];
  env: NodeJS.ProcessEnv;
  preloadPath: string;
  expectedPreloadSha256?: string;
}

export function sha256FileHex(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function includesDangerousPrefix(value: string, prefixes: string[]): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

export function collectPhase1TamperViolations(context: Phase1TamperContext): string[] {
  const violations: string[] = [];
  const preloadPath = String(context.preloadPath || '').trim();

  if (!preloadPath || !fs.existsSync(preloadPath)) {
    violations.push('preload_missing');
  }

  const expectedHash = String(context.expectedPreloadSha256 || '').trim().toLowerCase();
  if (expectedHash) {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
      violations.push('invalid_expected_preload_hash');
    } else if (!preloadPath || !fs.existsSync(preloadPath)) {
      violations.push('preload_hash_unverifiable');
    } else {
      const actualHash = sha256FileHex(preloadPath).toLowerCase();
      if (actualHash !== expectedHash) {
        violations.push('preload_hash_mismatch');
      }
    }
  }

  if (String(context.env.DL_DISABLE_SECURITY_GUARDS || '') === '1') {
    violations.push('security_guards_disabled');
  }

  if (!context.isDev) {
    if (String(context.env.ELECTRON_RUN_AS_NODE || '') === '1') {
      violations.push('electron_run_as_node');
    }

    for (const arg of context.argv ?? []) {
      if (includesDangerousPrefix(arg, DANGEROUS_ARG_PREFIXES)) {
        violations.push(`dangerous_argv_flag:${arg}`);
      }
    }

    const nodeOptions = String(context.env.NODE_OPTIONS || '').trim();
    if (nodeOptions) {
      const nodeOptionParts = nodeOptions.split(/\s+/).filter(Boolean);
      for (const part of nodeOptionParts) {
        if (includesDangerousPrefix(part, DANGEROUS_NODE_OPTION_PREFIXES)) {
          violations.push(`dangerous_node_option:${part}`);
        }
      }
    }
  }

  return violations;
}
