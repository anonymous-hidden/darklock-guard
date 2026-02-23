-- DM pinned messages (stored locally in the vault)
CREATE TABLE IF NOT EXISTS pinned_dm_messages (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    message_id      TEXT NOT NULL,
    pinned_by       TEXT NOT NULL,
    content_preview TEXT NOT NULL DEFAULT '',
    pinned_at       TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_pinned_dm_session ON pinned_dm_messages(session_id);
