CREATE TABLE IF NOT EXISTS custom_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  display_options JSONB NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'personal' CHECK (visibility IN ('personal', 'shared')),
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_views_org ON custom_views(org_id, created_by);
CREATE INDEX IF NOT EXISTS idx_views_project ON custom_views(project_id);
