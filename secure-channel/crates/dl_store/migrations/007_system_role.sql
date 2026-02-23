-- 007_system_role.sql
-- Adds system_role tag to contacts, sourced from IDS user profile.
-- 'owner' = account holds the Owner tag shown in the UI.

ALTER TABLE contacts ADD COLUMN system_role TEXT;
