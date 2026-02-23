// ── Shared TypeScript types mirroring Rust DTOs ────────────────────────────────

export interface AuthResult {
  user_id: string;
  username: string;
  key_change_detected: boolean;
  system_role?: string | null;
}

export interface ContactDto {
  id: string;
  contact_user_id: string;
  display_name: string | null;
  identity_pubkey: string;
  verified_fingerprint: string | null;
  key_change_pending: boolean;
  fingerprint: string;
  system_role?: string | null;
}

export interface FriendRequestDto {
  /** IDS-assigned request ID — pass to respondFriendRequest / cancelFriendRequest. */
  request_id: string;
  user_id: string;
  username: string;
  identity_pubkey: string;
  fingerprint: string;
  /** "incoming" | "outgoing" | "accepted" */
  direction: string;
  created_at: string;
}

export interface MessageDto {
  id: string;
  session_id: string;
  sender_id: string;
  recipient_id: string;
  sent_at: string;
  delivery_state: string;
  content: MessageContent;
  is_outgoing: boolean;
  chain_link: string;
  ratchet_n: number;
}

export type MessageContent =
  | { type: "text"; body: string }
  | { type: "attachment"; filename: string; mime_type: string; size_bytes: number; content_hash: string; storage_ref: string; attachment_key: string }
  | { type: "group_invite"; group_id: string; group_name: string; invite_token: string }
  | { type: "reaction"; target_message_id: string; emoji: string }
  | { type: "delete"; target_message_id: string }
  | { type: "typing"; typing: boolean }
  | { type: "receipt"; message_id: string; state: DeliveryState };

export type DeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";

export interface GroupDto {
  id: string;
  name: string;
  creator_user_id: string;
  member_count: number;
  created_at: string;
  description: string | null;
}

export interface ProfileDto {
  user_id: string;
  username: string;
  email: string;
  identity_pubkey: string;
  fingerprint: string;
  devices: DeviceDto[];
  created_at: string;
  system_role?: string | null;
}

export interface DeviceDto {
  device_id: string;
  device_name: string;
  platform: string;
  device_pubkey: string;
  enrolled_at: string;
  is_current_device: boolean;
  fingerprint: string;
}

export interface SecurityCheckResult {
  passed: boolean;
  total_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  recommended_mode: "normal" | "privacy" | "high_security";
  signals: RiskSignal[];
  require_reauth: boolean;
}

export interface RiskSignal {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  score: number;
}

export interface UserKeysResponse {
  user_id: string;
  username: string;
  identity_pubkey: string;
  key_version: number;
  prekey_bundle: PrekeyBundleResponse;
}

export interface PrekeyBundleResponse {
  ik_pub: string;
  spk_pub: string;
  spk_sig: string;
  opk_pub: string | null;
}

export interface ContactProfileDto {
  user_id: string;
  username: string;
  profile_bio: string | null;
  pronouns: string | null;
  custom_status: string | null;
  profile_color: string | null;
  avatar: string | null;
  banner: string | null;
}

// ── Server / Role / Channel Types ────────────────────────────────────────────

export interface ServerDto {
  id: string;
  name: string;
  owner_id: string;
  icon: string | null;
  description: string | null;
  banner_color: string | null;
  member_count: number | null;
  created_at: string;
}

export interface ChannelDto {
  id: string;
  server_id: string;
  name: string;
  topic: string | null;
  type: string | null;
  position: number;
  category_id: string | null;
  is_secure: boolean;
  lockdown: boolean;
  created_at: string | null;
}

export interface RoleDto {
  id: string;
  server_id: string;
  name: string;
  color_hex: string;
  position: number;
  permissions: string;
  is_admin: boolean;
  show_tag: boolean;
  hoist: boolean;
  tag_style: string;
  separate_members: boolean;
  badge_image_url: string | null;
  security_level: number;
  member_count: number | null;
  created_at: string | null;
}

export interface MemberRoleInfo {
  id: string;
  name: string;
  color_hex: string;
  position: number;
  is_admin: boolean;
  show_tag: boolean;
  separate_members: boolean;
  badge_image_url: string | null;
}

