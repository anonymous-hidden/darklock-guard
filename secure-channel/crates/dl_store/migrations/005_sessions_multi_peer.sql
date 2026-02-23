-- Migration 005: Allow multiple concurrent sessions per peer.
--
-- Why:
-- The original sessions schema enforced UNIQUE(local_user_id, peer_user_id),
-- which prevents storing both sides of a simultaneous X3DH initiation.
-- In that race, incoming envelopes reference a different session_id than the
-- locally initiated one, causing decrypt failures and an empty poll result.
--
-- This migration rebuilds sessions/messages/attachments in-place so that:
-- - sessions no longer has UNIQUE(local_user_id, peer_user_id)
-- - all existing rows are preserved
-- - foreign key integrity remains intact

PRAGMA defer_foreign_keys = ON;

ALTER TABLE attachments RENAME TO attachments_old;
ALTER TABLE messages RENAME TO messages_old;
ALTER TABLE sessions RENAME TO sessions_old;

CREATE TABLE sessions (
    id                  TEXT PRIMARY KEY,
    local_user_id       TEXT NOT NULL,
    peer_user_id        TEXT NOT NULL,
    session_state_enc   TEXT NOT NULL,
    chain_head          TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    x3dh_header_pending TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sessions (
    id, local_user_id, peer_user_id, session_state_enc, chain_head,
    x3dh_header_pending, created_at, updated_at
)
SELECT
    id, local_user_id, peer_user_id, session_state_enc, chain_head,
    x3dh_header_pending, created_at, updated_at
FROM sessions_old;

CREATE TABLE messages (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    sender_id           TEXT NOT NULL,
    recipient_id        TEXT NOT NULL,
    sent_at             TEXT NOT NULL,
    received_at         TEXT,
    delivery_state      TEXT NOT NULL DEFAULT 'sending',
    message_type        TEXT NOT NULL DEFAULT 'text',
    body_enc            TEXT NOT NULL,
    chain_link          TEXT NOT NULL,
    message_n           INTEGER NOT NULL DEFAULT 0,
    is_outgoing         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

INSERT INTO messages (
    id, session_id, sender_id, recipient_id, sent_at, received_at,
    delivery_state, message_type, body_enc, chain_link, message_n, is_outgoing
)
SELECT
    id, session_id, sender_id, recipient_id, sent_at, received_at,
    delivery_state, message_type, body_enc, chain_link, message_n, is_outgoing
FROM messages_old;

CREATE TABLE attachments (
    id                  TEXT PRIMARY KEY,
    message_id          TEXT NOT NULL,
    filename            TEXT NOT NULL,
    mime_type           TEXT NOT NULL,
    size_bytes          INTEGER NOT NULL DEFAULT 0,
    content_hash        TEXT NOT NULL,
    storage_ref         TEXT NOT NULL,
    attachment_key_enc  TEXT NOT NULL,
    local_path          TEXT,
    downloaded          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

INSERT INTO attachments (
    id, message_id, filename, mime_type, size_bytes, content_hash, storage_ref,
    attachment_key_enc, local_path, downloaded
)
SELECT
    id, message_id, filename, mime_type, size_bytes, content_hash, storage_ref,
    attachment_key_enc, local_path, downloaded
FROM attachments_old;

DROP TABLE attachments_old;
DROP TABLE messages_old;
DROP TABLE sessions_old;

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(local_user_id, peer_user_id, created_at);
