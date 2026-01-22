-- role_snapshots
CREATE TABLE IF NOT EXISTS role_snapshots (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL,
  color INTEGER,
  hoist INTEGER,
  mentionable INTEGER,
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

-- channel_snapshots
CREATE TABLE IF NOT EXISTS channel_snapshots (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type INTEGER NOT NULL,
  parent_id TEXT,
  position INTEGER,
  overwrites TEXT,
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

-- role_perm_backup
CREATE TABLE IF NOT EXISTS role_perm_backup (
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  original_permissions TEXT NOT NULL,
  backup_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

-- incident_deleted_channels
CREATE TABLE IF NOT EXISTS incident_deleted_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

-- incident_created_channels
CREATE TABLE IF NOT EXISTS incident_created_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

-- antinuke_incidents
CREATE TABLE IF NOT EXISTS antinuke_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  actor_id TEXT,
  stage TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- member_snapshots
CREATE TABLE IF NOT EXISTS member_snapshots (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT,
  roles TEXT,
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- incident_banned_members
CREATE TABLE IF NOT EXISTS incident_banned_members (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  executor_id TEXT,
  banned_at TEXT NOT NULL,
  needs_role_restore INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
