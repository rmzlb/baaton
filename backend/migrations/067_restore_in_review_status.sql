-- 067_restore_in_review_status.sql
--
-- Restore the review gate as its own workflow step:
-- Draft -> Backlog -> In Progress -> Not OK -> In Review -> Done -> Canceled.
--
-- Migration 066 temporarily reused `in_review` for "Not OK". The only
-- high-confidence rows that were previously custom "Pas ok" still carry an
-- auto:status:custom_* tag, so only those are moved to `not_ok`.

UPDATE issues
SET status = 'not_ok',
    status_category = 'started',
    status_label = 'Not OK',
    status_color = '#fa6400',
    tags = CASE
      WHEN 'auto:status:not_ok' = ANY(tags) THEN tags
      ELSE array_append(tags, 'auto:status:not_ok')
    END
WHERE status = 'in_review'
  AND EXISTS (
    SELECT 1
    FROM unnest(tags) AS tag
    WHERE tag LIKE 'auto:status:custom_%'
  );

UPDATE projects
SET statuses = '[
  {"key":"todo","label":"Draft","color":"#3b82f6","hidden":false,"category":"unstarted","core":true},
  {"key":"backlog","label":"Backlog","color":"#6b7280","hidden":false,"category":"backlog","core":true},
  {"key":"in_progress","label":"In Progress","color":"#f59e0b","hidden":false,"category":"started","core":true},
  {"key":"not_ok","label":"Not OK","color":"#fa6400","hidden":false,"category":"started","core":true},
  {"key":"in_review","label":"In Review","color":"#8b5cf6","hidden":false,"category":"started","core":true},
  {"key":"done","label":"Done","color":"#22c55e","hidden":false,"category":"completed","core":true},
  {"key":"cancelled","label":"Canceled","color":"#ef4444","hidden":true,"category":"canceled","core":true}
]'::jsonb;

ALTER TABLE projects
  ALTER COLUMN statuses SET DEFAULT '[
    {"key":"todo","label":"Draft","color":"#3b82f6","hidden":false,"category":"unstarted","core":true},
    {"key":"backlog","label":"Backlog","color":"#6b7280","hidden":false,"category":"backlog","core":true},
    {"key":"in_progress","label":"In Progress","color":"#f59e0b","hidden":false,"category":"started","core":true},
    {"key":"not_ok","label":"Not OK","color":"#fa6400","hidden":false,"category":"started","core":true},
    {"key":"in_review","label":"In Review","color":"#8b5cf6","hidden":false,"category":"started","core":true},
    {"key":"done","label":"Done","color":"#22c55e","hidden":false,"category":"completed","core":true},
    {"key":"cancelled","label":"Canceled","color":"#ef4444","hidden":true,"category":"canceled","core":true}
  ]'::jsonb;

UPDATE issues i
SET status_category = s.category,
    status_label = s.label,
    status_color = s.color
FROM (
  SELECT p.id AS project_id,
         status_item->>'key' AS key,
         status_item->>'category' AS category,
         status_item->>'label' AS label,
         status_item->>'color' AS color
  FROM projects p
  CROSS JOIN LATERAL jsonb_array_elements(p.statuses) AS status_item
) s
WHERE i.project_id = s.project_id
  AND i.status = s.key;
