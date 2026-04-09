CREATE TABLE IF NOT EXISTS api_key_org_scopes (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_api_key_org_scopes_api_key_id ON api_key_org_scopes(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_key_org_scopes_org_id ON api_key_org_scopes(org_id);
