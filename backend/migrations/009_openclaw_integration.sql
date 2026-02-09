-- OpenClaw connections per org
CREATE TABLE IF NOT EXISTS openclaw_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'My OpenClaw',
    api_url TEXT NOT NULL,          -- e.g. https://openclaw.example.com
    api_token TEXT NOT NULL,        -- encrypted gateway token
    status TEXT DEFAULT 'pending',  -- pending, connected, error
    last_ping_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_org ON openclaw_connections(org_id);

-- Add github_repo_url to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_url TEXT;
