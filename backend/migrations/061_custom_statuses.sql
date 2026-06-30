-- 061_custom_statuses.sql
-- Customizable per-project workflow statuses.
--
-- Each project status object gains two fields:
--   * category : semantic group that business logic keys off of, NOT the literal key.
--                One of: backlog | unstarted | started | completed | canceled
--   * core     : true for the 6 immutable anchor statuses (key + category locked,
--                cannot be deleted). Guarantees every category always has >= 1 status,
--                so terminal/open/backlog logic never hits an empty set.
--
-- Users may freely: add custom statuses, rename labels, recolor, hide, reorder, and
-- delete custom statuses (issues get reassigned). Keys stay stable identifiers.
--
-- issues.status_category is a denormalized mirror of the status's category, kept in
-- sync by a trigger so heavy SQL (NOT IN done/cancelled, etc.) stays correct for any
-- custom status name.

-- 1. Denormalized category column on issues
ALTER TABLE issues ADD COLUMN IF NOT EXISTS status_category TEXT;

-- 2. Backfill projects.statuses with category + core (idempotent: keeps existing values)
UPDATE projects
SET statuses = (
  SELECT jsonb_agg(
    s || jsonb_build_object(
      'category', COALESCE(s->>'category', CASE s->>'key'
        WHEN 'backlog'     THEN 'backlog'
        WHEN 'todo'        THEN 'unstarted'
        WHEN 'in_progress' THEN 'started'
        WHEN 'in_review'   THEN 'started'
        WHEN 'done'        THEN 'completed'
        WHEN 'cancelled'   THEN 'canceled'
        ELSE 'started' END),
      'core', COALESCE((s->>'core')::boolean,
        (s->>'key') IN ('backlog','todo','in_progress','in_review','done','cancelled'))
    )
  )
  FROM jsonb_array_elements(statuses) AS s
)
WHERE jsonb_typeof(statuses) = 'array';

-- 3. New-project default now carries category + core
ALTER TABLE projects ALTER COLUMN statuses SET DEFAULT '[
  {"key":"backlog","label":"Backlog","color":"#6b7280","hidden":true,"category":"backlog","core":true},
  {"key":"todo","label":"Todo","color":"#3b82f6","hidden":false,"category":"unstarted","core":true},
  {"key":"in_progress","label":"In Progress","color":"#f59e0b","hidden":false,"category":"started","core":true},
  {"key":"in_review","label":"In Review","color":"#8b5cf6","hidden":false,"category":"started","core":true},
  {"key":"done","label":"Done","color":"#22c55e","hidden":false,"category":"completed","core":true},
  {"key":"cancelled","label":"Cancelled","color":"#ef4444","hidden":true,"category":"canceled","core":true}
]'::jsonb;

-- 4. Trigger: derive issues.status_category from the project's status definitions
CREATE OR REPLACE FUNCTION sync_issue_status_category() RETURNS trigger AS $$
DECLARE
  cat TEXT;
BEGIN
  SELECT s->>'category' INTO cat
  FROM projects p, jsonb_array_elements(p.statuses) AS s
  WHERE p.id = NEW.project_id AND s->>'key' = NEW.status
  LIMIT 1;

  IF cat IS NULL THEN
    cat := CASE NEW.status
      WHEN 'backlog'     THEN 'backlog'
      WHEN 'todo'        THEN 'unstarted'
      WHEN 'in_progress' THEN 'started'
      WHEN 'in_review'   THEN 'started'
      WHEN 'done'        THEN 'completed'
      WHEN 'cancelled'   THEN 'canceled'
      ELSE 'started' END;
  END IF;

  NEW.status_category := cat;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_issue_status_category ON issues;
CREATE TRIGGER trg_sync_issue_status_category
  BEFORE INSERT OR UPDATE OF status ON issues
  FOR EACH ROW EXECUTE FUNCTION sync_issue_status_category();

-- 5. Backfill existing issues
UPDATE issues i SET status_category = COALESCE(
  (SELECT s->>'category' FROM projects p, jsonb_array_elements(p.statuses) AS s
     WHERE p.id = i.project_id AND s->>'key' = i.status LIMIT 1),
  CASE i.status
    WHEN 'backlog'     THEN 'backlog'
    WHEN 'todo'        THEN 'unstarted'
    WHEN 'in_progress' THEN 'started'
    WHEN 'in_review'   THEN 'started'
    WHEN 'done'        THEN 'completed'
    WHEN 'cancelled'   THEN 'canceled'
    ELSE 'started' END
)
WHERE status_category IS NULL;

-- 6. Index for terminal/open filters
CREATE INDEX IF NOT EXISTS idx_issues_project_status_category
  ON issues(project_id, status_category);
