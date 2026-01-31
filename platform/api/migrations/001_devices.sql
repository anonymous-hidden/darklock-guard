CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    link_code TEXT UNIQUE,
    link_code_expires_at TIMESTAMPTZ,
    link_code_used BOOLEAN NOT NULL DEFAULT FALSE,
    public_key TEXT,
    security_profile TEXT NOT NULL DEFAULT 'NORMAL' CHECK (security_profile IN ('NORMAL', 'ZERO_TRUST')),
    mode TEXT NOT NULL DEFAULT 'CONNECTED' CHECK (mode IN ('CONNECTED', 'LOCAL')),
    last_seen_at TIMESTAMPTZ,
    linked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_link_code ON devices(link_code);
