CREATE TABLE IF NOT EXISTS cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cycles_project ON cycles(project_id, start_date DESC);

ALTER TABLE issues ADD COLUMN IF NOT EXISTS cycle_id UUID REFERENCES cycles(id);
CREATE INDEX IF NOT EXISTS idx_issues_cycle ON issues(cycle_id) WHERE cycle_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS cycle_duration_weeks INT DEFAULT 2;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cycle_start_day TEXT DEFAULT 'monday';
