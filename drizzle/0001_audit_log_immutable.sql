-- The audit log is append-only (AD-3, PRIV-2): no one, Admins included, may
-- edit or delete an entry.
CREATE TRIGGER `audit_log_no_update`
BEFORE UPDATE ON `audit_log`
BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete`
BEFORE DELETE ON `audit_log`
BEGIN
	SELECT RAISE(ABORT, 'audit_log is append-only');
END;
