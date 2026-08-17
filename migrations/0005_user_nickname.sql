ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT '';

UPDATE users SET nickname = username WHERE nickname = '';
