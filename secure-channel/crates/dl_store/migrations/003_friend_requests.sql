-- Migration 003: Add contact status for friend-request system
--
-- status values:
--   'accepted'         — fully accepted contact (can message)
--   'pending_sent'     — current user sent a friend request, awaiting response
--   'pending_received' — peer sent a friend request, current user must Accept/Deny

-- status column already added in 001_initial.sql — no-op
SELECT 1;
