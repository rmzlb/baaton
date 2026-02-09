-- Activity log for tracking all changes to issues
-- Drop the old schema (different columns) so we can recreate with the correct structure.
-- The old table had: issue_id, actor_id, actor_name, action, details
-- The new one adds: org_id, project_id, user_id, user_name, field, old_value, new_value, metadata
DROP TABLE IF EXISTS activity_log;
CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_name TEXT,
    action TEXT NOT NULL, -- 'created', 'updated', 'commented', 'status_changed', 'assigned', 'tagged'
    field TEXT,           -- which field changed (for 'updated' actions)
    old_value TEXT,
    new_value TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_issue ON activity_log(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_org ON activity_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id, created_at DESC);
