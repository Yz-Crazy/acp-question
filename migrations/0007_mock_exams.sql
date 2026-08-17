PRAGMA foreign_keys = ON;

CREATE TABLE mock_exam_templates (
  id TEXT PRIMARY KEY,
  slot INTEGER NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 6),
  title TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mock_exam_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES mock_exam_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 75),
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple')),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
  explanation TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  reference_url TEXT,
  UNIQUE (template_id, position)
);
CREATE INDEX idx_mock_template_items ON mock_exam_template_items(template_id, position);

CREATE TABLE mock_exams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES mock_exam_templates(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('fixed', 'random')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  duration_seconds INTEGER NOT NULL DEFAULT 7200 CHECK (duration_seconds > 0),
  remaining_seconds INTEGER NOT NULL DEFAULT 7200 CHECK (remaining_seconds >= 0),
  current_item_id TEXT,
  current_section TEXT NOT NULL DEFAULT 'single' CHECK (current_section IN ('single', 'multiple')),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  passed INTEGER CHECK (passed IN (0, 1)),
  wrong_count INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT
);
CREATE INDEX idx_mock_exams_user ON mock_exams(user_id, updated_at DESC);

CREATE TABLE mock_exam_items (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL REFERENCES mock_exams(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 75),
  source_question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple')),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  answer_json TEXT NOT NULL CHECK (json_valid(answer_json)),
  explanation TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  reference_url TEXT,
  selected_json TEXT CHECK (selected_json IS NULL OR json_valid(selected_json)),
  marked INTEGER NOT NULL DEFAULT 0 CHECK (marked IN (0, 1)),
  answered_at TEXT,
  UNIQUE (exam_id, position)
);
CREATE INDEX idx_mock_exam_items ON mock_exam_items(exam_id, position);
