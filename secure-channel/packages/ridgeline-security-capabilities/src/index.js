/**
 * Security claims exposed by the currently deployed Ridgeline protocol.
 * These values are intentionally conservative and are enforced independently
 * by backend services where they affect behavior.
 */
export const RIDGELINE_SECURITY_CAPABILITIES = Object.freeze({
  dmE2eeSupported: true,
  groupE2eeSupported: false,
  groupMessagingSupported: false,
  messageEditsSupported: false,
  messageDeletesSupported: false,
  encryptedSyncSupported: false,
  encryptedLocalStorageSupported: false,
  encryptedAttachmentsSupported: false,
  dmEncryptedAttachmentsSupported: true,
  legacyPlaintextDmSupported: false,
  totpEnvelopeEncryptionSupported: false,
  serverDataEncryptedAtRestSupported: false,
  encryptedBackupsSupported: false,
  profileMediaEncryptedAtRestSupported: false,
  integrationCredentialsProtected: false,
  privateBetaSecureStorageMode: false,
});

export const GROUP_MESSAGING_CONTAINMENT_NOTICE =
  'Group messaging is temporarily unavailable while Ridgeline completes group encryption.';

export const LEGACY_PLAINTEXT_DM_REMOVAL = Object.freeze({
  version: '2.2.0',
  deadline: '2026-09-01',
});
