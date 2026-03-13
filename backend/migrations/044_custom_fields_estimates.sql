-- Custom field definitions (per project)
CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'multi_select', 'url', 'checkbox')),
    description TEXT,
    options JSONB DEFAULT '[]', -- for select/multi_select: [{"label":"Bug","color":"red"},...]
    required BOOLEAN NOT NULL DEFAULT false,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, name)
);

-- Custom field values (per issue)
CREATE TABLE IF NOT EXISTS custom_field_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
    value_text TEXT,
    value_number DOUBLE PRECISION,
    value_date DATE,
    value_json JSONB, -- for multi_select, complex values
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(issue_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_cfd_project ON custom_field_definitions(project_id);
CREATE INDEX IF NOT EXISTS idx_cfv_issue ON custom_field_values(issue_id);
CREATE INDEX IF NOT EXISTS idx_cfv_field ON custom_field_values(field_id);

-- Add estimate to issues (REAL type for fractional estimates like 0.5, 1.5)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS estimate REAL;

-- Add mentioned_user_ids to track @mentions in comments
ALTER TABLE issues ADD COLUMN IF NOT EXISTS mentioned_user_ids TEXT[] DEFAULT '{}';
