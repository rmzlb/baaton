-- Fractional indexing rank for Linear-grade kanban ordering.
--
-- Strategy:
--   * `rank` is a short ASCII-sortable string (see the `fractional-indexing`
--     lib on the client). Cards inside a (project_id, status) column are ordered
--     by `rank` lexicographically; inserting between two cards only rewrites the
--     single moved row (no cascade / renumber).
--   * Column is nullable for now so existing rows keep working while the backfill
--     script (backend/scripts/backfill-ranks.mjs) assigns ranks per column.
--   * `position` (FLOAT) is intentionally KEPT as a fallback until the backfill
--     is verified in prod. Board queries use `ORDER BY rank ASC NULLS LAST, position ASC`.
--
-- The NOT NULL tightening lives in 064_issue_rank_not_null.sql and is NOT wired
-- into the migration runner yet (see backend/src/main.rs). Apply it only after
-- the backfill has been run and verified.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS rank TEXT;

-- Column-scoped ordering index (matches the board ORDER BY).
CREATE INDEX IF NOT EXISTS idx_issues_project_status_rank
  ON issues (project_id, status, rank);
