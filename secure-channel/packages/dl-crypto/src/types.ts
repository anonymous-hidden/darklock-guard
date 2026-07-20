/* ──────────────────────────────────────────────────────────
 *  Darklock Secure Channel — Type definitions
 * ────────────────────────────────────────────────────────── */

export type Bytes = Uint8Array;
export type Base64 = string;
export type Hex = string;

/* ── KDF ─────────────────────────────────────────────────── */

export interface KdfParams {
  algorithm: 'argon2id';
  memoryBytes: number;
  iterations: number;
  parallelism: number;
  salt: Base64;
  keyLength: number;
}

export const DEFAULT_KDF_PARAMS: Omit<KdfParams, 'salt'> = {
  algorithm: 'argon2id',
  memoryBytes: 256 * 1024 * 1024, // 256 MiB — aggressive
  iterations: 3,
  parallelism: 1,
  keyLength: 64,
};

/* ── AEAD Envelope ───────────────────────────────────────── */

export interface Envelope {
  v: 1;
  alg: 'xchacha20-poly1305';
  nonce: Base64;
  ct: Base64;
  ad?: Base64;
}

/* ── Identity Keys ───────────────────────────────────────── */

export interface IdentityKeyPair {
  publicKey: Bytes;   // Ed25519 public (32 bytes)
  secretKey: Bytes;   // Ed25519 secret (64 bytes)
}

export interface X25519KeyPair {
  publicKey: Bytes;   // X25519 public (32 bytes)
  secretKey: Bytes;   // X25519 secret (32 bytes)
}

/* ── Pre-Key Bundle (uploaded to IDS) ────────────────────── */

export interface SignedPreKey {
  keyId: number;
  publicKey: Base64;
  signature: Base64;  // Ed25519 sig over publicKey
  createdAt: number;
}

export interface OneTimePreKey {
  keyId: number;
  publicKey: Base64;
}

export interface PreKeyBundle {
  identityKey: Base64;        // Ed25519 public
  signedPreKey: SignedPreKey;
  oneTimePreKeys: OneTimePreKey[];
}

/* ── X3DH Session ────────────────────────────────────────── */

export interface X3DHHeader {
  identityKey: Base64;        // Sender's IK (Ed25519 → X25519)
  ephemeralKey: Base64;       // Sender's ephemeral X25519 pub
  usedOneTimeKeyId?: number;  // Which OPK was consumed
  signedPreKeyId: number;
}

/* ── Double Ratchet ──────────────────────────────────────── */

export interface RatchetState {
  rootKey: Bytes;
  sendChainKey: Bytes | null;
  recvChainKey: Bytes | null;
  sendRatchetKey: X25519KeyPair | null;
  recvRatchetPub: Bytes | null;
  sendMessageNum: number;
  recvMessageNum: number;
  prevSendCount: number;
  skippedKeys: Map<string, Bytes>; // "pubHex:msgNum" → message key
}

export interface MessageHeader {
  ratchetPub: Base64;         // Sender's current ratchet public key
  messageNum: number;
  prevChainLen: number;
}

export interface EncryptedMessage {
  header: MessageHeader;
  envelope: Envelope;
}

/* ── Experimental Sender Keys types (not deployed) ───────── */

export interface SenderKeyState {
  chainKey: Bytes;
  iteration: number;
  signingKey: IdentityKeyPair;
}

export interface SenderKeyDistribution {
  senderId: string;
  chainKey: Base64;
  iteration: number;
  signingPub: Base64;
}

export interface GroupMessage {
  senderId: string;
  iteration: number;
  envelope: Envelope;
  signature: Base64;
}

/* ── Vault ───────────────────────────────────────────────── */

export interface VaultData {
  version: 1;
  kdfParams: KdfParams;
  identityKey: Envelope;      // Encrypted IdentityKeyPair
  signedPreKey: Envelope;     // Encrypted current SPK
  sessions: Record<string, Envelope>; // peerId → encrypted RatchetState
  senderKeys: Record<string, Envelope>; // groupId → encrypted SenderKeyState
  contacts: Envelope;         // Encrypted contact list
  messages: Envelope;         // Encrypted message index
}

/* ── Wire protocol ───────────────────────────────────────── */

