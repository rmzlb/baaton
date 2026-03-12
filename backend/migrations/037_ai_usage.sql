-- AI usage metering table
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'chat_message',  -- chat_message | automation_trigger | triage_ai
    tokens_in INT DEFAULT 0,
    tokens_out INT DEFAULT 0,
    model TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast monthly count per user (billing queries)
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_monthly ON ai_usage(user_id, created_at);
-- Fast monthly count per org (analytics)
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_monthly ON ai_usage(org_id, created_at);
