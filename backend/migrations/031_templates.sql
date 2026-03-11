-- Extend issue_templates with new fields (table may already exist)
CREATE TABLE IF NOT EXISTS issue_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  title_prefix TEXT,
  description TEXT,
  default_tags TEXT[] DEFAULT '{}',
  default_priority TEXT DEFAULT 'medium',
  default_issue_type TEXT DEFAULT 'feature',
  default_assignee_ids TEXT[] DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns if table already existed with old schema
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS title_prefix TEXT;
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS default_tags TEXT[] DEFAULT '{}';
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS default_priority TEXT DEFAULT 'medium';
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS default_issue_type TEXT DEFAULT 'feature';
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS default_assignee_ids TEXT[] DEFAULT '{}';
ALTER TABLE issue_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_templates_project ON issue_templates(project_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_template_id UUID;
