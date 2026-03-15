-- 048: Agent Sessions — full lifecycle tracking for AI agents working on issues
-- Adds agent_status to issues + agent_sessions table + agent_steps table

-- ── Agent status on issues ──────────────────────────────
ALTER TABLE issues ADD COLUMN IF NOT EXISTS agent_status TEXT DEFAULT NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS agent_session_id UUID DEFAULT NULL;

-- Values: NULL (no agent), 'pending', 'active', 'awaiting_input', 'completed', 'error'

-- ── Agent sessions table ────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    agent_id TEXT,  -- external agent identifier (e.g. "openclaw:haroz", "cursor:session-123")
    
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, active, awaiting_input, completed, error
    
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    
    -- Summary (filled on completion)
    summary TEXT,
    files_changed TEXT[] DEFAULT '{}',
    tests_status TEXT DEFAULT 'none',  -- passed, failed, skipped, none
    pr_url TEXT,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_issue ON agent_sessions(issue_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON agent_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status) WHERE status IN ('pending', 'active');

-- ── Agent steps (live progress within a session) ────────
CREATE TABLE IF NOT EXISTS agent_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    
    step_type TEXT NOT NULL DEFAULT 'info',  -- info, action, thought, error, tool_call, tool_result
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_session ON agent_steps(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_issue ON agent_steps(issue_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_created ON agent_steps(session_id, created_at);

-- ── Add tldr_posted to activity tracking ────────────────
-- (no schema change needed, just documenting that tldrs.rs should call log_activity)
