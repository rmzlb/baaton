-- 055: Agent run guardrails — org-level toggle + idempotency column + invariant
-- Builds on 054 (which already adds is_public, public_token, published_at, agent_runs_public_default).

-- Org-level master switch. Default false so existing orgs stay private.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS agent_runs_public_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotency anchor for the auto-posted PR comment. NULL = never posted.
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS pr_comment_id BIGINT;

-- Invariant: a token may only exist when the session is published.
-- `ADD CONSTRAINT IF NOT EXISTS` only landed in PG 15+, use a DO block for portability.
DO $$
BEGIN
  ALTER TABLE agent_sessions
    ADD CONSTRAINT agent_sessions_token_when_public
    CHECK ((is_public = FALSE AND public_token IS NULL)
        OR (is_public = TRUE  AND public_token IS NOT NULL AND published_at IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- already applied on a previous boot
END $$;
