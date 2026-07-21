export const RIDGELINE_UPDATE_APP_ID = 'com.darklock.ridgeline';

export const RIDGELINE_UPDATE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // The Pi release hub holds the matching private key outside the source tree.
  'ridgeline-pi-release-2026-07': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgAI/bek6VlgwYLeUm6EQOD+bnIMH4ItRXMqemE7fuCo=
-----END PUBLIC KEY-----`,
  'ridgeline-release-2026-01': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABNhQOJDHMZmqlvrIRSujvKAH+qyc91NrTcDEPJCD4b0=
-----END PUBLIC KEY-----`,
  'ridgeline-recovery-2026-01': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAL2IXfUnUfzEsWXf7rFhm4zqNxV5Ot+C5c9ozkvgCcSA=
-----END PUBLIC KEY-----`,
});

export const RIDGELINE_RECOVERY_KEY_IDS = Object.freeze([
  'ridgeline-recovery-2026-01',
]);

// Keep revoked IDs embedded so old signed metadata cannot reactivate a retired key.
export const RIDGELINE_REVOKED_KEY_IDS = Object.freeze<string[]>([]);

export const APPROVED_UPDATE_HOSTS = Object.freeze([
  'releases.darklock.net',
  'github.com',
  'objects.githubusercontent.com',
]);
