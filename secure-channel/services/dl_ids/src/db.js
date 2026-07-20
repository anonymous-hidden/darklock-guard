/**
 * IDS SQLite database initialisation via better-sqlite3.
 */
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_APP_TAGS = [
  { key: 'owner', label: 'Owner', color_hex: '#f59e0b' },
  { key: 'coowner', label: 'Co-Owner', color_hex: '#d97706' },
  { key: 'dev', label: 'Developer', color_hex: '#6366f1' },
  { key: 'member-2024', label: 'Est. 2024', color_hex: '#3b82f6' },
  { key: 'member-2025', label: 'Est. 2025', color_hex: '#6366f1' },
  { key: 'member-2026', label: 'Est. 2026', color_hex: '#8b5cf6' },
  { key: 'member-2027', label: 'Est. 2027', color_hex: '#a855f7' },
  { key: 'member-1yr', label: '1 Year', color_hex: '#22c55e' },
  { key: 'member-2yr', label: '2 Years', color_hex: '#16a34a' },
  { key: 'member-3yr', label: '3 Years', color_hex: '#15803d' },
  { key: 'member-5yr', label: '5 Years', color_hex: '#f59e0b' },
  { key: 'nye-2024', label: 'NYE 2024', color_hex: '#6366f1' },
  { key: 'nye-2025', label: 'NYE 2025', color_hex: '#818cf8' },
  { key: 'nye-2026', label: 'NYE 2026', color_hex: '#a78bfa' },
  { key: 'valentines-2025', label: "Valentine's 2025", color_hex: '#e11d48' },
  { key: 'valentines-2026', label: "Valentine's 2026", color_hex: '#f43f5e' },
  { key: 'stpatricks-2025', label: "St. Patrick's 2025", color_hex: '#16a34a' },
  { key: 'stpatricks-2026', label: "St. Patrick's 2026", color_hex: '#22c55e' },
  { key: 'easter-2025', label: 'Easter 2025', color_hex: '#a855f7' },
  { key: 'easter-2026', label: 'Easter 2026', color_hex: '#c084fc' },
  { key: 'july4-2025', label: '4th of July 2025', color_hex: '#2563eb' },
  { key: 'july4-2026', label: '4th of July 2026', color_hex: '#3b82f6' },
  { key: 'halloween-2024', label: 'Halloween 2024', color_hex: '#ea580c' },
  { key: 'halloween-2025', label: 'Halloween 2025', color_hex: '#f97316' },
  { key: 'halloween-2026', label: 'Halloween 2026', color_hex: '#fb923c' },
  { key: 'thanksgiving-2024', label: 'Thanksgiving 2024', color_hex: '#92400e' },
  { key: 'thanksgiving-2025', label: 'Thanksgiving 2025', color_hex: '#b45309' },
  { key: 'thanksgiving-2026', label: 'Thanksgiving 2026', color_hex: '#d97706' },
  { key: 'xmas-2024', label: 'Christmas 2024', color_hex: '#dc2626' },
  { key: 'xmas-2025', label: 'Christmas 2025', color_hex: '#ef4444' },
  { key: 'xmas-2026', label: 'Christmas 2026', color_hex: '#f87171' },
  { key: 'spring-2025', label: 'Spring 2025', color_hex: '#ec4899' },
  { key: 'spring-2026', label: 'Spring 2026', color_hex: '#f472b6' },
  { key: 'summer-2025', label: 'Summer 2025', color_hex: '#eab308' },
  { key: 'summer-2026', label: 'Summer 2026', color_hex: '#facc15' },
  { key: 'fall-2025', label: 'Fall 2025', color_hex: '#d97706' },
  { key: 'fall-2026', label: 'Fall 2026', color_hex: '#f59e0b' },
  { key: 'winter-2025', label: 'Winter 2025', color_hex: '#0ea5e9' },
  { key: 'winter-2026', label: 'Winter 2026', color_hex: '#38bdf8' },
  { key: 'early-adopter', label: 'Early Adopter', color_hex: '#6366f1' },
  { key: 'bug-hunter', label: 'Bug Hunter', color_hex: '#22c55e' },
  { key: 'crypto-king', label: 'Crypto King', color_hex: '#8b5cf6' },
  { key: 'night-owl', label: 'Night Owl', color_hex: '#475569' },
  { key: 'chatterbox', label: 'Chatterbox', color_hex: '#0891b2' },
  { key: 'vault-keeper', label: 'Vault Keeper', color_hex: '#b45309' },
  { key: 'og-member', label: 'OG Member', color_hex: '#f59e0b' },
  { key: 'trusted', label: 'Trusted', color_hex: '#16a34a' },
  { key: 'quest-complete', label: 'Quest Complete', color_hex: '#10b981' },
  { key: 'msg-1k', label: '1K Messages', color_hex: '#06b6d4' },
  { key: 'msg-10k', label: '10K Messages', color_hex: '#0284c7' },
  { key: 'msg-100k', label: '100K Messages', color_hex: '#1d4ed8' },
  { key: 'file-sharer', label: 'File Sharer', color_hex: '#7c3aed' },
  { key: 'streaker', label: 'Streaker', color_hex: '#e11d48' },
  { key: 'speed-demon', label: 'Speed Demon', color_hex: '#dc2626' },
  { key: 'beta-tester', label: 'Beta Tester', color_hex: '#7c3aed' },
  { key: 'supporter', label: 'Supporter', color_hex: '#2563eb' },
  { key: 'contributor', label: 'Contributor', color_hex: '#059669' },
  { key: 'vip', label: 'VIP', color_hex: '#d97706' },
  { key: 'verified', label: 'Verified', color_hex: '#3b82f6' },
  { key: 'premium', label: 'Premium', color_hex: '#f59e0b' },
  { key: 'partner', label: 'Partner', color_hex: '#6366f1' },
  { key: 'moderator', label: 'Moderator', color_hex: '#059669' },
];

