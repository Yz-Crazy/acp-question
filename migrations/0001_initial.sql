PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invites_creator ON invite_codes(creator_id, created_at DESC);

CREATE TABLE invite_redemptions (
  invite_id TEXT NOT NULL REFERENCES invite_codes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (invite_id, user_id)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  source_id INTEGER UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple')),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
  explanation TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  is_core INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0, 1)),
  reference_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_questions_filters ON questions(active, is_core, type, category);
CREATE INDEX idx_questions_category ON questions(category);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  submitted_json TEXT NOT NULL CHECK (json_valid(submitted_json)),
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  practice_mode TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attempts_user_time ON attempts(user_id, created_at DESC);
CREATE INDEX idx_attempts_user_question ON attempts(user_id, question_id);

CREATE TABLE user_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  last_is_correct INTEGER CHECK (last_is_correct IN (0, 1)),
  last_answer_json TEXT CHECK (last_answer_json IS NULL OR json_valid(last_answer_json)),
  last_attempt_at TEXT,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE mistakes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  manually_added INTEGER NOT NULL DEFAULT 0 CHECK (manually_added IN (0, 1)),
  wrong_count INTEGER NOT NULL DEFAULT 1,
  review_count INTEGER NOT NULL DEFAULT 0,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  last_wrong_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_review_at TEXT,
  next_review_at TEXT,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX idx_mistakes_review ON mistakes(user_id, active, next_review_at, wrong_count DESC);