export interface ServerMemberDto {
  user_id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  banner?: string | null;
  profile_bio?: string | null;
  profile_color: string | null;
  joined_at: string;
  is_owner: boolean;
  roles: MemberRoleInfo[];
  selected_tags?: UserTagDto[];
}

export interface ChannelOverrideDto {
  id: string;
  channel_id: string;
  role_id: string;
  allow_permissions: string;
  deny_permissions: string;
  role_name: string | null;
  color_hex: string | null;
}

export interface ChannelUserOverrideDto {
  id: string;
  channel_id: string;
  user_id: string;
  allow_permissions: string;
  deny_permissions: string;
  username: string | null;
}

export interface SecureChannelAuditDto {
  id: string;
  server_id: string;
  channel_id: string;
  user_id: string;
  actor_username: string | null;
  action: string;
  permission_checked: string | null;
  result: 'allowed' | 'denied';
  metadata_json: string | null;
  ip_address: string | null;
  created_at: string;
}

// ── Security Level Constants ─────────────────────────────────────────────────

export const SecurityLevel = {
  USER: 0,
  TRUSTED: 30,
  MODERATOR: 50,
  SECURITY_ADMIN: 70,
  ADMIN: 80,
  CO_OWNER: 90,
  OWNER: 100,
} as const;

export type SecurityLevelValue = typeof SecurityLevel[keyof typeof SecurityLevel];

export interface AuditLogEntryDto {
  id: string;
  server_id: string;
  actor_id: string;
  actor_username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  changes: Record<string, unknown> | null;
  diff_json: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

// ── Permission Bitfield ──────────────────────────────────────────────────────
// Using regular numbers (12 flags fit safely within Number.MAX_SAFE_INTEGER).
// The backend stores them as BigInt strings but we can parse/compare as numbers.

export const Permissions = {
  VIEW_CHANNEL:     1 << 0,   // 1
  SEND_MESSAGES:    1 << 1,   // 2
  DELETE_MESSAGES:  1 << 2,   // 4
  EDIT_MESSAGES:    1 << 3,   // 8
  MANAGE_CHANNELS:  1 << 4,   // 16
  MANAGE_ROLES:     1 << 5,   // 32
  MANAGE_SERVER:    1 << 6,   // 64
  BAN_MEMBERS:      1 << 7,   // 128
  KICK_MEMBERS:     1 << 8,   // 256
  MENTION_EVERYONE: 1 << 9,   // 512
  ATTACH_FILES:     1 << 10,  // 1024
  CREATE_INVITES:   1 << 11,  // 2048
  // ── v2 additions ──────────────────────────────────────────
  ADMINISTRATOR:    1 << 12,  // 4096 — bypass all checks
  MANAGE_MESSAGES:  1 << 13,  // 8192 — pin/delete others
  EDIT_OWN_MESSAGES:1 << 14,  // 16384
  VIEW_AUDIT_LOG:   1 << 15,  // 32768
  // ── v3 additions ──────────────────────────────────────────
  MOVE_MEMBERS:     1 << 16,  // 65536 — move between voice channels
  MUTE_MEMBERS:     1 << 17,  // 131072 — server mute in voice
  DEAFEN_MEMBERS:   1 << 18,  // 262144 — server deafen in voice
  MANAGE_THREADS:   1 << 19,  // 524288 — create/archive/delete threads
  MANAGE_WEBHOOKS:  1 << 20,  // 1048576 — create/edit/delete webhooks
  MANAGE_EXPRESSIONS:1 << 21, // 2097152 — manage server emojis/stickers
  MANAGE_EVENTS:    1 << 22,  // 4194304 — create/edit scheduled events
  MODERATE_MEMBERS: 1 << 23,  // 8388608 — timeout members
  USE_VOICE:        1 << 24,  // 16777216 — connect to voice channels
  SPEAK:            1 << 25,  // 33554432 — speak in voice channels
  USE_SOUNDBOARD:   1 << 26,  // 67108864 — use soundboard
  PRIORITY_SPEAKER: 1 << 27,  // 134217728 — priority speaker in voice
  EMBED_LINKS:      1 << 28,  // 268435456 — links show embeds
  ADD_REACTIONS:    1 << 29,  // 536870912 — add reactions to messages
  USE_EXTERNAL_EMOJI:1 << 30, // 1073741824 — use emojis from other servers
} as const;

export type PermissionKey = keyof typeof Permissions;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  VIEW_CHANNEL:    "View Channel",
  SEND_MESSAGES:   "Send Messages",
  DELETE_MESSAGES:  "Delete Messages",
  EDIT_MESSAGES:    "Edit Messages",
  MANAGE_CHANNELS:  "Manage Channels",
  MANAGE_ROLES:     "Manage Roles",
  MANAGE_SERVER:    "Manage Server",
  BAN_MEMBERS:      "Ban Members",
  KICK_MEMBERS:     "Kick Members",
  MENTION_EVERYONE: "Mention Everyone",
  ATTACH_FILES:     "Attach Files",
  CREATE_INVITES:   "Create Invites",
  ADMINISTRATOR:    "Administrator",
  MANAGE_MESSAGES:  "Manage Messages",
  EDIT_OWN_MESSAGES:"Edit Own Messages",
  VIEW_AUDIT_LOG:   "View Audit Log",
  MOVE_MEMBERS:     "Move Members",
  MUTE_MEMBERS:     "Mute Members",
  DEAFEN_MEMBERS:   "Deafen Members",
  MANAGE_THREADS:   "Manage Threads",
  MANAGE_WEBHOOKS:  "Manage Webhooks",
  MANAGE_EXPRESSIONS:"Manage Expressions",
  MANAGE_EVENTS:    "Manage Events",
  MODERATE_MEMBERS: "Timeout Members",
  USE_VOICE:        "Connect to Voice",
  SPEAK:            "Speak in Voice",
  USE_SOUNDBOARD:   "Use Soundboard",
  PRIORITY_SPEAKER: "Priority Speaker",
  EMBED_LINKS:      "Embed Links",
  ADD_REACTIONS:    "Add Reactions",
  USE_EXTERNAL_EMOJI:"Use External Emoji",
};

