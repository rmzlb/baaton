-- OpenClaw connections per USER (not org)
-- Each user connects their own OpenClaw instance
CREATE TABLE IF NOT EXISTS openclaw_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,          -- Clerk user ID (owner)
    org_id TEXT,                    -- optional: which org context
    name TEXT NOT NULL DEFAULT 'My OpenClaw',
    api_url TEXT NOT NULL,          -- e.g. https://openclaw.example.com
    api_token TEXT NOT NULL,        -- gateway token
    status TEXT DEFAULT 'pending',  -- pending, connected, error
    last_ping_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_user ON openclaw_connections(user_id);

-- Add github_repo_url to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_url TEXT;
