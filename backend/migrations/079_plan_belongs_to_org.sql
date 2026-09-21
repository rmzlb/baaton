-- Plans belong to the ORGANIZATION (workspace) again.
--
-- Migration 045 moved the plan to the human who clicks (user_plans) and made
-- quotas count across all of that human's orgs. Two consequences hit
-- production on 2026-09-21:
--   * an API key has no human identity (`apikey:<uuid>`), so it always
--     resolved to the free plan — 402 at 500 issues on an unlimited owner's
--     org (sqhelm), for every agent and for the Sqare assistant;
--   * a free member of an unlimited org was blocked by a quota they do not
--     pay for.
--
-- The plan now follows the workspace model: an org is entitled by its own
-- `plan`, raised to the plan of its owner (the Clerk user who created it).
-- A user's plan covers the orgs they own and the API keys they create — never
-- the orgs they merely joined. Quotas count inside the org.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations (owner_user_id) WHERE owner_user_id IS NOT NULL;

COMMENT ON COLUMN organizations.plan IS
  'Entitlement of the workspace. Effective plan = highest of this value and the owner''s user_plans row (see entitlement.rs). Written by PATCH /admin/orgs/{id}/plan.';
COMMENT ON COLUMN organizations.owner_user_id IS
  'Clerk user who created the org (organizations.created_by on Clerk). Resolved lazily from Clerk; the owner''s user_plans row raises the org plan.';
COMMENT ON TABLE user_plans IS
  'Plan attached to a human: raises the plan of every org they OWN and applies to their API keys and direct actions. Never leaks into orgs they only joined.';