export function hasPermission(bitfield: number | string, perm: number): boolean {
  const bf = Number(bitfield);
  return (bf & perm) === perm;
}

export function togglePermission(bitfield: number | string, perm: number, on: boolean): string {
  let bf = Number(bitfield);
  if (on) {
    bf |= perm;
  } else {
    bf &= ~perm;
  }
  return bf.toString();
}

/** Permission categories for organized UI display. */
export const PERMISSION_CATEGORIES: { label: string; keys: PermissionKey[] }[] = [
  {
    label: "General",
    keys: ["VIEW_CHANNEL", "SEND_MESSAGES", "ATTACH_FILES", "EMBED_LINKS", "ADD_REACTIONS", "USE_EXTERNAL_EMOJI", "MENTION_EVERYONE", "CREATE_INVITES"],
  },
  {
    label: "Message Management",
    keys: ["EDIT_MESSAGES", "EDIT_OWN_MESSAGES", "DELETE_MESSAGES", "MANAGE_MESSAGES", "MANAGE_THREADS"],
  },
  {
    label: "Voice",
    keys: ["USE_VOICE", "SPEAK", "USE_SOUNDBOARD", "PRIORITY_SPEAKER", "MUTE_MEMBERS", "DEAFEN_MEMBERS", "MOVE_MEMBERS"],
  },
  {
    label: "Server Management",
    keys: ["MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_SERVER", "MANAGE_WEBHOOKS", "MANAGE_EXPRESSIONS", "MANAGE_EVENTS", "VIEW_AUDIT_LOG"],
  },
  {
    label: "Moderation",
    keys: ["KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS"],
  },
  {
    label: "Dangerous",
    keys: ["ADMINISTRATOR"],
  },
];

// ── Presence Types ───────────────────────────────────────────────────────────

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

export interface PresenceDto {
  user_id: string;
  status: PresenceStatus;
  custom_status: string | null;
  last_seen: string | null;
}

// ── Invite Types ─────────────────────────────────────────────────────────────

