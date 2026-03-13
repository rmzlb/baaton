-- Plans are now per-user, not per-org.
-- organizations.plan column is kept but no longer authoritative.
-- The source of truth is now user_plans table.

-- Mark organizations.plan as deprecated
COMMENT ON COLUMN organizations.plan IS 'DEPRECATED: Plans are per-user now. See user_plans table.';
