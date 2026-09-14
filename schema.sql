-- 化学练习平台 · Cloudflare D1 schema
-- 由 wrangler d1 execute chem-db --file=./schema.sql 应用（见部署说明）

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  salt     TEXT NOT NULL,
  hash     TEXT NOT NULL,
  created  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token     TEXT PRIMARY KEY,
  username  TEXT NOT NULL,
  expires   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username);

CREATE TABLE IF NOT EXISTS user_data (
  username   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, key)
);
