/* ──────────────────────────────────────────────────────────
 *  logger — tiny scoped logger used across the secure-channel
 *  frontend. Silent in production, pretty-printed in dev.
 *
 *  Usage:
 *    const log = createLogger('sync');
 *    log.info('pulled keys', keys);
 *    log.warn('token missing');
 *    log.error('apply failed', err);
 *
 *  Levels (most verbose → least): debug, info, warn, error
 *  Production threshold: 'error' only (and only via console.error).
 *  Dev threshold: controlled by VITE_LOG_LEVEL or 'info' default.
 * ────────────────────────────────────────────────────────── */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = {
  debug: 10, info: 20, warn: 30, error: 40,
};

const IS_PROD = import.meta.env.PROD;
const THRESHOLD: Level = IS_PROD
  ? 'error'
  : ((import.meta.env.VITE_LOG_LEVEL as Level | undefined) ?? 'info');
const THRESHOLD_RANK = LEVEL_RANK[THRESHOLD];

function shouldLog(lvl: Level): boolean {
  return LEVEL_RANK[lvl] >= THRESHOLD_RANK;
}

export function toSecurityEventCode(scope: string, args: unknown[]): string {
  const raw = typeof args[0] === 'string' ? args[0] : 'event';
  const event = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'EVENT';
  const safeScope = scope.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 32) || 'APP';
  return `[${safeScope}_${event}]`;
}

function write(lvl: Level, scope: string, args: unknown[]): void {
  if (!shouldLog(lvl)) return;
  const eventCode = toSecurityEventCode(scope, args);
  // Use the matching console method so DevTools styling / filtering works.
  // eslint-disable-next-line no-console
  const fn = lvl === 'debug' ? console.debug
           : lvl === 'info'  ? console.info
           : lvl === 'warn'  ? console.warn
           :                    console.error;
  fn(eventCode);
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => write('debug', scope, a),
    info:  (...a) => write('info',  scope, a),
    warn:  (...a) => write('warn',  scope, a),
    error: (...a) => write('error', scope, a),
  };
}

/** Default unscoped logger for one-off callsites. */
export const logger: Logger = createLogger('app');