function seedDefaultAppTags(db) {
  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO app_tags (id, key, label, color_hex)
    VALUES (?, ?, ?, ?)
  `);
  const seedTags = db.transaction(() => {
    for (const tag of DEFAULT_APP_TAGS) {
      insertTag.run(randomUUID(), tag.key, tag.label, tag.color_hex);
    }
  });
  seedTags();
}

export function initDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // WAL mode for concurrent reads
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash  TEXT NOT NULL,
      identity_pubkey TEXT NOT NULL,
      key_version    INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Identity key rotation challenges (one-time nonce/challenge)
    CREATE TABLE IF NOT EXISTS identity_key_rotation_challenges (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      nonce       TEXT NOT NULL UNIQUE,
      issued_at   TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      used_at     TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_identity_rotate_challenge_user
      ON identity_key_rotation_challenges(user_id, expires_at, used_at);

    -- Identity key rotation history / audit trail
    CREATE TABLE IF NOT EXISTS identity_key_history (
      id                   TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL,
      old_identity_pubkey  TEXT NOT NULL,
      new_identity_pubkey  TEXT NOT NULL,
      previous_key_version INTEGER NOT NULL,
      new_key_version      INTEGER NOT NULL,
      nonce                TEXT NOT NULL,
      signature            TEXT NOT NULL,
      rotated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_identity_key_history_user
      ON identity_key_history(user_id, rotated_at);

    -- Refresh tokens
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      device_info TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Devices
    CREATE TABLE IF NOT EXISTS devices (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      device_id     TEXT NOT NULL UNIQUE,
      device_name   TEXT NOT NULL,
      platform      TEXT NOT NULL DEFAULT 'unknown',
      device_pubkey TEXT NOT NULL,
      device_cert   TEXT NOT NULL,
      dh_pubkey     TEXT NOT NULL,
      enrolled_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at  TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Signed prekeys (one per device)
    CREATE TABLE IF NOT EXISTS signed_prekeys (
      device_id   TEXT PRIMARY KEY,
      spk_pubkey  TEXT NOT NULL,
      spk_sig     TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    );

    -- One-time prekeys (consumed on use)
    CREATE TABLE IF NOT EXISTS one_time_prekeys (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      opk_pub   TEXT NOT NULL,
      used      INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_otpk_device ON one_time_prekeys(device_id, used);
    CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

    -- Friend requests
    CREATE TABLE IF NOT EXISTS friend_requests (
      id            TEXT PRIMARY KEY,
      from_user_id  TEXT NOT NULL,
      to_user_id    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_user_id, to_user_id),
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id)   REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_fr_to   ON friend_requests(to_user_id,   status);
    CREATE INDEX IF NOT EXISTS idx_fr_from ON friend_requests(from_user_id, status);

    -- User blocks (directed edge: blocker -> blocked)
    CREATE TABLE IF NOT EXISTS user_blocks (
      id               TEXT PRIMARY KEY,
      blocker_user_id  TEXT NOT NULL,
      blocked_user_id  TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(blocker_user_id, blocked_user_id),
      FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_user_id);
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_user_id);
  `);

  // Profile/account columns migration (safe to run every boot)
  const addIfMissing = (col, type) => {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`); } catch {}
  };
  addIfMissing('key_version',   'INTEGER NOT NULL DEFAULT 1');
  addIfMissing('email_blind_index', 'TEXT');
  addIfMissing('profile_bio',    'TEXT');
  addIfMissing('pronouns',       'TEXT');
  addIfMissing('custom_status',  'TEXT');
  addIfMissing('custom_status_expires_at', 'TEXT');
  addIfMissing('profile_color',  'TEXT');
  addIfMissing('avatar',         'TEXT');
  addIfMissing('banner',         'TEXT');
  addIfMissing('display_name',   'TEXT');
  addIfMissing('system_role',    'TEXT');
  // TOTP fields are encrypted by the centralized private-beta field codec.
  addIfMissing('totp_secret',    'TEXT');
  addIfMissing('totp_enabled',   'INTEGER NOT NULL DEFAULT 0');
  addIfMissing('backup_codes',   'TEXT');
  addIfMissing('twofa_pending_secret',                 'TEXT');
  addIfMissing('twofa_pending_backup_codes',           'TEXT');
  addIfMissing('twofa_pending_email_code_hash',        'TEXT');
  addIfMissing('twofa_pending_email_code_expires_at',  'INTEGER');
  addIfMissing('login_alerts_enabled',                 'INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_blind_index ON users(email_blind_index) WHERE email_blind_index IS NOT NULL');

  // Public integrations retain one expiring activity snapshot per user.
  // Provider credentials remain solely in the desktop credential store.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile_activities (
      user_id             TEXT PRIMARY KEY,
      provider            TEXT NOT NULL CHECK(provider = 'spotify'),
      track_id            TEXT NOT NULL,
      title               TEXT NOT NULL,
      artists_json        TEXT NOT NULL,
      album               TEXT,
      artwork_url         TEXT,
      external_url        TEXT NOT NULL,
      duration_ms         INTEGER NOT NULL,
      progress_ms         INTEGER NOT NULL,
      playback_started_at TEXT,
      is_playing          INTEGER NOT NULL DEFAULT 0,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at          TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_profile_activities_expiry
      ON user_profile_activities(expires_at);
  `);

  // ── v1 compatibility tables (app contract: /v1/keys + /v1/sync) ──────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_key_bundles (
      user_id             TEXT PRIMARY KEY,
      identity_key        TEXT NOT NULL,
      signed_prekey_json  TEXT NOT NULL,
      one_time_prekeys_json TEXT NOT NULL,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sync_kv (
      user_id     TEXT NOT NULL,
      key         TEXT NOT NULL,
      value_json  TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_sync_kv_user ON user_sync_kv(user_id);

    CREATE TABLE IF NOT EXISTS pending_2fa_tokens (
      token       TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pending_2fa_user ON pending_2fa_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_pending_2fa_expires ON pending_2fa_tokens(expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS login_activity (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL,
      device_label    TEXT,
      location_label  TEXT,
      ip_hint         TEXT,
      login_count     INTEGER NOT NULL DEFAULT 1,
      first_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, fingerprint_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_login_activity_user_seen ON login_activity(user_id, last_seen_at);

    CREATE TABLE IF NOT EXISTS account_security_actions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      action        TEXT NOT NULL,
      token_hash    TEXT NOT NULL UNIQUE,
      metadata_json TEXT,
      expires_at    INTEGER NOT NULL,
      used_at       INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_security_actions_user ON account_security_actions(user_id, action, expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS secure_storage_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS secure_storage_key_check (
      id               TEXT PRIMARY KEY,
      validation_value TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Server / Group Infrastructure (v2) ─────────────────────────────────────
  db.exec(`
    -- Servers (groups/guilds)
    CREATE TABLE IF NOT EXISTS servers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      owner_id    TEXT NOT NULL,
      icon        TEXT,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Server members
    CREATE TABLE IF NOT EXISTS server_members (
      id         TEXT PRIMARY KEY,
      server_id  TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      nickname   TEXT,
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(server_id, user_id),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sm_server ON server_members(server_id);
    CREATE INDEX IF NOT EXISTS idx_sm_user   ON server_members(user_id);

    -- Channels (text channels within a server)
    CREATE TABLE IF NOT EXISTS channels (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      topic       TEXT,
      type        TEXT NOT NULL DEFAULT 'text',
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);

    -- Roles (position 0 = @everyone)
    CREATE TABLE IF NOT EXISTS roles (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      color_hex   TEXT DEFAULT '#99aab5',
      position    INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '0',
      is_admin    INTEGER NOT NULL DEFAULT 0,
      show_tag    INTEGER NOT NULL DEFAULT 1,
      hoist       INTEGER NOT NULL DEFAULT 0,
      tag_style   TEXT NOT NULL DEFAULT 'dot',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id, position);

    -- Member ↔ Role assignments
    CREATE TABLE IF NOT EXISTS member_roles (
      id        TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      role_id   TEXT NOT NULL,
      UNIQUE(server_id, user_id, role_id),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
      FOREIGN KEY (role_id)   REFERENCES roles(id)    ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mr_server_user ON member_roles(server_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_mr_role        ON member_roles(role_id);

    -- Channel permission overrides
    CREATE TABLE IF NOT EXISTS channel_permission_overrides (
      id                TEXT PRIMARY KEY,
      channel_id        TEXT NOT NULL,
      role_id           TEXT NOT NULL,
      allow_permissions TEXT NOT NULL DEFAULT '0',
      deny_permissions  TEXT NOT NULL DEFAULT '0',
      UNIQUE(channel_id, role_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id)    REFERENCES roles(id)     ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cpo_channel ON channel_permission_overrides(channel_id);

    -- Audit log
    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      changes     TEXT,
      diff_json   TEXT,
      reason      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id)  REFERENCES users(id)   ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_audit_server  ON audit_log(server_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(server_id, action);
    CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(server_id, actor_id);
  `);

  // ── Presence System ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id        TEXT PRIMARY KEY,
      status         TEXT NOT NULL DEFAULT 'offline',
      last_seen      TEXT NOT NULL DEFAULT (datetime('now')),
      manual_override TEXT,
      custom_status  TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── Invite System ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_invites (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      created_by  TEXT NOT NULL,
      token       TEXT NOT NULL UNIQUE,
      expires_at  TEXT,
      max_uses    INTEGER DEFAULT 0,
      use_count   INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_invite_token ON server_invites(token);
    CREATE INDEX IF NOT EXISTS idx_invite_server ON server_invites(server_id);
  `);

  // ── Pin System ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS pinned_messages (
      id          TEXT PRIMARY KEY,
      dm_id       TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      pinned_by   TEXT NOT NULL,
      pinned_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(dm_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pins_dm ON pinned_messages(dm_id);
  `);

  // ── Call System ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS active_calls (
      id          TEXT PRIMARY KEY,
      dm_id       TEXT NOT NULL,
      started_by  TEXT NOT NULL,
      call_type   TEXT NOT NULL DEFAULT 'voice',
      status      TEXT NOT NULL DEFAULT 'ringing',
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at    TEXT,
      FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_calls_dm ON active_calls(dm_id);
  `);

  // ── AutoMod System ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS automod_rules (
      id                      TEXT PRIMARY KEY,
      server_id               TEXT NOT NULL,
      rule_type               TEXT NOT NULL,
      enabled                 INTEGER NOT NULL DEFAULT 1,
      config_json             TEXT NOT NULL DEFAULT '{}',
      action_type             TEXT NOT NULL DEFAULT 'delete',
      action_duration_seconds INTEGER,
      created_by              TEXT NOT NULL,
      updated_by              TEXT,
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automod_server ON automod_rules(server_id, rule_type);

    CREATE TABLE IF NOT EXISTS automod_events (
      id              TEXT PRIMARY KEY,
      server_id       TEXT NOT NULL,
      rule_id         TEXT,
      actor_user_id   TEXT NOT NULL,
      message_id      TEXT,
      channel_id      TEXT,
      reason          TEXT NOT NULL,
      action_taken    TEXT NOT NULL,
      metadata_json   TEXT DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automod_events_server ON automod_events(server_id, created_at);
  `);

  // ── Scheduled Messages ────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      sender_id     TEXT NOT NULL,
      recipient_id  TEXT NOT NULL,
      body          TEXT NOT NULL,
      scheduled_at  TEXT NOT NULL,
      sent          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sched_msg ON scheduled_messages(sent, scheduled_at);
  `);

  // ── Polls ─────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      creator_id    TEXT NOT NULL,
      question      TEXT NOT NULL,
      options_json  TEXT NOT NULL,
      expires_at    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      id            TEXT PRIMARY KEY,
      poll_id       TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      option_index  INTEGER NOT NULL,
      voted_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(poll_id, user_id),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );
  `);

  // ── Message Reactions ─────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id          TEXT PRIMARY KEY,
      message_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      emoji       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_id);
  `);

  // ── Rule Acceptance ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rule_acceptances (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(server_id, user_id),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── Column migrations (safe to run on every boot) ──────────────────────────
  const addColSafe = (table, col, type) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch {}
  };

  // ── Channel Messages (server text chat) ───────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_messages (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      author_id   TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      type        TEXT NOT NULL DEFAULT 'text',
      attachment_url TEXT,
      reply_to_id TEXT,
      edited_at   TEXT,
      deleted     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chanmsg_channel ON channel_messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chanmsg_server ON channel_messages(server_id);
  `);

  // ── Channel Read State / Unread ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_read_state (
      user_id              TEXT NOT NULL,
      server_id            TEXT NOT NULL,
      channel_id           TEXT NOT NULL,
      last_read_message_id TEXT,
      last_read_at         TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, channel_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_read_state_server_user ON channel_read_state(server_id, user_id, last_read_at);
  `);

  // ── Mentions / Mention Notifications ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_mentions (
      id                TEXT PRIMARY KEY,
      message_id        TEXT NOT NULL,
      server_id         TEXT NOT NULL,
      channel_id        TEXT NOT NULL,
      mention_type      TEXT NOT NULL, -- user | role | everyone | here
      mentioned_user_id TEXT,
      mentioned_role_id TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES channel_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (mentioned_role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mentions_msg ON message_mentions(message_id);
    CREATE INDEX IF NOT EXISTS idx_mentions_user ON message_mentions(mentioned_user_id);
    CREATE INDEX IF NOT EXISTS idx_mentions_role ON message_mentions(mentioned_role_id);

    CREATE TABLE IF NOT EXISTS mention_notifications (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      server_id   TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      read_at     TEXT,
      UNIQUE(user_id, message_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES channel_messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mention_notif_user ON mention_notifications(user_id, read_at, created_at);
  `);

  // ── App-Granted User Tags ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_tags (
      id          TEXT PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL,
      description TEXT,
      color_hex   TEXT NOT NULL DEFAULT '#99aab5',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_tag_grants (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      tag_id      TEXT NOT NULL,
      granted_by  TEXT NOT NULL, -- app or event id
      granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT,
      metadata_json TEXT,
      UNIQUE(user_id, tag_id, granted_by),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES app_tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tag_grants_user ON user_tag_grants(user_id, granted_at);

    CREATE TABLE IF NOT EXISTS user_tag_selections (
      user_id     TEXT NOT NULL,
      tag_id      TEXT NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      selected_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, tag_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES app_tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tag_select_user ON user_tag_selections(user_id, position);
  `);

  addColSafe('roles',     'hoist',     'INTEGER NOT NULL DEFAULT 0');
  addColSafe('roles',     'tag_style', "TEXT NOT NULL DEFAULT 'dot'");
  addColSafe('roles',     'separate_members', 'INTEGER NOT NULL DEFAULT 0');
  addColSafe('roles',     'badge_image_url', 'TEXT');
  addColSafe('audit_log', 'diff_json', 'TEXT');
  addColSafe('servers',   'banner_color', 'TEXT');
  addColSafe('servers',   'banner_url', 'TEXT');
  addColSafe('servers',   'community_mode', 'INTEGER DEFAULT 0');
  addColSafe('servers',   'rules_channel_id', 'TEXT');
  addColSafe('servers',   'force_rule_agreement', 'INTEGER DEFAULT 0');
  addColSafe('channels',  'slowmode_seconds', 'INTEGER DEFAULT 0');
  addColSafe('channels',  'category_id',      'TEXT');
  addColSafe('users',     'system_role', 'TEXT');
  addColSafe('refresh_tokens', 'device_info', 'TEXT');

  // ── Voice Room State ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_room_members (
      id          TEXT PRIMARY KEY,
      server_id   TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      is_muted    INTEGER NOT NULL DEFAULT 0,
      is_deafened INTEGER NOT NULL DEFAULT 0,
      joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_user  ON voice_room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_voice_channel      ON voice_room_members(channel_id);
    CREATE INDEX IF NOT EXISTS idx_voice_server       ON voice_room_members(server_id);
  `);
  addColSafe('voice_room_members', 'last_heartbeat_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
  addColSafe('voice_room_members', 'is_camera_on', 'INTEGER NOT NULL DEFAULT 0');
  addColSafe('voice_room_members', 'is_stage_speaker', 'INTEGER NOT NULL DEFAULT 0');
  addColSafe('voice_room_members', 'is_stage_requesting', 'INTEGER NOT NULL DEFAULT 0');
  addColSafe('voice_room_members', 'fingerprint', 'TEXT');

  // ── Channel-Based RBAC: Secure Channels ───────────────────────────────────
  addColSafe('channels', 'is_secure', 'INTEGER NOT NULL DEFAULT 0');
  addColSafe('channels', 'lockdown',  'INTEGER NOT NULL DEFAULT 0');
  addColSafe('roles',    'security_level', 'INTEGER NOT NULL DEFAULT 0');

  // Per-user channel permission overrides (complements role-based overrides)
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_user_overrides (
      id                TEXT PRIMARY KEY,
      channel_id        TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      allow_permissions TEXT NOT NULL DEFAULT '0',
      deny_permissions  TEXT NOT NULL DEFAULT '0',
      UNIQUE(channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cuo_channel ON channel_user_overrides(channel_id);
    CREATE INDEX IF NOT EXISTS idx_cuo_user    ON channel_user_overrides(user_id);
  `);

  // Secure channel audit log — separate from general audit_log for isolation
  db.exec(`
    CREATE TABLE IF NOT EXISTS secure_channel_audit (
      id                 TEXT PRIMARY KEY,
      server_id          TEXT NOT NULL,
      channel_id         TEXT NOT NULL,
      user_id            TEXT NOT NULL,
      action             TEXT NOT NULL,
      permission_checked TEXT,
      result             TEXT NOT NULL DEFAULT 'denied',
      metadata_json      TEXT,
      ip_address         TEXT,
      user_agent         TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (server_id)  REFERENCES servers(id)  ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sca_server_channel ON secure_channel_audit(server_id, channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sca_user           ON secure_channel_audit(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sca_action         ON secure_channel_audit(action, created_at);
  `);

  seedDefaultAppTags(db);

  return db;
}
