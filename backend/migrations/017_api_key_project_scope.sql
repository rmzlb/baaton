-- Optional project-level scoping for API keys
-- If project_ids is NULL or empty, the key has access to all projects in the org (default).
-- If project_ids contains UUIDs, access is restricted to those projects only.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS project_ids UUID[] DEFAULT '{}';

-- Index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_api_keys_project_ids ON api_keys USING GIN (project_ids);
