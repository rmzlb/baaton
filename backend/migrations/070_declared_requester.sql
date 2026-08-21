-- 070: declared (unverified) requester identity on comments.
--
-- Migration 068 answered "who acted" (`actor_type`, `actor_key_id`) and "which
-- human owns the key" (`on_behalf_of`, an FK-ish Clerk user id). Neither covers
-- the common ticketing case: an integration files a comment for someone who has
-- no Baaton account at all.
--
-- Issues already carry `reporter_name` / `reporter_email` for this. Comments get
-- the same pair, deliberately free-text:
--   * no user row is created (Zendesk-style implicit user creation would consume
--     seats and pollute the org),
--   * these columns are NEVER read for authorization. `author_id` remains the
--     acting principal and the only rights-bearing identity.
-- The UI renders them as unverified, since nothing proves the email.

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS on_behalf_of_name  TEXT,
  ADD COLUMN IF NOT EXISTS on_behalf_of_email TEXT;

COMMENT ON COLUMN comments.on_behalf_of_name IS
  'Declared, UNVERIFIED requester name. Display/reporting only, never authorization.';
COMMENT ON COLUMN comments.on_behalf_of_email IS
  'Declared, UNVERIFIED requester email. Not tied to a Baaton account.';

-- Reporting: "show me everything filed for this customer" across both columns.
CREATE INDEX IF NOT EXISTS idx_comments_on_behalf_of_email
  ON comments (LOWER(on_behalf_of_email))
  WHERE on_behalf_of_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_issues_reporter_email
  ON issues (LOWER(reporter_email))
  WHERE reporter_email IS NOT NULL;