export interface InviteDto {
  id: string;
  server_id: string;
  token: string;
  created_by: string;
  creator_name?: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  created_at?: string | null;
}

export interface InviteInfoDto {
  server_id?: string;
  server_name: string;
  server_icon: string | null;
  server_banner?: string | null;
  server_bio?: string | null;
  server_description: string | null;
  member_count: number;
  creator_username: string | null;
  expires_at: string | null;
}

// ── AutoMod Types ────────────────────────────────────────────────────────────

export type AutoModRuleType = "word_filter" | "spam" | "mention" | "link" | "media" | "anti_raid";
export type AutoModAction = "nothing" | "warn" | "delete" | "timeout" | "kick" | "ban";

export interface AutoModRuleDto {
  id: string;
  server_id: string;
  name: string;
  rule_type: AutoModRuleType;
  action: AutoModAction;
  config: Record<string, unknown>;
  enabled: boolean;
  exempt_roles: string[];
  exempt_channels: string[];
  created_at: string;
}

export interface AutoModEventDto {
  id: string;
  server_id: string;
  rule_id: string;
  rule_name: string | null;
  user_id: string;
  username: string | null;
  channel_id: string | null;
  content_snippet: string | null;
  action_taken: string;
  created_at: string;
}

// ── Pin Types ────────────────────────────────────────────────────────────────

export interface PinnedMessageDto {
  id: string;
  message_id: string;
  channel_id: string | null;
  session_id: string | null;
  pinned_by: string;
  content_preview: string;
  pinned_at: string;
}

// ── Channel Message Types ───────────────────────────────────────────────────

export interface ChannelMessageDto {
  id: string;
  server_id: string;
  channel_id: string;
  author_id: string;
  author_username?: string;
  content: string;
  type: string;
  reply_to_id?: string | null;
  edited_at?: string | null;
  created_at: string;
  reactions?: ReactionDto[];
  thread_id?: string | null;
  thread_count?: number;
}

export interface ChannelUnreadDto {
  unread_count: number;
  mention_count: number;
  last_read_at: string | null;
  last_read_message_id: string | null;
}

export interface ServerUnreadDto {
  server_id: string;
  has_unread: boolean;
  mention_count: number;
  channels: Record<string, ChannelUnreadDto>;
}

export interface MentionNotificationDto {
  id: string;
  user_id: string;
  server_id: string;
  channel_id: string;
  message_id: string;
  created_at: string;
  read_at: string | null;
  content?: string | null;
  message_type?: string | null;
  author_id?: string | null;
  author_username?: string | null;
}

// ── Reaction Types ──────────────────────────────────────────────────────────

export interface ReactionDto {
  emoji: string;
  count: number;
  users: string[];
  me: boolean;
}

// ── Typing Indicator Types ──────────────────────────────────────────────────

export interface TypingIndicator {
  userId: string;
  username: string;
  sessionId: string;
  timestamp: number;
}

// ── Thread Types ────────────────────────────────────────────────────────────

export interface ThreadDto {
  id: string;
  parent_message_id: string;
  channel_id?: string;
  session_id?: string;
  title: string;
  message_count: number;
  last_message_at: string;
  created_at: string;
  participants: string[];
}

// ── DM Organization Types ───────────────────────────────────────────────────

export interface DmOrganization {
  favorites: string[];       // contact user IDs
  archived: string[];        // contact user IDs
  muted: string[];           // contact user IDs
  blocked: string[];         // contact user IDs
  folders: DmFolder[];
  nicknames: Record<string, string>; // contactId → nickname
}

export interface DmFolder {
  id: string;
  name: string;
  contactIds: string[];
  color?: string;
}

// ── Unread Tracking ─────────────────────────────────────────────────────────

export interface UnreadState {
  sessionId: string;
  count: number;
  lastReadMessageId: string | null;
  lastReadAt: string | null;
  mentionCount: number;
}

export interface UserTagDto {
  id: string;
  key: string;
  label: string;
  description?: string | null;
  color_hex: string;
  position?: number | null;
}

export interface MyTagsDto {
  max_selected: number;
  granted: UserTagDto[];
  selected: UserTagDto[];
}

// ── Voice & Call Types ──────────────────────────────────────────────────────

