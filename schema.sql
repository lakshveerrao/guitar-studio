-- AirKords database (Cloudflare D1)

CREATE TABLE IF NOT EXISTS songs (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL,
  title       TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('rough','enhanced','song')),
  voice       TEXT NOT NULL,
  bpm         REAL,
  duration_ms INTEGER NOT NULL,
  backing_id  TEXT,
  lyrics      TEXT,
  likes       INTEGER NOT NULL DEFAULT 0,
  plays       INTEGER NOT NULL DEFAULT 0,
  reports     INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  voter       TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_new  ON songs (hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS songs_top  ON songs (hidden, likes DESC, plays DESC);

CREATE TABLE IF NOT EXISTS likes (
  song_id TEXT NOT NULL, voter TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (song_id, voter)
);
CREATE TABLE IF NOT EXISTS plays (
  song_id TEXT NOT NULL, voter TEXT NOT NULL, day TEXT NOT NULL,
  PRIMARY KEY (song_id, voter, day)
);
CREATE TABLE IF NOT EXISTS reports (
  song_id TEXT NOT NULL, voter TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (song_id, voter)
);
CREATE TABLE IF NOT EXISTS ai_jobs (
  id          TEXT PRIMARY KEY,
  voter       TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  title       TEXT,
  lyrics      TEXT,
  bpm         REAL,
  duration_ms INTEGER,
  model       TEXT,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
-- simple daily counters for rate limits (per IP, per voter, and site-wide)
CREATE TABLE IF NOT EXISTS quota (
  k TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (k, day)
);
