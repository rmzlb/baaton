CREATE TABLE IF NOT EXISTS recurrence_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  title_template TEXT NOT NULL,
  description TEXT,
  assignee_ids TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  priority TEXT DEFAULT 'medium',
  issue_type TEXT DEFAULT 'feature',
  rrule TEXT NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  paused BOOLEAN DEFAULT false,
  end_date DATE,
  max_occurrences INT,
  occurrence_count INT DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurrence_project ON recurrence_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_recurrence_next ON recurrence_rules(next_run_at) WHERE NOT paused;
