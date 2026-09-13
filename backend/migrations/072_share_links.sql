-- 072: shareable links for issues and projects, with real link previews.
--
-- Today exactly one object in Baaton previews correctly when pasted into
-- Slack, Telegram, WhatsApp or a GitHub comment: the agent run card
-- (`agent_sessions.public_token` -> `/r/:token`, migration 055). Everything
-- else is a client-rendered React route, so a crawler that does not run
-- JavaScript sees only `frontend/index.html` — meaning every ticket link and
-- every project link in the world unfurls with the *marketing* title and the
-- *marketing* OG image. Three people pasting three different tickets into a
-- channel produce three identical grey cards.
--
-- That is the whole reason this migration exists. Not "nice previews": a link
-- whose preview says nothing forces the receiver to open it to learn whether
-- it concerns them, which is exactly the WhatsApp-archaeology the product is
-- supposed to end.
--
-- Model mirrors `agent_sessions` rather than inventing a second one:
--   * opt-in per object, default FALSE. Nothing becomes public by a migration.
--   * the token is the capability. No org check on read, so the link works for
--     a client with no account (the intake case) — same trade-off already
--     accepted for public submit tokens and run cards.
--   * `is_public = FALSE` must imply `token IS NULL`, enforced by CHECK, so
--     un-sharing actually invalidates the URL instead of leaving a live token
--     behind a disabled flag. Re-sharing mints a new token on purpose: an
--     un-shared link must never come back to life.
--   * `shared_by` records the human who exposed the object. Attribution here
--     is not decoration — "who made this customer-visible" is the first
--     question asked after an accidental disclosure.
--
-- Deliberately NOT stored: a denormalized title/summary snapshot for the card.
-- The renderer reads the live row, so an edited ticket fixes its own preview
-- on the next crawl instead of pinning yesterday's wording forever.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_token TEXT,
  ADD COLUMN IF NOT EXISTS shared_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shared_by    TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_token TEXT,
  ADD COLUMN IF NOT EXISTS shared_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shared_by    TEXT;

COMMENT ON COLUMN issues.public_token IS
  'Capability token for /i/<token>. NULL unless is_public. Rotated on re-share.';
COMMENT ON COLUMN projects.public_token IS
  'Capability token for /p/<token>. NULL unless is_public. Rotated on re-share.';
COMMENT ON COLUMN issues.shared_by IS
  'Clerk user id (or apikey: pseudo-user) that made this issue publicly readable.';

-- Lookup path for the SSR renderer: token -> row, one index hit, no seq scan.
-- Partial so the index only carries actually-shared rows (2 of 17 projects are
-- public-submit enabled today; the shared set will be similarly sparse).
CREATE UNIQUE INDEX IF NOT EXISTS issues_public_token_key
  ON issues (public_token)
  WHERE public_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_public_token_key
  ON projects (public_token)
  WHERE public_token IS NOT NULL;

-- Same invariant migration 055 added for agent_sessions: a disabled flag must
-- not leave a working token behind. Named so a violation is self-explaining in
-- the error message.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issues_public_token_requires_public'
  ) THEN
    -- Repair before constraining: a token with is_public=FALSE is exactly the
    -- state we are outlawing, so drop the token rather than fail the migration.
    UPDATE issues SET public_token = NULL
     WHERE is_public = FALSE AND public_token IS NOT NULL;

    ALTER TABLE issues
      ADD CONSTRAINT issues_public_token_requires_public
      CHECK (is_public = TRUE OR public_token IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_public_token_requires_public'
  ) THEN
    UPDATE projects SET public_token = NULL
     WHERE is_public = FALSE AND public_token IS NOT NULL;

    ALTER TABLE projects
      ADD CONSTRAINT projects_public_token_requires_public
      CHECK (is_public = TRUE OR public_token IS NULL);
  END IF;
END $$;
