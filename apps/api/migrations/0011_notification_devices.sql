CREATE TABLE notification_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  updated_at INTEGER NOT NULL
);

CREATE INDEX notification_devices_user_id_idx ON notification_devices(user_id);
