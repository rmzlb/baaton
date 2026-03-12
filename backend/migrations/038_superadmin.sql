-- Super admin table: platform-level admins (not org-level)
CREATE TABLE IF NOT EXISTS super_admins (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by TEXT
);

-- Expand plan CHECK to include custom plans
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check
  CHECK (plan IN ('free', 'pro', 'enterprise', 'partner', 'tester', 'unlimited'));

-- Seed initial super admin (rmzlb / ramzi.laieb@gmail.com)
-- user_id will be auto-filled on first authenticated request
INSERT INTO super_admins (user_id, email, granted_by)
VALUES ('', 'ramzi.laieb@gmail.com', 'system')
ON CONFLICT DO NOTHING;
