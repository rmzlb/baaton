-- Issue templates
CREATE TABLE IF NOT EXISTS issue_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title_template TEXT DEFAULT '',
  description_template TEXT DEFAULT '',
  type TEXT DEFAULT 'feature',
  priority TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add estimate and sprint_id to issues
ALTER TABLE issues ADD COLUMN IF NOT EXISTS estimate INTEGER;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL;
