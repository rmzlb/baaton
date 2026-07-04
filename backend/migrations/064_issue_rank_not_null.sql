-- STEP 2 (DEFERRED — DO NOT APPLY UNTIL BACKFILL IS VERIFIED).
--
-- This migration is intentionally NOT registered in backend/src/main.rs.
-- Apply it only once:
--   1. Migration 063 has run (rank column exists).
--   2. backend/scripts/backfill-ranks.mjs has been run against the target DB.
--   3. A verification query confirms zero NULL ranks:
--        SELECT count(*) FROM issues WHERE rank IS NULL;  -- must be 0
--
-- To enable: uncomment the matching line in the `migrations` array in
-- backend/src/main.rs, e.g.:
--   (64, include_str!("../migrations/064_issue_rank_not_null.sql")),

-- Guard: fail loudly if any row is still missing a rank.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM issues WHERE rank IS NULL) THEN
    RAISE EXCEPTION 'Cannot set issues.rank NOT NULL: % rows still have NULL rank. Run the backfill first.',
      (SELECT count(*) FROM issues WHERE rank IS NULL);
  END IF;
END $$;

ALTER TABLE issues ALTER COLUMN rank SET NOT NULL;
