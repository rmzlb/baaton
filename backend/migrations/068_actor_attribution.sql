-- Actor attribution: separate "who acted" from "on whose behalf".
--
-- Before this migration, an action performed through an API key was recorded
-- with user_id = 'apikey:<uuid>' and user_name = <key name>. The human owning
-- the key (api_keys.created_by) was resolved during auth and then discarded,
-- so audit trails and comments could not answer "which human is responsible".
--
-- Design follows the principal/actor split used by OAuth token exchange
-- (RFC 8693 `sub` + `act`), AWS CloudTrail (userIdentity + sessionContext) and
-- GCP audit logs (principalEmail + serviceAccountDelegationInfo): the acting
-- identity is preserved as-is (needed for revocation and ownership), and the
-- delegating human is stored alongside it.
--
-- Additive only. Existing columns keep their exact current meaning:
--   user_id / author_id   = the identity that performed the action
--   on_behalf_of          = the human ultimately responsible (NULL if same)
--   actor_type            = classification of the acting identity
--   actor_key_id          = which API key acted (revocation target)

-- ── activity_log ─────────────────────────────────────────
ALTER TABLE activity_log
    ADD COLUMN IF NOT EXISTS actor_type   TEXT NOT NULL DEFAULT 'human',
    ADD COLUMN IF NOT EXISTS actor_key_id UUID,
    ADD COLUMN IF NOT EXISTS on_behalf_of TEXT;

-- ── comments ─────────────────────────────────────────────
ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS actor_type   TEXT NOT NULL DEFAULT 'human',
    ADD COLUMN IF NOT EXISTS actor_key_id UUID,
    ADD COLUMN IF NOT EXISTS on_behalf_of TEXT;

-- ── Backfill from existing identity prefixes ─────────────
-- API-key rows: classify, extract the key id, and attribute to the key owner.
-- The api_keys join is LEFT so rows from deleted keys still get actor_type set.
UPDATE activity_log al
SET actor_type   = 'api_key',
    actor_key_id = k.id,
    on_behalf_of = k.created_by
FROM api_keys k
WHERE al.user_id = 'apikey:' || k.id::text
  AND al.actor_type = 'human';

UPDATE activity_log
SET actor_type = 'api_key'
WHERE user_id LIKE 'apikey:%'
  AND actor_type = 'human';

UPDATE activity_log
SET actor_type = 'github'
WHERE user_id LIKE 'github:%'
  AND actor_type = 'human';

UPDATE activity_log
SET actor_type = 'system'
WHERE user_id IN ('system', '')
  AND actor_type = 'human';

UPDATE comments c
SET actor_type   = 'api_key',
    actor_key_id = k.id,
    on_behalf_of = k.created_by
FROM api_keys k
WHERE c.author_id = 'apikey:' || k.id::text
  AND c.actor_type = 'human';

UPDATE comments
SET actor_type = 'api_key'
WHERE author_id LIKE 'apikey:%'
  AND actor_type = 'human';

UPDATE comments
SET actor_type = 'github'
WHERE author_id LIKE 'github:%'
  AND actor_type = 'human';

UPDATE comments
SET actor_type = 'system'
WHERE author_id IN ('system', '')
  AND actor_type = 'human';

-- ── Indexes for audit queries ────────────────────────────
-- "what did this key do" (revocation impact) and "what did this human do,
-- including through their agents" (accountability).
CREATE INDEX IF NOT EXISTS idx_activity_log_actor_key
    ON activity_log(actor_key_id, created_at DESC)
    WHERE actor_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_on_behalf_of
    ON activity_log(on_behalf_of, created_at DESC)
    WHERE on_behalf_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_actor_type
    ON activity_log(org_id, actor_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_actor_key
    ON comments(actor_key_id)
    WHERE actor_key_id IS NOT NULL;
