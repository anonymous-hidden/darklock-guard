const APPROVED_EXTERNAL_HOSTS = new Set([
  'accounts.google.com',
  'accounts.spotify.com',
  'darklock.io',
  'darklock.net',
  'discord.com',
  'docs.darklock.net',
  'open.spotify.com',
  'support.darklock.net',
]);

const VAULT_FILENAME_PATTERN = /^[A-Za-z0-9_-]{1,96}\.(?:vault|kdf|recovery|recovery-kdf|sessions\.v2)\.json$/;
export const MAX_VAULT_FILE_BYTES = 4 * 1024 * 1024;

type IpcArgsValidator = (args: readonly unknown[]) => boolean;

const noArgs: IpcArgsValidator = (args) => args.length === 0;
const oneBoolean: IpcArgsValidator = (args) => args.length === 1 && typeof args[0] === 'boolean';
const oneVersion: IpcArgsValidator = (args) => (
  args.length === 1
  && typeof args[0] === 'string'
  && args[0].length > 0
  && args[0].length <= 64
);

const IPC_ARGUMENT_SCHEMAS: Readonly<Record<string, IpcArgsValidator>> = Object.freeze({
  'app:getVersion': noArgs,
  'app:showNotification': (args) => (
    args.length === 2
    && typeof args[0] === 'string'
    && args[0].length <= 256
    && typeof args[1] === 'string'
    && args[1].length <= 2_000
  ),
  'app:checkForUpdates': noArgs,
  'auth:discordSignIn': noArgs,
  'auth:googleSignIn': noArgs,
  'security:setContentProtection': oneBoolean,
  'security:setSkipTaskbar': oneBoolean,
  'security:setSpellCheckerEnabled': oneBoolean,
  'security:setIncognitoKeyboard': oneBoolean,
  'security:clipboardClear': (args) => (
    args.length === 1
    && Number.isInteger(args[0])
    && Number(args[0]) >= 0
    && Number(args[0]) <= 3_600
  ),
  'security:clipboardClearNow': noArgs,
  'spotify:connect': noArgs,
  'spotify:connectionState': noArgs,
  'spotify:reopenAuthorization': noArgs,
  'spotify:cancelConnection': noArgs,
  'spotify:status': noArgs,
  'spotify:setSharing': oneBoolean,
  'spotify:currentActivity': noArgs,
  'spotify:disconnect': noArgs,
  'spotify:openTrack': (args) => args.length === 1 && typeof args[0] === 'string' && args[0].length <= 2_048,
  'updater:getState': noArgs,
  'updater:getHistory': noArgs,
  'updater:getPendingMajorNotes': noArgs,
  'updater:restartAndInstall': noArgs,
  'updater:defer': noArgs,
  'updater:markMajorNotesSeen': oneVersion,
  'updater:recordNotesOpened': oneVersion,
  'updater:setRestartSafety': (args) => {
    if (args.length !== 1 || !isPlainRecord(args[0])) return false;
    const value = args[0];
    return Object.keys(value).length === 3
      && typeof value.activeCall === 'boolean'
      && typeof value.activeTransfer === 'boolean'
      && typeof value.unsavedDraft === 'boolean';
  },
  'vault:write': (args) => (
    args.length === 2
    && isValidVaultFilename(args[0])
    && typeof args[1] === 'string'
    && Buffer.byteLength(args[1], 'utf8') <= MAX_VAULT_FILE_BYTES
  ),
  'vault:read': (args) => args.length === 1 && isValidVaultFilename(args[0]),
  'vault:exists': (args) => args.length === 1 && isValidVaultFilename(args[0]),
  'vault:delete': (args) => args.length === 1 && isValidVaultFilename(args[0]),
  'win:minimize': noArgs,
  'win:maximize': noArgs,
  'win:toggleFullscreen': noArgs,
  'win:close': noArgs,
  'win:isFullscreen': noArgs,
  'win:titlebarMenu': noArgs,
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidVaultFilename(value: unknown): value is string {
  return typeof value === 'string' && VAULT_FILENAME_PATTERN.test(value);
}

export function validateIpcArguments(channel: string, args: readonly unknown[]): boolean {
  const validator = IPC_ARGUMENT_SCHEMAS[channel];
  return typeof validator === 'function' && validator(args);
}

export function isTrustedRendererUrl(value: string, isDev: boolean): boolean {
  try {
    const url = new URL(value);
    if (isDev) {
      return url.protocol === 'http:'
        && ['localhost', '127.0.0.1'].includes(url.hostname)
        && url.port === '1421';
    }

    return url.protocol === 'file:'
      && url.hostname === ''
      && /\/dist\/index\.html$/i.test(url.pathname.replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

export function isTrustedIpcSender(
  senderId: number,
  mainWindowSenderId: number | null,
  senderUrl: string,
  isDev: boolean,
): boolean {
  return mainWindowSenderId !== null
    && senderId === mainWindowSenderId
    && isTrustedRendererUrl(senderUrl, isDev);
}

export function isApprovedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && APPROVED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