export interface WireMessage {
  type: 'dm' | 'group' | 'prekey' | 'receipt' | 'typing' | 'key-request';
  from: string;
  to: string;
  timestamp: number;
  payload: Base64;            // Encrypted inner content
  envelope: Envelope;         // Layer-2 session encryption
}

/* ── Contact ─────────────────────────────────────────────── */

export type TrustLevel = 'unverified' | 'verified' | 'trusted';

export interface Contact {
  id: string;
  displayName: string;
  identityKey: Base64;
  trustLevel: TrustLevel;
  addedAt: number;
  lastSeen?: number;
  verified?: boolean;
  safetyNumber?: string;
}

/* ── Conversation ────────────────────────────────────────── */

export interface Conversation {
  id: string;
  type: 'dm' | 'group';
  name?: string;
  members: string[];
  createdAt: number;
  lastMessageAt?: number;
  unreadCount: number;
  disappearingTimer?: number; // ms, 0 = off
  muted?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: number;
  editedAt?: number;
  replyTo?: string;
  attachments?: Attachment[];
  reactions?: Record<string, string[]>; // emoji → userIds
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  disappearAt?: number;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  encryptedUrl: string;
  key: Base64;                // Per-attachment encryption key
  nonce: Base64;
}

/* ── Group ────────────────────────────────────────────────── */

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  userId: string;
  role: GroupRole;
  roleIds: string[];          // assigned role ids
  joinedAt: number;
  nickname?: string;
  banned?: boolean;
}

export interface GroupModerationSettings {
  enabled: boolean;
  blockedTerms: string[];
  mode: 'warn' | 'block' | 'mask';
  notifyMembers: boolean;
  exemptRoleIds: string[];
  updatedAt?: number;
  updatedBy?: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  members: GroupMember[];
  channels: GroupChannel[];
  categories: GroupCategory[];
  roles: GroupRoleInfo[];
  auditLog: AuditLogEntry[];
  createdAt: number;
  createdBy: string;
  retention?: number;         // ms, 0 = forever
  moderation?: GroupModerationSettings;
}

export type GroupChannelType = 'text' | 'voice' | 'announcement' | 'stage' | 'forum';

export interface GroupChannel {
  id: string;
  name: string;
  type: GroupChannelType;
  categoryId: string | null;
  position: number;
  isNsfw?: boolean;
  userLimit?: number;         // voice channels
}

export interface GroupCategory {
  id: string;
  name: string;
  position: number;
  collapsed?: boolean;
}

/* ── Permissions & Roles ─────────────────────────────────── */

export interface GroupPermissions {
  administrator:     boolean;
  manageChannels:    boolean;
  manageRoles:       boolean;
  manageServer:      boolean;
  kickMembers:       boolean;
  banMembers:        boolean;
  manageMessages:    boolean;
  sendMessages:      boolean;
  readMessages:      boolean;
  attachFiles:       boolean;
  useVoice:          boolean;
  mentionEveryone:   boolean;
  viewAuditLog:      boolean;
  manageInvites:     boolean;
}

export const DEFAULT_PERMISSIONS: GroupPermissions = {
  administrator:     false,
  manageChannels:    false,
  manageRoles:       false,
  manageServer:      false,
  kickMembers:       false,
  banMembers:        false,
  manageMessages:    false,
  sendMessages:      true,
  readMessages:      true,
  attachFiles:       true,
  useVoice:          true,
  mentionEveryone:   false,
  viewAuditLog:      false,
  manageInvites:     false,
};

export interface GroupRoleInfo {
  id: string;
  name: string;
  color: string;
  position: number;           // higher = more priority
  permissions: GroupPermissions;
  isDefault?: boolean;        // @everyone role
}

/* ── Audit Log ───────────────────────────────────────────── */

export type AuditAction =
  | 'channel_create' | 'channel_update' | 'channel_delete'
  | 'category_create' | 'category_delete'
  | 'role_create' | 'role_update' | 'role_delete'
  | 'member_kick' | 'member_ban' | 'member_role_update' | 'member_join'
  | 'server_update' | 'message_delete' | 'invite_create';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  userId: string;             // who performed it
  targetId?: string;          // affected entity id
  targetName?: string;        // display name of target
  detail?: string;            // human-readable detail
  timestamp: number;
}
