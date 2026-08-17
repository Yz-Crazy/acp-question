CREATE TRIGGER guard_invite_capacity
BEFORE INSERT ON invite_redemptions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM invite_codes
  WHERE id = NEW.invite_id
    AND disabled = 0
    AND use_count < max_uses
    AND (expires_at IS NULL OR expires_at > datetime('now'))
)
BEGIN
  SELECT RAISE(ABORT, 'INVITE_UNAVAILABLE');
END;
