-- KUN Maintenance & Housekeeping - PostgreSQL schema.
-- Create the database first (see server/README.md); the server applies these tables on start-up.
-- All statements are CREATE ... IF NOT EXISTS, so running them again is harmless.

-- People who may log in. Created with `npm run user -- add` (no self sign-up).
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL DEFAULT '',
  password_hash TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ
);

-- Log-in sessions. Only a SHA-256 hash of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT        PRIMARY KEY,
  account_id TEXT        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

-- All app data. One row per document: coll = collection (cfg, m_pos, locks ...), id = document id.
-- data holds the app's document JSON (chunks of register rows, settings, locks ...).
CREATE TABLE IF NOT EXISTS kv_docs (
  coll       TEXT        NOT NULL,
  id         TEXT        NOT NULL,
  data       JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  PRIMARY KEY (coll, id)
);
