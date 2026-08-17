-- Local development only. Production invite codes are created through /api/auth/bootstrap-invite.
INSERT OR IGNORE INTO invite_codes (id, code, max_uses, expires_at)
VALUES ('local-demo-invite', 'ACP-DEMO-2026', 100, datetime('now', '+10 years'));
