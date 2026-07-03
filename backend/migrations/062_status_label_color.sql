-- 062_status_label_color.sql
-- 10/10 cross-project status visibility.
--
-- issues.status_category (migration 061) lets the aggregated views group any
-- custom status under its canonical column. But the label + color of a custom
-- status live only on projects.statuses (per project). Cross-project views
-- (AllIssues / MyTasks) don't hold every project's status list, so they can't
-- resolve "Pas ok" + its color and fall back to the raw key / category label.
--
-- Mirror what status_category already does: denormalize the status's label +
-- color onto the issue row, kept in sync by the same trigger + re-synced by
-- update_statuses when a project edits its workflow. The badge then renders the
-- issue's real status name + color everywhere, while grouping stays by category.

-- 1. Denormalized label + color columns on issues
ALTER TABLE issues ADD COLUMN IF NOT EXISTS status_label TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS status_color TEXT;

-- 2. Extend the sync trigger to also derive label + color from the project's
--    status definitions (falls back to canonical core values when a status
--    definition is missing, mirroring the status_category fallback).
CREATE OR REPLACE FUNCTION sync_issue_status_category() RETURNS trigger AS $$
DECLARE
  cat   TEXT;
  lbl   TEXT;
  col   TEXT;
BEGIN
  SELECT s->>'category', s->>'label', s->>'color'
    INTO cat, lbl, col
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

  IF lbl IS NULL THEN
    lbl := CASE NEW.status
      WHEN 'backlog'     THEN 'Backlog'
      WHEN 'todo'        THEN 'Todo'
      WHEN 'in_progress' THEN 'In Progress'
      WHEN 'in_review'   THEN 'In Review'
      WHEN 'done'        THEN 'Done'
      WHEN 'cancelled'   THEN 'Cancelled'
      ELSE NEW.status END;
  END IF;

  IF col IS NULL THEN
    col := CASE NEW.status
      WHEN 'backlog'     THEN '#6b7280'
      WHEN 'todo'        THEN '#3b82f6'
      WHEN 'in_progress' THEN '#f59e0b'
      WHEN 'in_review'   THEN '#8b5cf6'
      WHEN 'done'        THEN '#22c55e'
      WHEN 'cancelled'   THEN '#ef4444'
      ELSE '#6b7280' END;
  END IF;

  NEW.status_category := cat;
  NEW.status_label    := lbl;
  NEW.status_color    := col;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- (trigger trg_sync_issue_status_category already fires BEFORE INSERT OR
--  UPDATE OF status — replacing the function body is enough.)

-- 3. Backfill existing issues
UPDATE issues i SET
  status_label = COALESCE(
    (SELECT s->>'label' FROM projects p, jsonb_array_elements(p.statuses) AS s
       WHERE p.id = i.project_id AND s->>'key' = i.status LIMIT 1),
    CASE i.status
      WHEN 'backlog'     THEN 'Backlog'
      WHEN 'todo'        THEN 'Todo'
      WHEN 'in_progress' THEN 'In Progress'
      WHEN 'in_review'   THEN 'In Review'
      WHEN 'done'        THEN 'Done'
      WHEN 'cancelled'   THEN 'Cancelled'
      ELSE i.status END),
  status_color = COALESCE(
    (SELECT s->>'color' FROM projects p, jsonb_array_elements(p.statuses) AS s
       WHERE p.id = i.project_id AND s->>'key' = i.status LIMIT 1),
    CASE i.status
      WHEN 'backlog'     THEN '#6b7280'
      WHEN 'todo'        THEN '#3b82f6'
      WHEN 'in_progress' THEN '#f59e0b'
      WHEN 'in_review'   THEN '#8b5cf6'
      WHEN 'done'        THEN '#22c55e'
      WHEN 'cancelled'   THEN '#ef4444'
      ELSE '#6b7280' END)
WHERE status_label IS NULL OR status_color IS NULL;
