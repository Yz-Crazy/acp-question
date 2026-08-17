CREATE TABLE practice_cursors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_key TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, practice_key)
);

CREATE INDEX idx_practice_cursors_updated ON practice_cursors(user_id, updated_at DESC);
