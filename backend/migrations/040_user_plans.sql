-- Plan is USER-level, not org-level.
-- A user's plan covers ALL their orgs and projects combined.
CREATE TABLE IF NOT EXISTS user_plans (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise', 'partner', 'tester', 'unlimited')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT  -- superadmin who set it
);

-- Migrate: copy existing org plans to user_plans (best-effort)
-- Users get the HIGHEST plan from any org they belong to
-- This is a one-time migration, future plan changes go through user_plans
