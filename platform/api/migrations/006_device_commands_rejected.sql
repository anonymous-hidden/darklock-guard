ALTER TABLE device_commands DROP CONSTRAINT IF EXISTS device_commands_status_check;
ALTER TABLE device_commands ADD CONSTRAINT device_commands_status_check CHECK (status IN ('PENDING', 'COMPLETED', 'EXPIRED', 'FAILED', 'REJECTED'));
