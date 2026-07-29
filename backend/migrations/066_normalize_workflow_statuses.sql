-- 066_normalize_workflow_statuses.sql
-- Standardize every project on the new default workflow:
-- Draft → Backlog → In Progress → Not OK → Done → Canceled.
--
-- Keys stay compatible with the existing API/agent contract:
--   Draft   = todo
--   Not OK  = in_review
--   Canceled = cancelled

WITH remapped AS (
  SELECT
    i.id,
    CASE
      WHEN i.status IN ('todo', 'backlog', 'in_progress', 'in_review', 'done', 'cancelled') THEN i.status
      WHEN i.status_category = 'completed' THEN 'done'
      WHEN i.status_category = 'canceled' THEN 'cancelled'
      WHEN i.status_category = 'backlog' THEN 'backlog'
      WHEN i.status_category = 'unstarted' THEN 'todo'
      ELSE 'in_review'
    END AS next_status
  FROM issues i
  WHERE i.status NOT IN ('todo', 'backlog', 'in_progress', 'in_review', 'done', 'cancelled')
)
UPDATE issues i
SET status = r.next_status
FROM remapped r
WHERE i.id = r.id
  AND i.status <> r.next_status;

UPDATE projects
SET statuses = '[
  {"key":"todo","label":"Draft","color":"#3b82f6","hidden":false,"category":"unstarted","core":true},
  {"key":"backlog","label":"Backlog","color":"#6b7280","hidden":false,"category":"backlog","core":true},
  {"key":"in_progress","label":"In Progress","color":"#f59e0b","hidden":false,"category":"started","core":true},
  {"key":"in_review","label":"Not OK","color":"#8b5cf6","hidden":false,"category":"started","core":true},
  {"key":"done","label":"Done","color":"#22c55e","hidden":false,"category":"completed","core":true},
  {"key":"cancelled","label":"Canceled","color":"#ef4444","hidden":true,"category":"canceled","core":true}
]'::jsonb;

ALTER TABLE projects ALTER COLUMN statuses SET DEFAULT '[
  {"key":"todo","label":"Draft","color":"#3b82f6","hidden":false,"category":"unstarted","core":true},
  {"key":"backlog","label":"Backlog","color":"#6b7280","hidden":false,"category":"backlog","core":true},
  {"key":"in_progress","label":"In Progress","color":"#f59e0b","hidden":false,"category":"started","core":true},
  {"key":"in_review","label":"Not OK","color":"#8b5cf6","hidden":false,"category":"started","core":true},
  {"key":"done","label":"Done","color":"#22c55e","hidden":false,"category":"completed","core":true},
  {"key":"cancelled","label":"Canceled","color":"#ef4444","hidden":true,"category":"canceled","core":true}
]'::jsonb;

UPDATE issues i SET
  status_category = COALESCE(
    (SELECT s->>'category' FROM projects p, jsonb_array_elements(p.statuses) AS s
       WHERE p.id = i.project_id AND s->>'key' = i.status LIMIT 1),
    i.status_category),
  status_label = COALESCE(
    (SELECT s->>'label' FROM projects p, jsonb_array_elements(p.statuses) AS s
       WHERE p.id = i.project_id AND s->>'key' = i.status LIMIT 1),
    i.status_label),
  status_color = COALESCE(
    (SELECT s->>'color' FROM projects p, jsonb_array_elements(p.statuses) AS s
       WHERE p.id = i.project_id AND s->>'key' = i.status LIMIT 1),
    i.status_color);
