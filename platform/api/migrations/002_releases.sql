CREATE TABLE IF NOT EXISTS releases (
    id BIGSERIAL PRIMARY KEY,
    os TEXT NOT NULL,
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    url TEXT NOT NULL,
    checksum TEXT NOT NULL,
    signature TEXT,
    release_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_releases_os_channel_version ON releases(os, channel, version);
CREATE INDEX IF NOT EXISTS idx_releases_os_channel_created ON releases(os, channel, created_at DESC);
