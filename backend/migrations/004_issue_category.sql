-- Add category field to distinguish frontend vs backend vs API vs DB
ALTER TABLE issues ADD COLUMN IF NOT EXISTS category TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues USING GIN (category);
