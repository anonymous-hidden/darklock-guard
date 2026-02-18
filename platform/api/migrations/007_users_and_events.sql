-- Users table for web dashboard authentication
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    api_key VARCHAR(64) UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add owner_id to devices for user-device relationship
ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS name VARCHAR(255);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS os VARCHAR(64);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS version VARCHAR(32);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS baseline_valid BOOLEAN DEFAULT TRUE;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS baseline_files INTEGER DEFAULT 0;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_scan_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'offline';

-- Device events table for audit/log storage
CREATE TABLE IF NOT EXISTS device_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_events_device ON device_events(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_type ON device_events(event_type);
CREATE INDEX IF NOT EXISTS idx_device_events_severity ON device_events(severity);

-- Device link codes
CREATE TABLE IF NOT EXISTS device_link_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sessions table for express-session (pg store)
CREATE TABLE IF NOT EXISTS user_sessions (
    sid VARCHAR(255) PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON user_sessions(expire);
