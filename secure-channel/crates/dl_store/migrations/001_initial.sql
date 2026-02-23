-- Migration 001: Initial schema for Darklock Secure Channel local vault
-- NOTE: journal_mode and foreign_keys are set at connection time in db.rs,
-- NOT here — sqlx runs migrations inside a transaction and SQLite forbids
-- changing journal_mode inside a transaction (returns SQLITE_ERROR code 1).

-- ── Accounts ─────────────────────────────────────────────────────────────────
-- One row per local account (multi-account support possible in v2).

CREATE TABLE IF NOT EXISTS accounts (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL UNIQUE,          -- server-assigned
    username            TEXT NOT NULL,
    email               TEXT NOT NULL,
    identity_pubkey     TEXT NOT NULL,                 -- base64 Ed25519 pub
    identity_secret_enc TEXT NOT NULL,                 -- vault-encrypted secret
    dh_secret_enc       TEXT NOT NULL,                 -- vault-encrypted X25519 DH secret
    vault_salt          TEXT NOT NULL,                 -- hex 16-byte Argon2id salt
    spk_secret_enc      TEXT,                          -- vault-encrypted signed prekey secret (nullable, backfilled on login)
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Devices ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS devices (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    device_id           TEXT NOT NULL UNIQUE,
    device_name         TEXT NOT NULL,
    platform            TEXT NOT NULL DEFAULT 'unknown',
    device_pubkey       TEXT NOT NULL,                 -- base64 Ed25519 pub
    device_cert         TEXT NOT NULL,                 -- DeviceCert JSON
    enrolled_at         TEXT NOT NULL DEFAULT (datetime('now')),
    is_current_device   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);

-- ── Contacts ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
    id                  TEXT PRIMARY KEY,
    owner_user_id       TEXT NOT NULL,
    contact_user_id     TEXT NOT NULL,
    display_name        TEXT,
    identity_pubkey     TEXT NOT NULL,                 -- base64 Ed25519 pub
    verified_fingerprint TEXT,                         -- NULL until user verifies
    key_change_pending  INTEGER NOT NULL DEFAULT 0,    -- 1 = BLOCKED until re-verified
    status              TEXT NOT NULL DEFAULT 'accepted', -- 'accepted'|'pending_sent'|'pending_received'
    added_at            TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (owner_user_id, contact_user_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_user_id);

-- ── Sessions ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    local_user_id       TEXT NOT NULL,
    peer_user_id        TEXT NOT NULL,
    session_state_enc   TEXT NOT NULL,                 -- vault-encrypted Session JSON
    chain_head          TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    x3dh_header_pending TEXT,                          -- pending X3DH header JSON (cleared after first send)
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (local_user_id, peer_user_id)
);

-- ── Messages ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT PRIMARY KEY,              -- message_id (BLAKE3)
    session_id          TEXT NOT NULL,
    sender_id           TEXT NOT NULL,
    recipient_id        TEXT NOT NULL,
    sent_at             TEXT NOT NULL,
    received_at         TEXT,
    delivery_state      TEXT NOT NULL DEFAULT 'sending',
    message_type        TEXT NOT NULL DEFAULT 'text',
    body_enc            TEXT NOT NULL,                 -- vault-encrypted MessageContent JSON
    chain_link          TEXT NOT NULL,
    message_n           INTEGER NOT NULL DEFAULT 0,
    is_outgoing         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages(sender_id);

-- ── Attachments ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
    id                  TEXT PRIMARY KEY,
    message_id          TEXT NOT NULL,
    filename            TEXT NOT NULL,
    mime_type           TEXT NOT NULL,
    size_bytes          INTEGER NOT NULL DEFAULT 0,
    content_hash        TEXT NOT NULL,
    storage_ref         TEXT NOT NULL,
    attachment_key_enc  TEXT NOT NULL,                 -- vault-encrypted attachment key
    local_path          TEXT,
    downloaded          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- ── Groups ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS groups (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    creator_user_id     TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    avatar_url          TEXT,
    description         TEXT
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id            TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    display_name        TEXT,
    role                TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
    joined_at           TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

-- ── Risk events ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS risk_events (
    id                  TEXT PRIMARY KEY,
    occurred_at         TEXT NOT NULL DEFAULT (datetime('now')),
    event_type          TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'low',   -- 'low'|'medium'|'high'|'critical'
    description         TEXT NOT NULL,
    raw_data            TEXT
);

-- ── Settings ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
    key                 TEXT PRIMARY KEY,
    value               TEXT NOT NULL,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('message_retention_days', '90'),
    ('padding_enabled',        'false'),
    ('high_security_mode',     'false'),
    ('vault_lock_timeout_min', '15'),
    ('clipboard_export_block', 'false'),
    ('verification_policy',    'warn');  -- 'warn' | 'block'
