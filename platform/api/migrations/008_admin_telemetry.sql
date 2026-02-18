-- Add role column to users (default 'user', admin can be set manually)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';

-- Anonymous crash/bug reports from desktop apps (NO user data)
CREATE TABLE IF NOT EXISTS crash_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type VARCHAR(32) NOT NULL DEFAULT 'crash',  -- 'crash', 'bug_report', 'telemetry'
    description TEXT,
    diagnostics TEXT,
    stack_trace TEXT,
    app_version VARCHAR(32),
    platform VARCHAR(64),
    os_version VARCHAR(128),
    error_code VARCHAR(64),
    metadata JSONB,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crash_reports_type ON crash_reports(report_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_reports_resolved ON crash_reports(resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_reports_version ON crash_reports(app_version);

-- Update push records (admin pushes updates to devices)
CREATE TABLE IF NOT EXISTS update_pushes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(32) NOT NULL,
    channel VARCHAR(16) NOT NULL DEFAULT 'stable',
    title VARCHAR(255),
    release_notes TEXT,
    pushed_by UUID REFERENCES users(id),
    target_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
