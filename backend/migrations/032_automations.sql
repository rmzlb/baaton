CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('issue_created', 'status_changed', 'priority_changed', 'label_added', 'comment_added')),
  conditions JSONB NOT NULL DEFAULT '[]',
  actions JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN DEFAULT true,
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_project ON automation_rules(project_id, enabled);
