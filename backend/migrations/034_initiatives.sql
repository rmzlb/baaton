-- BAA-9: Initiatives
CREATE TABLE IF NOT EXISTS initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'paused')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_initiatives_org ON initiatives(org_id);

CREATE TABLE IF NOT EXISTS initiative_projects (
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (initiative_id, project_id)
);
