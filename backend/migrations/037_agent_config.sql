-- Agent configuration per user/org
-- Enables autonomous agent behaviors (heartbeat, auto-triage, email recaps)
CREATE TABLE IF NOT EXISTS agent_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    
    -- Agent identity
    agent_name TEXT NOT NULL DEFAULT 'Baaton Agent',
    
    -- Heartbeat / scheduled tasks
    heartbeat_enabled BOOLEAN NOT NULL DEFAULT false,
    heartbeat_cron TEXT DEFAULT '0 9 * * 1-5',  -- Default: weekdays 9am
    
    -- Auto-triage
    auto_triage_enabled BOOLEAN NOT NULL DEFAULT false,
    auto_triage_cron TEXT DEFAULT '0 8 * * 1-5', -- Default: weekdays 8am
    auto_triage_auto_apply BOOLEAN NOT NULL DEFAULT false, -- false = suggest only, true = auto-apply
    
    -- Email recaps
    email_recap_enabled BOOLEAN NOT NULL DEFAULT false,
    email_recap_cron TEXT DEFAULT '0 18 * * 5', -- Default: Friday 6pm
    email_recap_to TEXT, -- email address
    
    -- Analytics & roadmap
    analytics_digest_enabled BOOLEAN NOT NULL DEFAULT false,
    analytics_digest_cron TEXT DEFAULT '0 9 * * 1', -- Default: Monday 9am
    
    -- Automation suggestions
    suggest_automations BOOLEAN NOT NULL DEFAULT false,
    
    -- Security
    allowed_project_ids UUID[] DEFAULT '{}', -- Empty = all projects in org
    max_actions_per_run INT NOT NULL DEFAULT 10, -- Guard against runaway agents
    require_approval BOOLEAN NOT NULL DEFAULT true, -- Human-in-the-loop by default
    
    -- Metadata
    last_heartbeat_at TIMESTAMPTZ,
    last_triage_at TIMESTAMPTZ,
    last_recap_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(org_id, user_id)
);

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_agent_configs_org ON agent_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_user ON agent_configs(org_id, user_id);
