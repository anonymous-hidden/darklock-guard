ALTER TABLE releases
    ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'Guard',
    ADD COLUMN IF NOT EXISTS file_size TEXT,
    ADD COLUMN IF NOT EXISTS changelog JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_releases_product ON releases(product);
