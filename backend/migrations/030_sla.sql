CREATE TABLE IF NOT EXISTS sla_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  priority TEXT NOT NULL,
  deadline_hours INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, priority)
);

ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN DEFAULT false;
