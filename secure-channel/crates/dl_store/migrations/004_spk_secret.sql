-- Migration 004: Store signed prekey (SPK) secret so Bob can complete X3DH
-- The SPK secret must be available locally to decrypt incoming X3DH session inits.
-- The column is nullable so it can be backfilled at next login.

-- spk_secret_enc column already added in 001_initial.sql — no-op
SELECT 1;
