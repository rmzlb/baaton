-- Project-level auto-assign settings
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS auto_assign_mode TEXT NOT NULL DEFAULT 'off'
  CHECK (auto_assign_mode IN ('off', 'default_assignee', 'round_robin'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS default_assignee_id TEXT;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS auto_assign_rr_index INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_activity_project_recent
  ON activity_log(project_id, created_at DESC);