export type CallState = "idle" | "ringing" | "connecting" | "connected" | "ended";
export type CallType = "voice" | "video";

export interface CallSession {
  id: string;
  type: CallType;
  state: CallState;
  peerId: string;
  peerName: string;
  startedAt: string;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  isVideoEnabled: boolean;
}

// ── Slash Command Types ─────────────────────────────────────────────────────

export type CommandCategory = "moderation" | "fun" | "utility" | "server" | "security";

export interface SlashCommandParam {
  name: string;
  description: string;
  type: "string" | "user" | "role" | "channel" | "number" | "boolean" | "duration";
  required: boolean;
  choices?: { name: string; value: string }[];
  autocomplete?: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  category: CommandCategory;
  params: SlashCommandParam[];
  permissions?: number;         // required permission bitfield
  roleRestrictions?: string[];  // role IDs that can use this
  cooldownMs?: number;          // cooldown in ms
  ephemeral?: boolean;          // only visible to command user
  dangerous?: boolean;          // requires confirmation
  serverOnly?: boolean;         // only in server context
}

export interface CommandResult {
  success: boolean;
  message: string;
  ephemeral: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface CommandLogEntry {
  id: string;
  server_id: string;
  user_id: string;
  username: string;
  command: string;
  params: Record<string, string>;
  result: "success" | "error" | "denied";
  error_message?: string;
  created_at: string;
}

// ── Moderation Types ────────────────────────────────────────────────────────

export interface WarningDto {
  id: string;
  server_id: string;
  user_id: string;
  username: string;
  moderator_id: string;
  moderator_username: string;
  reason: string;
  created_at: string;
}

export interface PunishmentDto {
  id: string;
  server_id: string;
  user_id: string;
  username: string;
  type: "ban" | "kick" | "timeout" | "mute";
  reason: string;
  moderator_id: string;
  moderator_username: string;
  duration_ms?: number;
  expires_at?: string;
  active: boolean;
  created_at: string;
}

// ── XP / Economy Types ──────────────────────────────────────────────────────

export interface UserXpDto {
  user_id: string;
  server_id: string;
  xp: number;
  level: number;
  messages_count: number;
  last_xp_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  xp: number;
  level: number;
}

// ── Server Security Types ───────────────────────────────────────────────────

export type EncryptionMode = "standard" | "enforced_e2e" | "hybrid";
export type RaidProtectionLevel = "off" | "low" | "medium" | "high" | "lockdown";
export type JoinVerificationLevel = "none" | "email" | "phone" | "2fa" | "manual_approval";

export interface ServerSecuritySettings {
  server_id: string;
  encryption_mode: EncryptionMode;
  require_verified_devices: boolean;
  force_2fa_moderators: boolean;
  key_rotation_days: number;
  raid_protection_level: RaidProtectionLevel;
  join_verification_level: JoinVerificationLevel;
  invite_approval_required: boolean;
  suspicious_link_scanner: boolean;
  anti_spam_threshold: number;
  lockdown_active: boolean;
  failed_login_tracking: boolean;
  device_anomaly_detection: boolean;
  max_joins_per_minute: number;
}

// ── Extended Server Types ───────────────────────────────────────────────────

export interface ServerOverviewDto extends ServerDto {
  bio?: string;
  accent_color?: string;
  vanity_invite?: string;
  category?: string;
  online_count?: number;
  channel_count?: number;
  encryption_mode?: EncryptionMode;
  region?: string;
  messages_per_day?: number;
  active_users_count?: number;
}

// ── Extended Channel Types ──────────────────────────────────────────────────

export type ChannelType =
  | "text"
  | "announcement"
  | "voice"
  | "stage"
  | "forum"
  | "private_encrypted"
  | "read_only_news";

export interface ExtendedChannelDto extends ChannelDto {
  channel_type: ChannelType;
  slow_mode_seconds?: number;
  thread_auto_archive_minutes?: number;
  media_only?: boolean;
  channel_encryption?: boolean;
  message_retention_days?: number;
  read_only?: boolean;
}

export interface ChannelCategory {
  id: string;
  server_id: string;
  name: string;
  position: number;
  collapsed?: boolean;
}

// ── Extended Member Types ───────────────────────────────────────────────────

export interface ExtendedMemberDto extends ServerMemberDto {
  last_active_at?: string;
  device_count?: number;
  verification_status?: "unverified" | "verified" | "2fa_enabled";
  moderator_notes?: string;
  suspicious_flag?: boolean;
  timeout_until?: string | null;
}

// ── Extended Invite Types ───────────────────────────────────────────────────

export interface ExtendedInviteDto extends InviteDto {
  custom_code?: string;
  required_verification?: JoinVerificationLevel;
  qr_data?: string;
  analytics?: {
    total_clicks: number;
    successful_joins: number;
    by_source: Record<string, number>;
  };
}

// ── Search Types ────────────────────────────────────────────────────────────

export interface SearchQuery {
  query: string;
  sessionId?: string;
  channelId?: string;
  serverId?: string;
  fromUserId?: string;
  hasMedia?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  messages: (MessageDto | ChannelMessageDto)[];
  total: number;
  hasMore: boolean;
}

// ── Database Schema Suggestions ─────────────────────────────────────────────
// These are TypeScript representations of suggested database tables.

export interface DbCommandLog {
  id: string;
  server_id: string;
  channel_id: string;
  user_id: string;
  command_name: string;
  params_json: string;
  result: "success" | "error" | "permission_denied" | "rate_limited";
  error_message: string | null;
  execution_time_ms: number;
  created_at: string;
}

export interface DbWarning {
  id: string;
  server_id: string;
  user_id: string;
  moderator_id: string;
  reason: string;
  severity: "low" | "medium" | "high";
  acknowledged: boolean;
  created_at: string;
}

export interface DbPunishment {
  id: string;
  server_id: string;
  user_id: string;
  moderator_id: string;
  punishment_type: "ban" | "kick" | "timeout" | "mute";
  reason: string;
  duration_seconds: number | null;
  expires_at: string | null;
  revoked: boolean;
  revoked_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface DbXp {
  user_id: string;
  server_id: string;
  total_xp: number;
  level: number;
  message_count: number;
  voice_minutes: number;
  last_xp_gain_at: string;
  streak_days: number;
  last_daily_at: string | null;
}

export interface DbCooldown {
  user_id: string;
  server_id: string;
  command_name: string;
  expires_at: string;
}

export interface DbEconomy {
  user_id: string;
  server_id: string;
  balance: number;
  bank: number;
  total_earned: number;
  total_spent: number;
  last_daily_at: string | null;
  last_work_at: string | null;
}

// ── Security Alert Types ─────────────────────────────────────────────────────

export interface SecurityAlertDto {
  id: string;
  server_id: string;
  channel_id: string | null;
  user_id: string | null;
  actor_username?: string | null;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string | null;
  metadata_json: string | null;
  ip_address: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export const AlertType = {
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  LOCKDOWN_TRIGGERED: 'lockdown_triggered',
  LOCKDOWN_RELEASED: 'lockdown_released',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  PERMISSION_ESCALATION: 'permission_escalation',
  AUDIT_ANOMALY: 'audit_anomaly',
  MANUAL_ALERT: 'manual_alert',
} as const;

export type AlertTypeValue = typeof AlertType[keyof typeof AlertType];

// ── WebSocket Gateway Message Types ──────────────────────────────────────────

export type GatewayMessageType =
  | 'connected'
  | 'subscribed'
  | 'unsubscribed'
  | 'heartbeat_ack'
  | 'message.created'
  | 'message.edited'
  | 'message.deleted'
  | 'typing.update'
  | 'read.receipt'
  | 'security.alert'
  | 'channel.lockdown'
  | 'channel.secured'
  | 'error';

export interface GatewayMessage {
  type: GatewayMessageType;
  server_id?: string;
  channel_id?: string;
  message?: ChannelMessageDto;
  message_id?: string;
  user_id?: string;
  username?: string;
  active?: boolean;
  last_read_message_id?: string;
  alert?: SecurityAlertDto;
  is_secure?: boolean;
  code?: string;
  error?: string;
}
