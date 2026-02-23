-- Migration 002: Add columns required for X3DH + Double Ratchet upgrade

-- Store the pending X3DH header JSON for the first message in a new session.
-- Cleared (set to NULL) once the first message is sent.
-- x3dh_header_pending column already added in 001_initial.sql — no-op
SELECT 1;

-- Drop the old dh_secret_enc from accounts — we now store identity_secret_enc
-- and derive the X25519 key via the birational map at runtime.
-- (SQLite doesn't support DROP COLUMN in older versions, so we keep it nullable.)
-- No-op migration note: dh_secret_enc is kept for backward compatibility.

-- Ensure sessions table has updated_at for UPDATE queries
-- (already present in 001 but guard with IF NOT EXISTS via the migration system)
