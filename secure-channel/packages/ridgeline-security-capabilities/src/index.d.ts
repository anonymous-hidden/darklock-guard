export interface RidgelineSecurityCapabilities {
  readonly dmE2eeSupported: boolean;
  readonly groupE2eeSupported: boolean;
  readonly groupMessagingSupported: boolean;
  readonly messageEditsSupported: boolean;
  readonly messageDeletesSupported: boolean;
  readonly encryptedSyncSupported: boolean;
  readonly encryptedLocalStorageSupported: boolean;
  readonly encryptedAttachmentsSupported: boolean;
  readonly dmEncryptedAttachmentsSupported: boolean;
  readonly legacyPlaintextDmSupported: boolean;
  readonly totpEnvelopeEncryptionSupported: boolean;
  readonly serverDataEncryptedAtRestSupported: boolean;
  readonly encryptedBackupsSupported: boolean;
  readonly profileMediaEncryptedAtRestSupported: boolean;
  readonly integrationCredentialsProtected: boolean;
  readonly privateBetaSecureStorageMode: boolean;
}

export declare const RIDGELINE_SECURITY_CAPABILITIES: Readonly<RidgelineSecurityCapabilities>;
export declare const GROUP_MESSAGING_CONTAINMENT_NOTICE: string;
export declare const LEGACY_PLAINTEXT_DM_REMOVAL: Readonly<{
  version: string;
  deadline: string;
}>;
