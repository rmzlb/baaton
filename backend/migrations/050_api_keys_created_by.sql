-- Add created_by to api_keys so we can list keys across all orgs for a given user
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON api_keys(created_by);
