-- 071: enforce API-key permission scopes at request time.
--
-- ## The flaw this closes
--
-- `api_keys.permissions` has existed since 001 and has always been validated at
-- key creation against `VALID_PERMISSIONS`. It was never checked when a request
-- came in. The auth middleware selected the column into a struct field marked
-- `#[allow(dead_code)]`, and `AuthUser` had no `permissions` field, so no route
-- could enforce it even deliberately.
--
-- Net effect: every API key behaved as `admin:full`. A key issued as
-- `issues:read` could DELETE projects, read billing, or mint more keys.
--
-- ## Why this migration is not just "turn it on"
--
-- Existing keys were issued under the old contract. Some were created with the
-- default trio (`issues:read`, `issues:write`, `projects:read`) but are used in
-- production for far more than that, because nothing ever stopped them. Turning
-- enforcement on globally would break live integrations silently, mid-run, with
-- opaque 403s.
--
-- So enforcement is opt-out per key, and every key that exists *right now* is
-- grandfathered:
--
--   * `legacy_full_access = true`  -> scopes are advisory, request proceeds.
--     Set for all pre-existing rows by this migration.
--   * `legacy_full_access = false` -> scopes are enforced. The column default,
--     so every key created from here on is scoped for real.
--
-- Every grandfathered request is logged with `api_key_scope_denied_legacy`, so
-- the real scope gap is measurable from logs before anyone flips a key. Closing
-- a key is then a one-line UPDATE, per key, when its owner is ready.
--
-- This is deliberately a widening-then-narrowing migration rather than a hard
-- cutover: a security fix that takes prod down gets reverted, and a reverted
-- fix protects nobody.

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS legacy_full_access BOOLEAN NOT NULL DEFAULT false;

-- Grandfather everything that already exists. `false` default above means new
-- keys are scoped; this UPDATE only touches rows created before this migration.
UPDATE api_keys
   SET legacy_full_access = true
 WHERE created_at < now();

COMMENT ON COLUMN api_keys.legacy_full_access IS
    'Issued before scope enforcement (migration 071). Scopes are advisory for this key and denials are logged, not blocked. Set to false to enforce.';

-- Reporting index: "which grandfathered keys are still open?" should not need a
-- seq scan on a table the auth path hits on every request.
CREATE INDEX IF NOT EXISTS idx_api_keys_legacy_full_access
    ON api_keys (org_id)
 WHERE legacy_full_access;
