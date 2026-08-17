ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1));

CREATE INDEX idx_users_management ON users(disabled, role, created_at DESC);
