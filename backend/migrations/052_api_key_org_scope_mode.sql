ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS org_scope_mode TEXT NOT NULL DEFAULT 'fixed';

ALTER TABLE api_keys
DROP CONSTRAINT IF EXISTS api_keys_org_scope_mode_check;

ALTER TABLE api_keys
ADD CONSTRAINT api_keys_org_scope_mode_check
CHECK (org_scope_mode IN ('fixed', 'all_dynamic'));
