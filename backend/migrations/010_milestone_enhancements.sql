-- Add ordering and estimation to milestones
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS "order" INT NOT NULL DEFAULT 0;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS estimated_days INT;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS org_id TEXT;

-- Add org_id to sprints too
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS org_id TEXT;

-- Add dependency tracking for issues within milestones
ALTER TABLE issues ADD COLUMN IF NOT EXISTS depends_on UUID[];
ALTER TABLE issues ADD COLUMN IF NOT EXISTS estimated_hours FLOAT;
