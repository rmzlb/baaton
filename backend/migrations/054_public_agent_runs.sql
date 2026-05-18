-- 054: Public agent run receipts
-- Public by explicit project/session opt-in only. Existing orgs/projects remain private.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS agent_runs_public_default BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_token TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_public_token
  ON agent_sessions(public_token)
  WHERE public_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_public_lookup
  ON agent_sessions(public_token)
  WHERE is_public = TRUE;
